# Mobile Backend Release Runbook

This guide helps deploy backend changes without breaking mobile clients.

## 1) Release principles

- Keep backward compatibility for API responses and request schemas.
- Roll out gradually (canary/rolling), never update all app nodes at once.
- Prefer additive DB changes first (`ADD`), cleanup later.
- Always keep rollback path ready before deployment.

## 2) Pre-release checklist

### API compatibility

- [ ] Existing mobile endpoints in `/api/v1` still work.
- [ ] No response field was removed or renamed.
- [ ] New fields are optional for old clients.
- [ ] No new required request fields were introduced without fallback.
- [ ] Error format remains stable (`code`, `message`, `details`).

### Authentication and sessions

- [ ] Login and refresh token flow tested with current production mobile build.
- [ ] Access/refresh token TTL has no unexpected reduction.
- [ ] Authorization header format is unchanged.
- [ ] Token rotation/blacklist flow remains compatible.

### Database and migrations

- [ ] Migrations are zero-downtime friendly (additive first).
- [ ] Potentially long-running schema changes are scheduled safely.
- [ ] New columns have safe defaults or allow null initially.
- [ ] Data migration is separated from schema migration for large tables.
- [ ] Fresh backup exists and restore procedure is validated.

### Queues, Redis, background jobs

- [ ] Task payloads remain compatible between old/new code versions.
- [ ] Jobs are idempotent for retries.
- [ ] Queue names/routing keys were not changed without transition period.
- [ ] Cache key changes include namespace/versioning to avoid collisions.

### Files and media

- [ ] Files are stored in object storage, not local VM disk.
- [ ] Existing file links and signatures keep working.
- [ ] MIME types are correct for media consumed by mobile apps.
- [ ] CDN/object storage permissions are validated for client access.

### Observability and safety

- [ ] Dashboards ready for `5xx`, `4xx`, latency, auth errors, DB/Redis health.
- [ ] Alerts configured for sudden API error spikes.
- [ ] Request correlation available (`request_id`, `user_id` if applicable).
- [ ] On-call owner assigned during release window.

## 3) Deployment sequence (2 VM + Load Balancer)

1. Run tests and smoke checks on staging.
2. Apply safe additive migrations (`ADD` only).
3. Drain `VM-1` from load balancer (stop new traffic).
4. Deploy new backend on `VM-1`.
5. Verify health endpoints on `VM-1`:
   - `GET /health` (process up)
   - `GET /ready` (dependencies available)
6. Return `VM-1` to pool with small traffic share (canary).
7. Watch metrics for 10-20 minutes.
8. If stable, repeat steps 3-7 for `VM-2`.
9. After both VMs are stable, run final smoke test from mobile perspective.

## 4) Mobile-focused smoke test

- [ ] User login works.
- [ ] Token refresh works.
- [ ] Chat list loads.
- [ ] Message history loads.
- [ ] Sending text message works.
- [ ] Sending/receiving media works.
- [ ] Push/event delivery path works (if enabled).
- [ ] Subscription/payment critical path works (if enabled).

## 5) Rollback procedure

Trigger rollback if any of the following happen:

- sustained increase in `5xx`,
- auth failures spike,
- key mobile flows fail smoke test,
- severe DB/queue instability.

Rollback steps:

1. Remove unhealthy node from LB.
2. Redeploy previous stable application version.
3. Re-run health checks.
4. Return node to LB after metrics recover.
5. If issue is global, roll back second node as well.
6. Keep additive migrations; avoid immediate destructive rollback of schema.
7. Create incident note with root-cause and preventive action items.

## 6) Post-release cleanup (deprecation flow)

- Mark old fields/endpoints as deprecated.
- Keep compatibility window for 2-3 mobile app versions (or by adoption metrics).
- Remove deprecated behavior only after adoption threshold is reached.
- Record removal date in changelog/release notes.

## 7) Suggested environment policy

- `production`: strict backward compatibility.
- `staging`: mirror production config as close as possible.
- Feature flags for risky changes (gradual enablement by segment).

---

Owner: backend team  
Last updated: 2026-03-23
