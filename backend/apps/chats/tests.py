"""
Тесты для мульти-изображений в сообщениях (плитка).
Покрывает: модель, сериализатор, REST API (создание + получение),
а также обратную совместимость (одиночный file).
"""
import uuid

from django.test import TestCase, override_settings
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from apps.users.models import User
from apps.files.models import FileAttachment
from apps.chats.models import Chat, ChatMember, Message, DEFAULT_MAX_MEMBERS
from apps.chats.serializers import MessageSerializer


def _make_token(user):
    """Сгенерировать JWT access-токен для тестового пользователя."""
    from apps.users.jwt_utils import make_access_token
    return make_access_token(user.pk)


def _create_user(phone="79990001122", display_name="Тестовый"):
    return User.objects.create_user(phone=phone, display_name=display_name)


def _create_chat(owner, title="Тестовый чат"):
    from apps.chats.utils import generate_slug, make_verification_code
    slug = generate_slug()
    code = make_verification_code(slug)
    chat = Chat.objects.create(
        title=title, slug=slug, verification_code=code,
        chat_type=Chat.ChatType.OPEN, max_members=DEFAULT_MAX_MEMBERS,
        owner=owner,
    )
    ChatMember.objects.create(
        chat=chat, user=owner,
        role=ChatMember.Role.ADMIN, status=ChatMember.Status.ACTIVE,
    )
    return chat


def _create_file(user, name="photo.jpg", mime="image/jpeg"):
    return FileAttachment.objects.create(
        uploader=user,
        original_name=name,
        file_path=f"chat_uploads/test/{uuid.uuid4().hex}.jpg",
        mime_type=mime,
        size_bytes=1024,
        storage_type=FileAttachment.StorageType.LOCAL,
    )


# ═══════════════════════════════════════════════════════════════
#  Модельные тесты
# ═══════════════════════════════════════════════════════════════

class MessageModelTest(TestCase):
    """Проверка M2M поля files на модели Message."""

    def setUp(self):
        self.user = _create_user()
        self.chat = _create_chat(self.user)

    def test_message_files_m2m_empty_by_default(self):
        """Новое сообщение не имеет прикреплённых файлов."""
        msg = Message.objects.create(
            chat=self.chat, sender=self.user,
            msg_type=Message.MsgType.TEXT, content="hello",
        )
        self.assertEqual(msg.files.count(), 0)
        self.assertIsNone(msg.file)

    def test_message_attach_multiple_files(self):
        """Можно прикрепить несколько файлов через M2M."""
        msg = Message.objects.create(
            chat=self.chat, sender=self.user,
            msg_type=Message.MsgType.FILE, content="photos",
        )
        f1 = _create_file(self.user, "a.jpg")
        f2 = _create_file(self.user, "b.png", "image/png")
        f3 = _create_file(self.user, "c.jpg")
        msg.files.set([f1, f2, f3])

        self.assertEqual(msg.files.count(), 3)
        ids = set(msg.files.values_list("id", flat=True))
        self.assertEqual(ids, {f1.id, f2.id, f3.id})

    def test_message_single_file_backward_compat(self):
        """Одиночный file FK по-прежнему работает."""
        f = _create_file(self.user, "single.jpg")
        msg = Message.objects.create(
            chat=self.chat, sender=self.user,
            msg_type=Message.MsgType.FILE, content="one photo",
            file=f,
        )
        self.assertEqual(msg.file_id, f.id)
        self.assertEqual(msg.files.count(), 0)  # M2M не задан

    def test_file_deletion_does_not_delete_message(self):
        """Удаление файла не удаляет сообщение (SET_NULL)."""
        f = _create_file(self.user, "del.jpg")
        msg = Message.objects.create(
            chat=self.chat, sender=self.user,
            msg_type=Message.MsgType.FILE, content="will be deleted",
            file=f,
        )
        f.delete()
        msg.refresh_from_db()
        self.assertIsNone(msg.file)


# ═══════════════════════════════════════════════════════════════
#  Сериализатор
# ═══════════════════════════════════════════════════════════════

