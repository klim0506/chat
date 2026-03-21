#!/bin/sh
set -e
# Celery worker/beat — без миграций и collectstatic (делает backend)
case "$1" in
  celery)
    exec "$@"
    ;;
esac
python manage.py migrate --no-input
python manage.py collectstatic --no-input
exec "$@"
