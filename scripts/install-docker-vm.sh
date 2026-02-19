#!/bin/bash
# Установка Docker и Docker Compose на Ubuntu/Debian для быстрого запуска проекта по SSH.
# Запуск: curl -fsSL https://raw.githubusercontent.com/.../install-docker-vm.sh | sudo bash
# Или: scp scripts/install-docker-vm.sh user@VM:/tmp/ && ssh user@VM 'sudo bash /tmp/install-docker-vm.sh'
set -e

echo "=== Установка Docker на VM ==="

# Определяем ОС
if [ -f /etc/os-release ]; then
  . /etc/os-release
  OS=$ID
else
  echo "Не удалось определить ОС. Ожидается Ubuntu/Debian."
  exit 1
fi

if [ "$OS" != "ubuntu" ] && [ "$OS" != "debian" ]; then
  echo "Скрипт рассчитан на Ubuntu/Debian. Текущая ОС: $OS"
  exit 1
fi

# Удаляем старые конфликтующие пакеты
apt-get update -qq
apt-get remove -y docker docker-engine docker.io containerd runc 2>/dev/null || true

# Официальный скрипт Docker (ставит Engine + Compose plugin)
echo "Скачивание и запуск официального установщика Docker..."
curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
sh /tmp/get-docker.sh
rm -f /tmp/get-docker.sh

# Добавляем текущего пользователя в группу docker (чтобы без sudo)
SCRIPT_USER="${SUDO_USER:-$USER}"
if [ -n "$SCRIPT_USER" ] && [ "$SCRIPT_USER" != "root" ]; then
  usermod -aG docker "$SCRIPT_USER"
  echo "Пользователь $SCRIPT_USER добавлен в группу docker. Выйдите и зайдите по SSH заново, чтобы применять docker без sudo."
fi

# Включаем и запускаем сервис
systemctl enable docker
systemctl start docker

# Проверка
docker --version
docker compose version 2>/dev/null || docker-compose --version

echo ""
echo "=== Docker установлен. ==="
echo "Для быстрого запуска проекта:"
echo "  1. Склонируйте репозиторий на VM (или скопируйте проект)."
echo "  2. В каталоге проекта: docker compose up -d"
echo "  3. Приложение: http://IP_ВМ (порт 80)."
echo "См. docs/docker-vm-setup.md"