class MessageSerializerTest(TestCase):
    """Тесты MessageSerializer: создание с file_ids и вывод files."""

    def setUp(self):
        self.user = _create_user()
        self.chat = _create_chat(self.user)

    def _ctx(self):
        from rest_framework.test import APIRequestFactory
        factory = APIRequestFactory()
        request = factory.get("/")
        request.user = self.user
        return {"request": request}

    def test_create_message_with_file_ids(self):
        """Serializer.create() прикрепляет файлы через file_ids."""
        f1 = _create_file(self.user, "img1.jpg")
        f2 = _create_file(self.user, "img2.jpg")
        data = {
            "msg_type": "file",
            "content": "img1.jpg, img2.jpg",
            "file_ids": [str(f1.id), str(f2.id)],
        }
        ser = MessageSerializer(data=data, context=self._ctx())
        self.assertTrue(ser.is_valid(), ser.errors)
        msg = ser.save(chat=self.chat, sender=self.user)

        self.assertEqual(msg.files.count(), 2)
        # file FK заполняется автоматически первым файлом
        self.assertIsNotNone(msg.file)
        self.assertIn(msg.file_id, [f1.id, f2.id])

    def test_to_representation_multi_files(self):
        """В ответе files — массив вложенных объектов."""
        f1 = _create_file(self.user, "a.jpg")
        f2 = _create_file(self.user, "b.jpg")
        msg = Message.objects.create(
            chat=self.chat, sender=self.user,
            msg_type=Message.MsgType.FILE, content="multi",
            file=f1,
        )
        msg.files.set([f1, f2])

        data = MessageSerializer(msg, context=self._ctx()).data
        self.assertIn("files", data)
        self.assertEqual(len(data["files"]), 2)
        file_ids_in_response = {f["id"] for f in data["files"]}
        self.assertEqual(file_ids_in_response, {str(f1.id), str(f2.id)})

    def test_to_representation_single_file_compat(self):
        """Если files M2M пусто, но file FK задан — files=[file]."""
        f = _create_file(self.user, "solo.jpg")
        msg = Message.objects.create(
            chat=self.chat, sender=self.user,
            msg_type=Message.MsgType.FILE, content="solo",
            file=f,
        )
        data = MessageSerializer(msg, context=self._ctx()).data
        self.assertIn("files", data)
        self.assertEqual(len(data["files"]), 1)
        self.assertEqual(data["files"][0]["id"], str(f.id))

    def test_to_representation_text_message_empty_files(self):
        """Текстовое сообщение — files пустой массив."""
        msg = Message.objects.create(
            chat=self.chat, sender=self.user,
            msg_type=Message.MsgType.TEXT, content="hello",
        )
        data = MessageSerializer(msg, context=self._ctx()).data
        self.assertEqual(data["files"], [])

    def test_create_message_without_file_ids(self):
        """Создание текстового сообщения без file_ids."""
        data = {"msg_type": "text", "content": "just text"}
        ser = MessageSerializer(data=data, context=self._ctx())
        self.assertTrue(ser.is_valid(), ser.errors)
        msg = ser.save(chat=self.chat, sender=self.user)
        self.assertEqual(msg.files.count(), 0)
        self.assertIsNone(msg.file)

    def test_create_message_ignores_other_users_file_ids(self):
        """Чужие file_ids не привязываются к сообщению (только свои)."""
        other_user = _create_user(phone="+79991112233", display_name="Other")
        my_file = _create_file(self.user, "mine.jpg")
        other_file = _create_file(other_user, "other.jpg")
        data = {
            "msg_type": "file",
            "content": "try attach both",
            "file_ids": [str(my_file.id), str(other_file.id)],
        }
        ser = MessageSerializer(data=data, context=self._ctx())
        self.assertTrue(ser.is_valid(), ser.errors)
        msg = ser.save(chat=self.chat, sender=self.user)
        self.assertEqual(msg.files.count(), 1)
        self.assertEqual(msg.files.get().id, my_file.id)


# ═══════════════════════════════════════════════════════════════
#  REST API тесты
# ═══════════════════════════════════════════════════════════════

