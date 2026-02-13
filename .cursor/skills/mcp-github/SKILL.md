---
name: mcp-github
description: Uses GitHub MCP server to manage repositories, issues, and pull requests. Use when the user needs to create or read issues, work with pull requests, search or manage GitHub repos, or when GitHub API context is required.
---

# GitHub MCP

Использование официального GitHub MCP для работы с репозиториями, issues и pull requests. Требуется настроенный GitHub MCP server (OAuth или PAT).

## Когда применять

- Создание, чтение или обновление issues
- Работа с pull requests (просмотр, создание, ревью)
- Поиск по репозиториям, коду, пользователям
- Управление репозиторием (в рамках доступных toolsets)

## Основные инструменты

| Область | Инструменты |
|--------|--------------|
| **Issues** | `issue_read` (get, get_comments, get_labels, get_sub_issues), `issue_write` (create, update) |
| **Pull requests** | `pull_request_review_write` (create, submit_pending, delete_pending) |
| **Repos** | Управление репозиториями в рамках toolsets |

## Рекомендации

1. **Идентификация сущностей**: передавать owner/repo и номер issue/PR в формате, ожидаемом инструментом (например `owner/repo`, issue number).
2. **Перед созданием issue**: убедиться, что есть title и при необходимости body; для update — указать поля, которые меняются.
3. **Ревью PR**: использовать `pull_request_review_write` с методом create для черновика, submit_pending для отправки; при отмене — delete_pending.
4. **Ошибки доступа**: при 401/403 проверить, что MCP настроен с валидным PAT и нужными scope (repo, read:org при необходимости).

## Дополнительные toolsets

По умолчанию включены: `repos`, `issues`, `pull_requests`. Опционально: `actions`, `code_security`, `secret_protection`. Использовать только те инструменты, которые реально доступны в конфигурации пользователя.
