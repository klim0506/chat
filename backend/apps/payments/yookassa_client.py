import os
from django.conf import settings
from yookassa import Payment, Configuration


def configure():
    shop_id = os.environ.get("YOOKASSA_SHOP_ID") or getattr(settings, "YOOKASSA_SHOP_ID", "")
    secret = os.environ.get("YOOKASSA_SECRET_KEY") or getattr(settings, "YOOKASSA_SECRET_KEY", "")
    if shop_id and secret:
        Configuration.configure(shop_id, secret)


def create_payment(amount_rubles: float, return_url: str, description: str, save_payment_method: bool = True, metadata: dict | None = None):
    configure()
    payload = {"amount": {"value": f"{amount_rubles:.2f}", "currency": "RUB"}, "confirmation": {"type": "redirect", "return_url": return_url}, "capture": True, "description": description, "save_payment_method": save_payment_method, "metadata": metadata or {}}
    return Payment.create(payload)


def create_recurring_payment(amount_rubles: float, payment_method_id: str, description: str, metadata: dict | None = None):
    configure()
    payload = {"amount": {"value": f"{amount_rubles:.2f}", "currency": "RUB"}, "payment_method_id": payment_method_id, "capture": True, "description": description, "metadata": metadata or {}}
    return Payment.create(payload)


def get_payment(payment_id: str):
    configure()
    return Payment.find_one(payment_id)
