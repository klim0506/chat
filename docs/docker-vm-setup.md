# Docker на виртуальной машине (быстрый запуск по SSH)

Установка Docker на Ubuntu/Debian VM и запуск проекта через `docker compose`.

## 1. Установка Docker на VM

### Вариант A: через SSH вручную

С вашего ПК (в корне проекта):

```bash
# Скопировать скрипт на VM и выполнить
scp scripts/install-docker-vm.sh user@IP_ВМ:/tmp/
ssh user@IP_ВМ 'sudo bash /tmp/install-docker-vm.sh'
```

После установки выйдите из SSH и зайдите снова, чтобы группа `docker` применилась (или перезапустите сессию).

### Вариант B: через SSH MCP в Cursor

1. Добавьте хост: **MCP → user-ssh-mcp-sessions → add-host**  
   Параметры: `host_id` (например `vm`), `host` (IP или hostname), `username`, при необходимости `keyPath` или `password`.

2. Откройте сессию: **start-session** с вашим `host_id`.

3. Выполните установку (подставьте свой `session_id` из ответа start-session):

   ```text
   exec: session_id=<session_id>, command=curl -fsSL https://get.docker.com | sudo sh && sudo usermod -aG docker $USER && sudo systemctl enable docker && sudo systemctl start docker
   ```

   Либо загрузите скрипт на VM (через scp или вручную), затем через **exec** выполните:  
   `sudo bash /tmp/install-docker-vm.sh`.

## 2. Проект на VM

Склонируйте репозиторий или скопируйте каталог проекта на VM (например в `/home/user/chat` или `/root/chat`).

```bash
# Пример: клон на VM
ssh user@IP_ВМ 'git clone --depth 1 https://github.com/ВАШ/chat.git /home/user/chat'
```

Скопируйте на VM файл окружения бэкенда (если его ещё нет):

```bash
scp backend/.env user@IP_ВМ:/home/user/chat/backend/.env
```

При необходимости отредактируйте на VM `backend/.env` (например `ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS`, `FRONTEND_URL` с учётом IP или домена VM).

## 3. Запуск через Docker Compose

На VM:

```bash
cd /home/user/chat   # или путь к проекту
docker compose up -d
```

Проверка:

```bash
docker compose ps
curl -s -o /dev/null -w "%{http_code}" http://localhost/api/
```

В браузере: **http://IP_ВМ** (порт 80).

## 4. Остановка и обновление

```bash
cd /home/user/chat
docker compose down
# Обновление кода (git pull или scp), затем:
docker compose build --no-cache && docker compose up -d
```

## Требования к VM

- ОС: Ubuntu 20.04/22.04/24.04 или Debian 11/12.
- Доступ по SSH под пользователем с правами `sudo`.
- Открыт порт 80 (и при необходимости 443 для HTTPS).
