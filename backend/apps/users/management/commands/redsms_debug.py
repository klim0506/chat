"""
Диагностика RedSMS: один запрос и полный вывод ответа.
Запуск: python manage.py redsms_debug +79256182104
"""
import hashlib
import json
import os
import time

import requests
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Отправить тестовое SMS через RedSMS и вывести полный ответ API."

    def add_arguments(self, parser):
        parser.add_argument("phone", type=str, nargs="?", default="+79256182104", help="Номер телефона")
        parser.add_argument("--text", type=str, default="Тест RedSMS", help="Текст сообщения")

    def handle(self, *args, **options):
        phone = options["phone"].strip()
        if not phone.startswith("+"):
            phone = "+" + phone
        text = options["text"]

        login = os.environ.get("REDSMS_LOGIN", "")
        api_key = os.environ.get("REDSMS_API_KEY", "")
        from_name = os.environ.get("REDSMS_FROM", "REDSMS.RU") or "REDSMS.RU"

        self.stdout.write(f"Login: {login}")
        self.stdout.write(f"From (REDSMS_FROM): {from_name}")
        self.stdout.write(f"To: {phone}")
        self.stdout.write(f"Text: {text}")
        if not api_key:
            self.stdout.write(self.style.ERROR("REDSMS_API_KEY не задан в .env"))
            return
        self.stdout.write("API key: ***задан***")

        ts = str(int(time.time()))
        secret = hashlib.md5((ts + api_key).encode()).hexdigest()
        headers = {"login": login, "ts": ts, "secret": secret, "Content-Type": "application/json"}
        payload = {"route": "sms", "from": from_name, "to": phone, "text": text}
        url = "https://cp.redsms.ru/api/message"

        self.stdout.write("\n--- Запрос ---")
        self.stdout.write(f"POST {url}")
        self.stdout.write(json.dumps(payload, ensure_ascii=False, indent=2))

        try:
            r = requests.post(url, headers=headers, json=payload, timeout=15)
            self.stdout.write("\n--- Ответ ---")
            self.stdout.write(f"HTTP status: {r.status_code}")
            try:
                body = r.json()
                self.stdout.write(json.dumps(body, ensure_ascii=False, indent=2))
                if r.status_code == 200 and body.get("success") and not body.get("errors"):
                    self.stdout.write(self.style.SUCCESS("\nСообщение принято в очередь (status=created)."))
                    items = body.get("items") or []
                    if items:
                        self.stdout.write(f"UUID: {items[0].get('uuid')}, status: {items[0].get('status')}")
                else:
                    self.stdout.write(self.style.ERROR("\nОшибка или предупреждение в ответе. Проверьте balance, имя отправителя в ЛК RedSMS."))
            except Exception:
                self.stdout.write(r.text or "(пусто)")
        except requests.exceptions.ProxyError as e:
            self.stdout.write(self.style.ERROR(f"Прокси/сеть: {e}"))
            self.stdout.write("Убедитесь, что запросы к cp.redsms.ru не идут через блокирующий прокси, или запустите команду в среде без прокси.")
        except Exception as e:
            self.stdout.write(self.style.ERROR(f"Ошибка запроса: {e}"))
