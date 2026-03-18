#!/bin/bash
# Переключение nginx на ваши сертификаты.
# Положите в /etc/ssl/pingychat/: certificate.crt, certificate.key, certificate_ca.crt
# Запуск: sudo /root/chat/scripts/switch-to-own-ssl.sh

set -euo pipefail
DIR=/etc/ssl/pingychat
CONF=/etc/nginx/conf.d/pingychat-docker.conf

for f in "$DIR/certificate.crt" "$DIR/certificate.key" "$DIR/certificate_ca.crt"; do
  if [[ ! -f "$f" ]]; then
    echo "Не найден файл: $f"
    echo "Скопируйте certificate.crt, certificate.key, certificate_ca.crt в $DIR"
    exit 1
  fi
done

cat "$DIR/certificate.crt" "$DIR/certificate_ca.crt" > "$DIR/fullchain.crt"
cp -f "$DIR/certificate.key" "$DIR/privkey.key"
chmod 644 "$DIR/fullchain.crt"
chmod 600 "$DIR/privkey.key"

sed -i 's|ssl_certificate .*|ssl_certificate /etc/ssl/pingychat/fullchain.crt;|' "$CONF"
sed -i 's|ssl_certificate_key .*|ssl_certificate_key /etc/ssl/pingychat/privkey.key;|' "$CONF"

nginx -t && systemctl reload nginx
echo "Готово: nginx переведён на ваши сертификаты."
