@echo off
chcp 65001 >nul
cd /d "%~dp0..\..\backend"
echo Starting Celery worker. Requires Redis.
echo On Windows, run run_celery_beat.bat in another terminal for scheduled tasks.
celery -A config worker -l info
pause
