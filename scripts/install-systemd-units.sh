#!/bin/bash
# Install PingyChat systemd units with User=pingychat.
# Run as root or with sudo.
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cp "$SCRIPT_DIR/systemd/pingychat-backend.service" /etc/systemd/system/
cp "$SCRIPT_DIR/systemd/pingychat-celery.service" /etc/systemd/system/
systemctl daemon-reload
echo "Units installed. Restart with: systemctl restart pingychat-backend pingychat-celery"
