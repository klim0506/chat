# Telegram Gateway: продакшен без VPN на основном сервере

Если основной сервер находится в сети, где **исходящий HTTPS до `gatewayapi.telegram.org` недоступен** (таймаут TLS, фильтрация), а SMS и остальной бэкенд должны оставаться на месте, есть два рабочих подхода:

| Подход | Суть | Когда уместно |
|--------|------|----------------|
| **A. Весь стек в «открытом» регионе** | Бэкенд, БД, Redis, Celery — на VPS/облаке, где Telegram API доступен напрямую. | Новый деплой, готовность перенести данные и домен, единая инфраструктура. |
| **B. Микросервис только для отправки кода** | Основной Django остаётся на текущем сервере; лёгкий сервис в другом регионе **только** вызывает Telegram Gateway; основной бэкенд дергает его по HTTPS с секретом. | Уже есть прод в «закрытой» сети, нужен минимальный сдвиг. |

Ниже — пошаговая реализация обоих вариантов. Отправка кода в проекте сосредоточена в `send_telegram_verification` (`backend/apps/users/services.py`) и вызывается из `SendCodeView` (`backend/apps/users/views.py`).

---

## Вариант A: развернуть backend в регионе с доступом к Telegram

### Идея

Пока приложение работает на машине, которая **может** установить TLS-сессию с `https://gatewayapi.telegram.org`, текущий код **менять не нужно**: `send_telegram_verification` уже ходит в официальный API.

### Шаги

1. **Выбор площадки**  
   VPS или облако в регионе, где нет блокировки Telegram (типично датацентры в ЕС, США и т.д., не РФ/не «проблемный» ISP). Проверка с будущего сервера:
   ```bash
   curl -sS --max-time 15 -o /dev/null -w "%{http_code}\n" https://gatewayapi.telegram.org/
   ```
   Ожидается не таймаут (код ответа может быть 404/405 — не важно, важно установить соединение).

2. **Перенос окружения**  
   Те же зависимости, что и сейчас: Docker Compose или ручной стек (PostgreSQL, Redis, Gunicorn/Daphne, Celery), переменные из `.env`, в том числе `TELEGRAM_GATEWAY_TOKEN`.

3. **Секреты**  
   `TELEGRAM_GATEWAY_TOKEN` хранить только на новом хосте (vault, зашифрованные секреты облака, не коммит в git).

4. **Домен и TLS**  
   Обновить DNS A/AAAA на новый IP, выпустить сертификат (Let’s Encrypt), как в [web.pingychat.com-setup.md](web.pingychat.com-setup.md) или вашем чеклисте релиза.

5. **Данные**  
   Миграция БД (дамп/restore), при необходимости — перенос файлов медиа и согласование downtime.

### Плюсы и минусы

- **Плюсы:** нет второго сервиса, код приложения не усложняется.  
- **Минусы:** полный перенос инфраструктуры и ответственность за доступность нового региона.

---

## Вариант B: отдельный микросервис «отправка кода в Telegram»

### Идея

- **Сервер A (текущий):** Django, Redis, OTP, SMS, всё как сейчас. **Прямых** запросов к `gatewayapi.telegram.org` с A **нет**.
- **Сервер B (маленький VPS за границей):** один процесс с HTTP endpoint, внутри — тот же вызов, что и в `send_telegram_verification`: `POST https://gatewayapi.telegram.org/sendVerificationMessage` с `Authorization: Bearer <TELEGRAM_GATEWAY_TOKEN>`.

Схема:

```
[Клиент] → HTTPS → [nginx / Django на сервере A]
                         │
                         │ POST /internal/send-telegram-code
                         │ (секрет + phone + code + ttl)
                         ▼
                   [Сервис на сервере B] → gatewayapi.telegram.org → пользователь в Telegram
```

### Требования к безопасности

1. **Только HTTPS** между A и B (или приватная сеть/VPN между серверами — ещё лучше).
2. **Аутентификация:** общий секрет в заголовке (`X-Internal-Secret: …`) или **HMAC** по телу запроса (timestamp + phone + code), чтобы нельзя было подделать запрос снаружи.
3. **Сеть:** на B firewall: входящий 443 **только** с IP сервера A (или с диапазона вашего облака).
4. **Токен Telegram** хранится **только на B**; на A переменная `TELEGRAM_GATEWAY_TOKEN` **не нужна** (или пустая, если код переключён на прокси-вызов).

### Реализация сервиса на B (минимальный пример)

