@echo off
chcp 65001 >nul
cd /d "%~dp0backend"
echo Starting Celery worker. Requires Redis.
echo On Windows, beat does not run in the same process. Start beat in another terminal: run_celery_beat.bat
celery -A config worker -l info
pause
