"""
Отправка тестового SMS на указанный номер (RedSMS HTTP, без SMPP/Telegram).
Использование: python manage.py send_test_sms +79256182104
"""
from django.core.management.base import BaseCommand

from apps.users.services import generate_code, send_sms_redsms, set_otp


class Command(BaseCommand):
    help = "Отправить тестовый код на номер по SMS (RedSMS HTTP)."

    def add_arguments(self, parser):
        parser.add_argument("phone", type=str, help="Номер в формате +79XXXXXXXXX")

    def handle(self, *args, **options):
        phone = options["phone"].strip()
        if not phone.startswith("+"):
            phone = "+" + phone
        code = generate_code(6)
        text = f"Код для входа: {code}"
        self.stdout.write(f"Отправка на {phone}: {text}")
        ok = send_sms_redsms(phone, text)
        if ok:
            set_otp(phone, code)
            self.stdout.write(self.style.SUCCESS(f"Код отправлен. Код: {code} (сохранён для входа)."))
        else:
            self.stdout.write(self.style.ERROR("Не удалось отправить SMS. Проверьте логи и .env (REDSMS_*)."))
