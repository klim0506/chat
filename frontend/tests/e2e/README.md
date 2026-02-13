# E2E (Playwright)

Покрытие: real-time коммуникация между двумя аккаунтами:
- появление нового чата в списке;
- бейджи непрочитанных;
- стабильный порядок закреплённых чатов.

## Переменные окружения

```bash
E2E_BASE_URL=http://localhost:5173
E2E_API_URL=http://localhost:8000/api
E2E_USER_1_PHONE=+71111111111
E2E_USER_2_PHONE=+72222222222
E2E_USER_1_CODE=123456
E2E_USER_2_CODE=123456
```

## Запуск

```bash
cd frontend
npm run test:e2e:install
npm run test:e2e
```