Любой стек: FastAPI, Flask, Node. Контракт запроса — как в [документации Gateway](https://core.telegram.org/gateway/api): `phone_number`, `code`, `ttl` (30–3600 сек).

Пример **FastAPI** (установка: `pip install fastapi uvicorn httpx`):

```python
# main.py — только идея, адаптируйте под свой деплой
import os
import httpx
from fastapi import FastAPI, Header, HTTPException

app = FastAPI()
INTERNAL_SECRET = os.environ["INTERNAL_SECRET"]  # длинная случайная строка
TG_TOKEN = os.environ["TELEGRAM_GATEWAY_TOKEN"]
TG_URL = "https://gatewayapi.telegram.org/sendVerificationMessage"

@app.post("/send-telegram-code")
async def send(
    body: dict,
    x_internal_secret: str | None = Header(None, alias="X-Internal-Secret"),
):
    if x_internal_secret != INTERNAL_SECRET:
        raise HTTPException(status_code=401, detail="Unauthorized")
    phone = body.get("phone_number", "").strip()
    code = str(body.get("code", ""))
    ttl = int(body.get("ttl", 300))
    if not phone.startswith("+"):
        phone = "+" + phone
    async with httpx.AsyncClient(timeout=20.0) as client:
        r = await client.post(
            TG_URL,
            headers={
                "Authorization": f"Bearer {TG_TOKEN}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            json={"phone_number": phone, "code": code, "ttl": ttl},
        )
    data = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
    if r.status_code == 200 and data.get("ok"):
        return {"ok": True, "result": data.get("result", {})}
    raise HTTPException(status_code=502, detail=data)
```

Запуск: `uvicorn main:app --host 127.0.0.1 --port 8001` за **nginx** с TLS и ограничением доступа по IP.

### Изменения в Django (сервер A)

1. **Настройки** (например `settings/prod.py` или переменные окружения):
   - `TELEGRAM_GATEWAY_PROXY_URL` — базовый URL сервиса B, например `https://tg-gateway.example.com`
   - `TELEGRAM_GATEWAY_PROXY_SECRET` — тот же `INTERNAL_SECRET`, что на B
   - Удалить или не задавать `TELEGRAM_GATEWAY_TOKEN` на A, если токен только на B

2. **Логика в `send_telegram_verification`** (концепция):
   - если задан `TELEGRAM_GATEWAY_PROXY_URL` — выполнить `requests.post(f"{proxy_url}/send-telegram-code", headers={"X-Internal-Secret": secret}, json={...}, timeout=...)`;
   - иначе — текущий прямой вызов к `gatewayapi.telegram.org` (как сейчас).

3. **Обработка ответа:** как сейчас — успех при `ok` и сохранение OTP на A; при 401/502 — логирование и тот же fallback/503, что уже есть в `SendCodeView`.

4. **Тесты:** замокать HTTP к прокси так же, как сейчас мокается `send_telegram_verification` в `tests_security.py`.

### Деплой B

1. Минимальная ВМ (1 vCPU / 512 MB–1 GB RAM достаточно).
2. Ubuntu LTS, `ufw allow from A_IP to any port 443`, `ufw enable`.
3. Certbot для домена только для этого сервиса.
4. Systemd unit для uvicorn/gunicorn.
5. Мониторинг: health endpoint и алерт при 5xx.

### Плюсы и минусы варианта B

- **Плюсы:** основной прод не едет; токен Gateway не лежит на «закрытом» сервере; легко сменить B без трогания БД.  
- **Минусы:** ещё один хост, ещё один TLS и секрет; задержка + один сетевой hop; при падении B — Telegram-канал недоступен (как и при прямом падении API), при этом SMS-fallback на A по-прежнему зависит от логики в `views.py`.

---

## Проверка после внедрения

1. С сервера A (или только B для варианта B):
   ```bash
   curl -sS --max-time 20 https://gatewayapi.telegram.org/ ...
   ```
2. Полный сценарий: запрос кода на тестовый номер с привязкой к Telegram → код приходит в приложение Telegram.
3. Убедиться, что rate limit и OTP в Redis по-прежнему на A и не дублируются на B (B **не** хранит коды — только пересылает в Gateway).

---

## Связанные файлы в репозитории

| Файл | Роль |
|------|------|
| `backend/apps/users/services.py` | `send_telegram_verification`, TTL, повторы |
| `backend/apps/users/views.py` | `SendCodeView` — порядок Telegram → ошибка / SMS fallback |
| `backend/.env` | `TELEGRAM_GATEWAY_TOKEN` (только там, где реально вызывается API) |

Официальные ссылки: [Telegram Gateway API](https://core.telegram.org/gateway/api), личный кабинет: [gateway.telegram.org](https://gateway.telegram.org).
