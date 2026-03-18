#!/bin/bash
# Install SSH config to allow key-only auth and prohibit root password login.
# Run ONLY after you have verified SSH key login in a second terminal:
#   ssh -i ~/.ssh/your_key user@server
# Then run this script as root. If you run it without key access, you may lock yourself out.
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "This will set PasswordAuthentication no and PermitRootLogin prohibit-password."
echo "Ensure you have tested SSH key login in another session first."
read -p "Continue? [y/N] " -n 1 -r
echo
if [[ ! $REPLY =~ ^[yY]$ ]]; then
  exit 0
fi
cp "$SCRIPT_DIR/ssh/50-security-keys-only.conf" /etc/ssh/sshd_config.d/50-security-keys-only.conf
systemctl restart sshd
echo "SSH config installed. Keep your current session open until you verify new login works."
