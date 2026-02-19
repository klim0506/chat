# Windows batch scripts

Development scripts for Windows. Run from project root, e.g. `scripts\win\start.bat`.

| Script | Description |
|--------|-------------|
| `start.bat` | Full stack: migrations, backend, Celery, frontend |
| `start_postgres.bat` | Start PostgreSQL via Docker, switch .env |
| `run_backend.bat` | Django runserver only |
| `run_frontend.bat` | Vite dev server only |
| `run_celery.bat` | Celery worker |
| `run_celery_beat.bat` | Celery beat scheduler |
| `kill_backend_frontend.bat` | Stop processes on ports 8000, 5173 |
| `reset_db_full.bat` | Delete SQLite, migrate, run tests |
| `reset_and_test.bat` | Clear data, migrate, run tests |
