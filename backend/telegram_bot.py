"""
Simple Telegram bot for auth code confirmation.

Polls Telegram for new messages. When a user sends a 6-character
alphanumeric code, the bot forwards it to the backend's
/api/auth/telegram/confirm/ endpoint, linking the code to the
user's Telegram account.
"""

import os
import re
import sys
import time
import logging
import requests
from pathlib import Path
from dotenv import load_dotenv

# Load .env from the same directory as this script
load_dotenv(Path(__file__).resolve().parent / ".env")

BOT_TOKEN = os.environ.get("TELEGRAM_BOT_SECRET", "")
BOT_SECRET = BOT_TOKEN  # same value used as shared secret for backend
BACKEND_URL = os.environ.get("BACKEND_URL", "http://127.0.0.1:8000")
CONFIRM_ENDPOINT = f"{BACKEND_URL}/api/auth/telegram/confirm/"

TELEGRAM_API = f"https://api.telegram.org/bot{BOT_TOKEN}"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger("tg_bot")

CODE_RE = re.compile(r"^[A-Z0-9]{4,8}$")


def get_updates(offset: int | None = None, timeout: int = 30) -> list[dict]:
    """Long-poll Telegram for new updates."""
    params: dict = {"timeout": timeout, "allowed_updates": ["message"]}
    if offset is not None:
        params["offset"] = offset
    try:
        resp = requests.get(f"{TELEGRAM_API}/getUpdates", params=params, timeout=timeout + 10)
        data = resp.json()
        if data.get("ok"):
            return data.get("result", [])
        log.error("getUpdates error: %s", data)
    except requests.RequestException as e:
        log.error("getUpdates request failed: %s", e)
    return []


def send_message(chat_id: int, text: str):
    """Send a text message to a Telegram chat."""
    try:
        requests.post(
            f"{TELEGRAM_API}/sendMessage",
            json={"chat_id": chat_id, "text": text, "parse_mode": "HTML"},
            timeout=10,
        )
    except requests.RequestException as e:
        log.error("sendMessage failed: %s", e)


def confirm_code(code: str, telegram_id: int, username: str) -> bool:
    """Call the backend confirm endpoint."""
    try:
        resp = requests.post(
            CONFIRM_ENDPOINT,
            json={
                "code": code,
                "telegram_id": telegram_id,
                "username": username,
            },
            headers={
                "X-Bot-Secret": BOT_SECRET,
                "Content-Type": "application/json",
            },
            timeout=10,
        )
        log.info(
            "confirm_code(%s, tg_id=%s) -> %s %s",
            code, telegram_id, resp.status_code, resp.text[:200],
        )
        return resp.status_code == 200
    except requests.RequestException as e:
        log.error("confirm_code request failed: %s", e)
        return False


def handle_message(message: dict):
    """Process a single incoming message."""
    chat_id = message["chat"]["id"]
    from_user = message.get("from", {})
    telegram_id = from_user.get("id")
    username = from_user.get("username", "")
    text = (message.get("text") or "").strip()

    # /start command
    if text.lower().startswith("/start"):
        send_message(
            chat_id,
            "Привет! Отправьте мне код авторизации с сайта, "
            "и я подтвержу ваш вход.",
        )
        return

    # Check if text looks like an auth code
    upper = text.upper()
    if CODE_RE.match(upper):
        log.info("Code received: %s from tg_id=%s (@%s)", upper, telegram_id, username)
        ok = confirm_code(upper, telegram_id, username)
        if ok:
            send_message(
                chat_id,
                "Код принят! Вернитесь на сайт и нажмите «Проверить».",
            )
        else:
            send_message(
                chat_id,
                "Код не найден или уже использован. "
                "Запросите новый код на сайте и отправьте его мне.",
            )
    else:
        send_message(
            chat_id,
            "Отправьте мне 6-символьный код авторизации с сайта.",
        )


def main():
    if not BOT_TOKEN:
        log.error("TELEGRAM_BOT_SECRET is not set in .env")
        sys.exit(1)

    # Verify bot token
    try:
        resp = requests.get(f"{TELEGRAM_API}/getMe", timeout=10)
        me = resp.json()
        if me.get("ok"):
            bot_info = me["result"]
            log.info(
                "Bot started: @%s (id=%s)",
                bot_info.get("username"),
                bot_info.get("id"),
            )
        else:
            log.error("getMe failed: %s", me)
            sys.exit(1)
    except requests.RequestException as e:
        log.error("Cannot connect to Telegram API: %s", e)
        sys.exit(1)

    log.info("Listening for messages... (Ctrl+C to stop)")

    offset = None
    while True:
        updates = get_updates(offset=offset)
        for update in updates:
            offset = update["update_id"] + 1
            msg = update.get("message")
            if msg:
                try:
                    handle_message(msg)
                except Exception:
                    log.exception("Error handling message: %s", msg)
        if not updates:
            time.sleep(1)


if __name__ == "__main__":
    main()
