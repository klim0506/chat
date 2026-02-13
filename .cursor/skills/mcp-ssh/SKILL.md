---
name: mcp-ssh
description: Uses SSH MCP server to run commands on remote hosts via persistent sessions. Use when the user needs to execute commands on a remote server over SSH, manage SSH hosts, or maintain shell state between commands.
---

# SSH MCP

Выполнение команд на удалённых серверах через MCP. Поддерживаются два варианта: **ssh-mcp-sessions** (рекомендуется, уже в mcp.json) и **ssh-mcp** (один хост в конфиге).

## ssh-mcp-sessions (в Cursor)

Хосты не хранятся в mcp.json — добавляются через MCP-инструменты. Конфиг хостов: `~/.ssh-mcp/hosts.json`.

### Workflow

1. **Добавить хост** — `add-host`: host_id, host, port (опц.), username, password или keyPath (опц.). Без пароля/ключа используется SSH-agent.
2. **Список хостов** — `list-hosts`.
3. **Открыть сессию** — `start-session` с host_id; в ответе — session_id.
4. **Выполнить команду** — `exec`: session_id и command. Вывод и код выхода возвращаются в ответе.
5. **Список сессий** — `list-sessions`.
6. **Закрыть сессию** — `close-session` с sessionId.

Сессии сохраняют состояние (cwd, env) между вызовами `exec`. Таймаут неактивности по умолчанию ~2 часа.

### Примеры вызовов

- add-host: `{"host_id":"myserver","host":"192.168.1.10","port":22,"username":"deploy","keyPath":"C:/Users/me/.ssh/id_rsa"}`
- start-session: `{"host_id":"myserver"}` → сохранить session_id
- exec: `{"session_id":"<uuid>","command":"cd /app && git pull"}`

### Отладка

- Permission denied — проверить keyPath или добавить password; при ключе с паролем задать `SSH_MCP_KEY_PASSPHRASE` перед запуском.
- Host not found — вызвать list-hosts, при необходимости add-host с уникальным host_id.
- Сессия пропала — истёк таймаут неактивности; начать новую через start-session.

---

## Альтернатива: ssh-mcp (tufantunc/ssh-mcp)

Один сервер = один хост. Параметры передаются в args при запуске: host, user, port, password или key, timeout, maxChars, sudoPassword (опц.), disableSudo (опц.).

Инструменты: `exec` (command, description опц.), `sudo-exec` (если не disableSudo).

Для добавления в mcp.json вручную (подставить свои значения):

```json
"ssh-mcp": {
  "command": "npx",
  "args": ["-y", "ssh-mcp", "--", "--host=HOST", "--user=USER", "--password=PASS", "--timeout=60000", "--maxChars=none"]
}
```

Или с ключом: `"--key=C:\\Users\\klims\\.ssh\\id_rsa"` вместо password.

---

## Когда применять

- Пользователь просит выполнить команду на удалённом сервере по SSH.
- Нужны несколько команд подряд с сохранением окружения (каталог, переменные) — использовать ssh-mcp-sessions и одну сессию.
- Один разовый хост с фиксированными учётными данными в конфиге — можно использовать ssh-mcp с args.
