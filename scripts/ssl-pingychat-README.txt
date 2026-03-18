# Куда положить ваши сертификаты на сервере

Файлы с ПК (certificate.crt, certificate.key, certificate_ca.crt) нужно загрузить на сервер.

1) Загрузите на сервер в каталог /etc/ssl/pingychat/:
   - certificate.crt
   - certificate.key
   - certificate_ca.crt

   Например с вашего ПК (PowerShell или cmd):
   scp "c:\Users\klims\Downloads\Telegram Desktop\certificate.crt" root@ВАШ_IP:/etc/ssl/pingychat/
   scp "c:\Users\klims\Downloads\Telegram Desktop\certificate.key" root@ВАШ_IP:/etc/ssl/pingychat/
   scp "c:\Users\klims\Downloads\Telegram Desktop\certificate_ca.crt" root@ВАШ_IP:/etc/ssl/pingychat/

2) На сервере выполните:
   sudo bash -c 'cat /etc/ssl/pingychat/certificate.crt /etc/ssl/pingychat/certificate_ca.crt > /etc/ssl/pingychat/fullchain.crt'
   sudo mv /etc/ssl/pingychat/certificate.key /etc/ssl/pingychat/privkey.key
   sudo chmod 600 /etc/ssl/pingychat/privkey.key
   sudo chmod 644 /etc/ssl/pingychat/fullchain.crt

3) Проверьте nginx и перезагрузите:
   sudo nginx -t && sudo systemctl reload nginx
