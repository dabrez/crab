# Deployment

Crab supports three deployment shapes, in order of "less work for you":

## 1. Docker Compose (self-hosted)

```bash
cp .env.example .env       # fill in
docker compose -f infra/docker-compose.yml up -d
```

The `docker-compose.yml` runs Crab with:

- `read_only: true` — root filesystem is immutable; only `/data` (the SQLite + audit
  volume) and `/tmp` (a 64 MiB tmpfs) are writable.
- `cap_drop: ALL` — no Linux capabilities.
- `security_opt: [no-new-privileges, seccomp=default]`.
- Non-root UID 65532.
- Healthcheck on `/healthz`.

## 2. One-click platforms

Templates are in `infra/deploy/`:

| Platform | Template | Notes |
|---|---|---|
| Fly.io | `fly.toml` | `fly launch --copy-config && fly secrets set …` |
| Railway | `railway.json` | New Project → "Deploy from Repo" → set env vars in dashboard |
| Render | `render.yaml` | Blueprint deploy; `sync: false` keeps secrets out of git |
| Vercel | `vercel.json` | Webhook-only; needs an external store for sessions/audit |

All four templates point at `infra/Dockerfile` so the hardening (distroless, non-root)
applies the same way.

## 3. SaaS (multi-tenant)

v1 is single-tenant. The seam is in place — every Storage method takes a `tenantId` —
so multi-tenant onboarding can be added later by:

- Implementing a `tenantId`-aware secrets adapter (one Anthropic key per tenant, or a
  shared key with per-tenant rate limits).
- Routing webhooks to the right tenant by `phone_number_id`.
- Serving the onboarding flow from `apps/web` (planned for v2 — see `apps/web/README.md`).

## Production checklist

- [ ] Webhook URL is HTTPS and publicly reachable.
- [ ] All `WHATSAPP_*`, `ANTHROPIC_API_KEY` set as platform secrets, never committed.
- [ ] `CRAB_EGRESS_MODE=enforce` (or `approve` with an operator on call) in production.
- [ ] `CRAB_WEBHOOK_REPLAY_WINDOW_S` set (default 300 is sane).
- [ ] Audit log shipped to your log aggregator and alerted on.
- [ ] Backup `/data` (SQLite database). The conversation history and approvals live there.
