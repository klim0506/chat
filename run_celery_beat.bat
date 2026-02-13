@echo off
chcp 65001 >nul
cd /d "%~dp0backend"
echo Starting Celery beat (scheduler). Requires Redis. Keep this window open.
celery -A config beat -l info
pause
