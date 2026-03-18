#!/bin/bash
# Restore ISP Manager nginx config for pingychat.com (proxy to Docker on 9081).
# Run after ISP Manager overwrites the config: sudo bash scripts/restore-pingychat-nginx.sh
set -e
BACKUP="/root/chat-app/docker/nginx/ispmanager-pingychat.com.conf.backup"
TARGET="/etc/nginx/vhosts/www-root/pingychat.com.conf"
cp "$BACKUP" "$TARGET"
nginx -t
systemctl reload nginx
echo "Restored $TARGET and reloaded nginx."
