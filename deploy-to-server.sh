#!/bin/bash
# Deploy script for chat server - run as root on 109.172.100.103
set -e

echo "=== Step 2: Clone repo (branch release/v1-prod) ==="
cd /root && rm -rf chat-repo && git clone -b release/v1-prod --depth 1 https://github.com/klim0506/chat.git chat-repo

echo "=== Step 3: Copy files ==="
cp -r /root/chat-repo/backend/* /root/chat-app/backend/
cp -r /root/chat-repo/frontend/* /root/chat-app/frontend/
cp /root/chat-repo/ТЕЛЕГА.ico /root/chat-app/

echo "=== Step 4: Check .env ==="
if [ -f /root/chat-app/backend/.env ]; then
  echo ".env exists - NOT overwriting"
  ls -la /root/chat-app/backend/.env
else
  echo "WARNING: No .env file found"
fi

echo "=== Step 5: Install backend deps ==="
cd /root/chat-app/backend && source .venv/bin/activate && pip install -r requirements.txt

echo "=== Step 6: Migrate ==="
cd /root/chat-app/backend && source .venv/bin/activate && python manage.py migrate

echo "=== Step 7: Build frontend ==="
cd /root/chat-app/frontend && npm install && npm run build

echo "=== Step 8: Nginx static config ==="
ls -la /etc/nginx/sites-enabled/ 2>/dev/null || true
ls -la /etc/nginx/conf.d/ 2>/dev/null || true
for f in /etc/nginx/sites-enabled/* /etc/nginx/conf.d/*; do
  [ -f "$f" ] && grep -E "root|alias|location" "$f" 2>/dev/null || true
done

echo "=== Step 9: Restart services ==="
systemctl start chat-backend chat-celery chat-celery-beat
systemctl reload nginx

echo "=== Step 10: Status ==="
systemctl status chat-backend chat-celery chat-celery-beat --no-pager

echo "=== Step 11: Cleanup ==="
rm -rf /root/chat-repo

echo "=== DONE ==="