class MultiImageAPITest(TestCase):
    """Интеграционные тесты: загрузка файлов + создание мульти-сообщения + получение."""

    def setUp(self):
        self.user = _create_user()
        self.chat = _create_chat(self.user)
        self.client = APIClient()
        self.token = _make_token(self.user)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.token}")

    def _upload_image(self, name="photo.jpg"):
        """Загрузить фейковый JPEG через API."""
        # Минимальный валидный JPEG (SOI + EOI)
        jpeg_bytes = b'\xff\xd8\xff\xe0\x00\x10JFIF\x00' + b'\x00' * 100 + b'\xff\xd9'
        f = SimpleUploadedFile(name, jpeg_bytes, content_type="image/jpeg")
        res = self.client.post(
            "/api/files/upload/",
            {"file": f, "chat_id": str(self.chat.id)},
            format="multipart",
        )
        self.assertEqual(res.status_code, 201, res.data)
        return res.data["id"]

    def test_create_message_with_multiple_images(self):
        """POST message с file_ids — создаёт сообщение с несколькими изображениями."""
        fid1 = self._upload_image("a.jpg")
        fid2 = self._upload_image("b.jpg")
        fid3 = self._upload_image("c.jpg")

        res = self.client.post(
            f"/api/chats/{self.chat.id}/messages/",
            {
                "msg_type": "file",
                "content": "a.jpg, b.jpg, c.jpg",
                "file": fid1,
                "file_ids": [fid1, fid2, fid3],
            },
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.data)
        self.assertIn("files", res.data)
        self.assertEqual(len(res.data["files"]), 3)

        # Проверяем, что file FK тоже заполнен
        self.assertIsNotNone(res.data["file"])

    def test_get_messages_returns_files_array(self):
        """GET messages — каждое сообщение содержит files массив."""
        fid1 = self._upload_image("x.jpg")
        fid2 = self._upload_image("y.jpg")

        # Создаём сообщение с двумя файлами
        self.client.post(
            f"/api/chats/{self.chat.id}/messages/",
            {
                "msg_type": "file",
                "content": "images",
                "file": fid1,
                "file_ids": [fid1, fid2],
            },
            format="json",
        )

        # Создаём текстовое сообщение
        self.client.post(
            f"/api/chats/{self.chat.id}/messages/",
            {"msg_type": "text", "content": "hello"},
            format="json",
        )

        res = self.client.get(f"/api/chats/{self.chat.id}/messages/")
        self.assertEqual(res.status_code, 200)
        msgs = res.data
        self.assertEqual(len(msgs), 2)

        # Первое — мульти-изображение
        img_msg = msgs[0]
        self.assertEqual(len(img_msg["files"]), 2)
        for f in img_msg["files"]:
            self.assertIn("id", f)
            self.assertIn("url", f)
            self.assertIn("original_name", f)
            self.assertIn("mime_type", f)

        # Второе — текст
        txt_msg = msgs[1]
        self.assertEqual(txt_msg["files"], [])

    def test_create_single_file_message_backward_compat(self):
        """Одиночный файл (старый формат) — по-прежнему работает."""
        fid = self._upload_image("single.jpg")
        res = self.client.post(
            f"/api/chats/{self.chat.id}/messages/",
            {"msg_type": "file", "content": "single.jpg", "file_id": fid},
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        # files содержит 1 элемент (из file FK)
        self.assertEqual(len(res.data["files"]), 1)
        self.assertEqual(res.data["files"][0]["id"], fid)

    def test_empty_file_ids_is_ok(self):
        """Пустой file_ids — не ломает запрос."""
        res = self.client.post(
            f"/api/chats/{self.chat.id}/messages/",
            {"msg_type": "text", "content": "no files", "file_ids": []},
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["files"], [])

    def test_unauthorized_user_cannot_send(self):
        """Неавторизованный пользователь — 401."""
        client = APIClient()
        res = client.post(
            f"/api/chats/{self.chat.id}/messages/",
            {"msg_type": "text", "content": "hi"},
            format="json",
        )
        self.assertEqual(res.status_code, 401)

    def test_non_member_cannot_send(self):
        """Пользователь не-участник чата — 403."""
        other = _create_user(phone="79991112233", display_name="Другой")
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {_make_token(other)}")
        res = client.post(
            f"/api/chats/{self.chat.id}/messages/",
            {"msg_type": "text", "content": "sneaky"},
            format="json",
        )
        self.assertEqual(res.status_code, 403)


# ═══════════════════════════════════════════════════════════════
#  Файловый API
# ═══════════════════════════════════════════════════════════════

class FileUploadAPITest(TestCase):
    """Тесты API загрузки файлов."""

    def setUp(self):
        self.user = _create_user()
        self.chat = _create_chat(self.user)
        self.client = APIClient()
        self.token = _make_token(self.user)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.token}")

    def test_upload_file_success(self):
        """Файл загружается и возвращает id, url, original_name."""
        content = b'\xff\xd8\xff\xe0\x00\x10JFIF\x00' + b'\x00' * 50 + b'\xff\xd9'
        f = SimpleUploadedFile("test.jpg", content, content_type="image/jpeg")
        res = self.client.post(
            "/api/files/upload/",
            {"file": f, "chat_id": str(self.chat.id)},
            format="multipart",
        )
        self.assertEqual(res.status_code, 201)
        self.assertIn("id", res.data)
        self.assertIn("url", res.data)
        self.assertEqual(res.data["original_name"], "test.jpg")
        self.assertEqual(res.data["mime_type"], "image/jpeg")

    def test_upload_without_file_returns_400(self):
        """Запрос без файла — 400."""
        res = self.client.post("/api/files/upload/", {}, format="multipart")
        self.assertEqual(res.status_code, 400)

    def test_file_serve_with_valid_token(self):
        """Доступ к файлу по валидному HMAC-токену."""
        content = b'\xff\xd8\xff\xe0' + b'\x00' * 50 + b'\xff\xd9'
        f = SimpleUploadedFile("serve.jpg", content, content_type="image/jpeg")
        upload_res = self.client.post(
            "/api/files/upload/",
            {"file": f, "chat_id": str(self.chat.id)},
            format="multipart",
        )
        file_url = upload_res.data["url"]
        # URL вида /api/files/<uuid>/?t=<token>
        serve_res = self.client.get(file_url)
        self.assertEqual(serve_res.status_code, 200)

    def test_file_serve_without_token_returns_403(self):
        """Доступ к файлу без токена — 403."""
        att = _create_file(self.user, "secret.jpg")
        res = self.client.get(f"/api/files/{att.id}/")
        self.assertEqual(res.status_code, 403)

