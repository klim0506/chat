# SSH and Browser Automation — Reference

## Скрипт скриншота (scripts/capture_screenshot.js)

Сохраняет страницу по URL в PNG. Агент запускает через терминал.

**Зависимости** (один раз): `npm install playwright` и `npx playwright install chromium` в каталоге, откуда запускается скрипт, или глобально.

**Вызов**:
```bash
node .cursor/skills/ssh-browser-automation/scripts/capture_screenshot.js "https://example.com" screenshot.png
```
Аргументы: URL (обязательно), путь к файлу (по умолчанию `screenshot.png`). Вывод: `OK: путь` или сообщение об ошибке в stderr, код выхода 1 при сбое.

## SSH: типичные проблемы

| Симптом | Проверить |
|--------|-----------|
| Permission denied (publickey) | Ключ добавлен: `ssh-add -l`, ключ на сервере в `~/.ssh/authorized_keys` |
| Connection refused | Сервис sshd на сервере, firewall, правильный порт `-p PORT` |
| Команда не найдена | PATH в non-interactive shell: указать полный путь или `source ~/.profile && cmd` |
| Таймаут | Сеть, VPN, доступность хоста |

## Browser MCP: напоминание

- `browser_snapshot` возвращает текст/структуру страницы и refs; для PNG-файла используется отдельный скрипт.
- Путь к скрипту указывать с прямыми слэшами: `scripts/capture_screenshot.js`.
