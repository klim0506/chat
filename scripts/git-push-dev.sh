#!/usr/bin/env bash
# Пуш ветки dev в klim0506/chat (HTTPS с токеном).
# Использование:
#   export GITHUB_TOKEN=ghp_xxxxxxxx        # classic PAT с scope repo
#   bash scripts/git-push-dev.sh
#
# Либо один раз настроить SSH: git remote set-url origin git@github.com:klim0506/chat.git
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  echo "Задайте GITHUB_TOKEN (Personal Access Token с правом repo)." >&2
  echo "Пример: export GITHUB_TOKEN=ghp_..." >&2
  exit 1
fi

REMOTE_URL="https://oauth2:${GITHUB_TOKEN}@github.com/klim0506/chat.git"
git push "$REMOTE_URL" dev
