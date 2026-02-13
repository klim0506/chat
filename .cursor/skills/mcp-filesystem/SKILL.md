---
name: mcp-filesystem
description: Uses Filesystem MCP server for read/write and directory operations within allowed paths. Use when the user needs to read or write files via MCP, list or search directories, create folders, or move files within configured filesystem roots.
---

# Filesystem MCP

Работа с файлами и каталогами через MCP в пределах разрешённых (allowed) путей. Требуется настроенный Filesystem MCP server с указанными корневыми каталогами.

## Когда применять

- Чтение или запись файлов в рамках разрешённых директорий
- Просмотр структуры каталогов, поиск файлов по шаблону
- Создание каталогов, перемещение/переименование файлов
- Когда нужен единый MCP-интерфейс к файлам (например, при интеграции с другими MCP)

## Основные инструменты

| Операция | Инструменты |
|----------|-------------|
| **Чтение** | `read_file` / `read_text_file`, `read_media_file` (base64 для изображений/аудио), `read_multiple_files` |
| **Запись** | `write_file` (создание или перезапись) |
| **Каталоги** | `list_directory`, `list_directory_with_sizes`, `create_directory`, `directory_tree`, `list_allowed_directories` |
| **Управление** | `move_file`, `search_files` (рекурсивный поиск по шаблону, с исключениями) |
| **Метаданные** | `get_file_info` |

## Рекомендации

1. **Пути**: использовать прямые слэши; пути относительны к одному из разрешённых корней. Сначала при необходимости вызвать `list_allowed_directories`.
2. **Большие файлы**: предпочитать потоковое чтение или ограничение объёма, если инструмент поддерживает; для нескольких файлов — `read_multiple_files`.
3. **Медиа**: для картинок/аудио использовать `read_media_file` (base64); не пытаться читать их как текст.
4. **Поиск**: `search_files` с pattern и при необходимости exclude — для рекурсивного поиска по имени/маске.
5. **Безопасность**: не выходить за пределы allowed directories; при отказе в доступе сообщить пользователю о ограничениях MCP.

## Ограничения

Операции только внутри настроенных корней. При отсутствии доступа к пути — предложить пользователю добавить каталог в конфигурацию Filesystem MCP.
