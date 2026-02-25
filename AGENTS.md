# Agents

## Cursor Cloud specific instructions

### Overview
Pingy is a real-time chat platform with a Django backend (REST API + WebSocket via Daphne) and a Vite/React TypeScript frontend. The root `package.json` contains orchestration scripts and legacy Next.js deps (unused).

### Services

| Service | Dir | Dev command | Port |
|---------|-----|-------------|------|
| Backend | `backend/` | `source backend/.venv/bin/activate && DJANGO_SETTINGS_MODULE=config.settings.dev python backend/manage.py runserver 0.0.0.0:8000` | 8000 |
| Frontend | `frontend/` | `cd frontend && npx vite --host 0.0.0.0` | 5173 |

### Backend dev setup (SQLite mode, no Docker required)
- The backend `.env` file at `backend/.env` must exist. Copy from `backend/.env.example` and set `USE_SQLITE=True` to skip Postgres/Docker.
- Set `AUTH_DEBUG=True`, `AUTH_DEBUG_PHONES=+10000000000`, `AUTH_DEBUG_CODE=123456` for phone auth without real SMS.
- The backend auto-detects Redis availability and falls back to `InMemoryChannelLayer` + synchronous Celery when Redis is absent.
- Run migrations: `cd backend && source .venv/bin/activate && DJANGO_SETTINGS_MODULE=config.settings.dev python manage.py migrate`

### Lint / Test / Build
- **Frontend TypeScript check:** `cd frontend && npx tsc --noEmit` (do NOT use `tsc -b --noEmit` — it errors on the project-references config)
- **Frontend unit tests:** `cd frontend && npx vitest run` (43 tests)
- **Frontend build:** `cd frontend && npm run build`
- **Django system check:** `cd backend && source .venv/bin/activate && DJANGO_SETTINGS_MODULE=config.settings.dev python manage.py check`

### Gotchas
- The root `package.json` has Next.js deps and `npm run dev` runs `next dev`. This is legacy/unused. The real frontend is the Vite SPA in `frontend/`.
- The `run:backend` script in root `package.json` uses Windows-style env-var syntax (`set VAR=val&&`). On Linux, use `DJANGO_SETTINGS_MODULE=config.settings.dev` prefix instead.
- Backend `.env` `AUTH_DEBUG_CODE` must be exactly 6 characters (the verify endpoint validates minimum length).
- After changing `backend/.env`, the Django dev server must be manually restarted (it does not auto-reload on `.env` changes).
