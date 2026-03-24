# Глобальный план развертывания сервиса

Цель: развернуть и эксплуатировать сервис по модели `Load Balancer + 2 App VM + Managed PostgreSQL + Managed Redis + Object Storage`, с масштабированием и устойчивостью к инцидентам.

---

## 1. Архитектура (целевая)

```text
Интернет
   |
   v
Load Balancer (HTTPS, health checks, sticky WS)
   |----------------------|
   v                      v
App VM 1                App VM 2
(backend/ws/celery)     (backend/ws/celery)
   \                      /
    \                    /
     v                  v
 Managed PostgreSQL   Managed Redis

Object Storage (медиа) + CDN (опционально)
Off-provider Backup Storage (резервный провайдер)
```

Принципы:
- Публичная точка входа только одна: `Load Balancer`.
- App-узлы stateless (код и конфиг одинаковые, без критичных локальных данных).
- Файлы пользователей только в Object Storage.
- Бэкапы хранятся и в основном, и во внешнем провайдере.

---

## 2. Что закупается и создается

### Обязательные ресурсы
- Домен и DNS.
- 1x Load Balancer (managed).
- 2x App VM (production минимум).
- Managed PostgreSQL.
- Managed Redis.
- Object Storage bucket для медиа.
- Отдельный off-provider bucket для резервных копий.

### Рекомендуемые стартовые размеры (5k DAU)
- App VM: `4 vCPU / 8 GB RAM / 80 GB SSD` (каждая).
- PostgreSQL: эквивалент `4 vCPU / 16 GB RAM`, SSD/NVMe.
- Redis: `2-4 GB RAM` (с запасом по памяти и мониторингом).

---

## 3. Сеть и безопасность

### Сегментация
- Публично доступны только `80/443` на LB.
- App VM принимают трафик только от LB (и SSH с allowlist/VPN).
- PostgreSQL/Redis доступны только из private subnet App VM.

### Базовые меры защиты
- SSH только по ключам, без паролей.
- MFA на облачные аккаунты и billing.
- Секреты через Secret Manager/Vault (не хранить в git).
- WAF/CDN перед LB (например Cloudflare) для DDoS и bot filtering.
- Rate limiting на edge и в API.

---

## 4. Подготовка окружений

Создать минимум 3 окружения:
- `dev` — локальная/командная разработка.
- `staging` — почти копия production.
- `production` — боевая среда.

Правила:
- Релизы идут `dev -> staging -> production`.
- Все миграции сначала проверяются в staging.
- Конфиги и ресурсы описываются как код (Terraform/Ansible/скрипты CI).

---

## 5. Порядок развертывания production

1. Создать VPC/приватную сеть и security groups.
2. Поднять managed PostgreSQL и managed Redis.
3. Создать Object Storage bucket для медиа.
4. Поднять 2 App VM с одинаковым образом.
5. Развернуть backend + websocket + celery на обе VM.
6. Применить миграции БД (однократно, отдельным шагом).
7. Подключить обе VM к LB target group.
8. Настроить health checks:
   - liveness: `/api/health/`
   - readiness: `/api/health/?deep=1`
9. Подключить домен и TLS.
10. Прогнать smoke-тесты (логин, чат, websocket, файлы, платежи).

---

## 6. CI/CD и релизы

### Pipeline минимум
- Сборка артефактов.
- Тесты (unit + smoke).
- Deploy в staging.
- Ручное подтверждение в production.
- Rolling deploy в production по нодам.

### Правила релиза
- Не обновлять все app-узлы одновременно.
- Canary/rolling: 1 узел -> проверка -> второй узел.
- При проблеме: быстрый rollback на прошлый релиз.

---

## 7. Масштабирование

### Горизонтальное (app-слой)
- Min: 2 app-ноды.
- Autoscaling до 4-6 нод по метрикам.

Пример триггеров:
- `CPU > 75%` 10 минут -> `+1` app VM.
- `API p95 > 600ms` 5 минут -> `+1` app VM.
- `5xx > 2%` 3 минуты -> аварийное scale-out и разбор инцидента.

### Вертикальное (data-слой)
- Postgres/Redis увеличивать по мере роста `connections/latency/memory`.
- Для Postgres заранее планировать read-replica при росте чтения.

---

## 8. Файлы и медиа

### Модель хранения
- Бинарные файлы только в Object Storage.
- В БД хранить метаданные и ключи объектов.

### Политики
- Bucket private by default.
- Signed URLs с коротким TTL для скачивания.
- Lifecycle для временных и устаревших объектов.
- Версионирование и контроль удаления.

---

## 9. Мониторинг и алерты

Обязательные дашборды:
- API latency (p50/p95/p99), RPS, 4xx/5xx.
- App VM CPU/RAM/network.
- DB connections, query latency, lock waits.
- Redis memory, evictions, latency.
- Celery queue depth, oldest task age.
- Health статусы нод за LB.

Алерты минимум:
- `API p95 > 600ms` (warning), `> 1200ms` (critical).
- `5xx > 1%` (warning), `> 2%` (critical).
- Postgres connections > 70% (warning), > 85% (critical).
- Redis memory > 75% (warning), evictions > 0 (critical).

---

## 10. Резервное копирование и DR

- Использовать документ `docs/backup-and-dr-plan.md` как обязательный стандарт.
- Выполнять weekly restore test и monthly DR drill.
- Хранить off-provider бэкапы в отдельном аккаунте/провайдере.
- Держать целевые RTO/RPO и регулярно подтверждать их тестами.

---

## 11. Эксплуатационные регламенты

### Ежедневно
- Проверка алертов и статуса health checks.
- Проверка успешности backup jobs.

### Еженедельно
- Restore test на staging.
- Проверка уязвимостей зависимостей/образов.

### Ежемесячно
- DR-учение "потеря основного провайдера".
- Ротация ключей/доступов по политике.

---

## 12. Матрица ответственности

- Product/Business: SLA, приоритеты, бюджет.
- Backend team: API, миграции, обратная совместимость.
- DevOps/SRE: инфраструктура, CI/CD, мониторинг, инциденты.
- Security owner: секреты, IAM, аудит доступов, hardening.

---

## 13. Definition of Done для production-ready

- [ ] 2 app-ноды за LB работают стабильно.
- [ ] PostgreSQL и Redis изолированы в private network.
- [ ] Object Storage подключен и используется для медиа.
- [ ] CI/CD выполняет rolling deploy и поддерживает rollback.
- [ ] Мониторинг и критичные алерты включены.
- [ ] Off-provider backup и DR-процедуры подтверждены тестами.
- [ ] Runbook инцидентов и ответственные назначены.
