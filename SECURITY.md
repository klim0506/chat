# Безопасность

## Аудит зависимостей

Рекомендуется периодически проверять зависимости на известные уязвимости.

### Backend (Python)

```bash
cd backend
pip install pip-audit
pip-audit
```

Исправление: обновить пакеты в `requirements.txt` и переустановить зависимости. При необходимости использовать `pip-audit -r requirements.txt --fix`.

### Frontend (Node)

```bash
cd frontend
npm audit
npm audit fix   # по возможности автоматическое обновление
```

## Тесты безопасности

Регрессионные тесты по безопасности находятся в приложениях:

- **apps.users.tests_security** — JWT (refresh не принимается как access), rate limit для auth
- **apps.files.tests_security** — токен доступа к файлам (срок действия, подпись), обязательная авторизация загрузки
- **apps.payments.tests_security** — webhook (валюта/сумма, идемпотентность), валидация return_url

Запуск всех тестов:

```bash
cd backend
python manage.py test apps.users.tests_security apps.files.tests_security apps.payments.tests_security apps.chats.tests
```

## Rate limiting

- **send-code**: 5 запросов/мин с IP
- **verify-code**: 15 запросов/мин с IP
- **refresh**: 30 запросов/мин с IP
- **payments/webhook**: 60 запросов/мин с IP

Лимиты задаются в `config.settings.base.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]`. Для работы throttle при наличии Redis используется кэш (Redis); без Redis — локальная память (LimMemCache).