class ChatPinOrderApiTest(TestCase):
    def setUp(self):
        self.user = _create_user(phone="79990005566", display_name="Pins")
        self.chat1 = _create_chat(self.user, title="Pin A")
        self.chat2 = _create_chat(self.user, title="Pin B")
        self.chat3 = _create_chat(self.user, title="Pin C")
        from apps.payments.models import UserSubscription
        UserSubscription.objects.create(user=self.user)
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {_make_token(self.user)}")

    def test_set_pins_persists_order(self):
        res = self.client.post(
            "/api/chats/pins/",
            {"chat_ids": [str(self.chat2.id), str(self.chat1.id)]},
            format="json",
        )
        self.assertEqual(res.status_code, 200, getattr(res, "data", None))
        self.assertEqual(res.data["pinned_chat_ids"], [str(self.chat2.id), str(self.chat1.id)])

        m1 = ChatMember.objects.get(chat=self.chat1, user=self.user)
        m2 = ChatMember.objects.get(chat=self.chat2, user=self.user)
        m3 = ChatMember.objects.get(chat=self.chat3, user=self.user)
        self.assertEqual(m2.pin_order, 1)
        self.assertEqual(m1.pin_order, 2)
        self.assertIsNone(m3.pin_order)

    def test_list_chats_contains_pin_order(self):
        ChatMember.objects.filter(chat=self.chat3, user=self.user).update(pin_order=1)
        ChatMember.objects.filter(chat=self.chat1, user=self.user).update(pin_order=2)

        res = self.client.get("/api/chats/")
        self.assertEqual(res.status_code, 200, getattr(res, "data", None))
        data = res.data if isinstance(res.data, list) else res.data.get("results", [])
        by_id = {item["id"]: item for item in data}
        self.assertEqual(by_id[str(self.chat3.id)]["pin_order"], 1)
        self.assertEqual(by_id[str(self.chat1.id)]["pin_order"], 2)
        self.assertIsNone(by_id[str(self.chat2.id)]["pin_order"])
