# Security model

Crab inherits ideas from NVIDIA NemoClaw — sandboxing, egress allowlists, operator
approval — but does not depend on NVIDIA OpenShell. The defenses below are on by default;
you don't have to opt in.

## Threat model

- **Untrusted inbound messages.** Any WhatsApp user can send arbitrary text, including
  prompt-injection attempts. The agent treats inbound text as untrusted input and uses a
  system prompt that says so explicitly.
- **Webhook spoofing.** The webhook endpoint is publicly reachable. A spoofer could try
  to deliver a forged payload claiming to be from Meta.
- **SSRF / data exfil via outbound HTTP.** A compromised LLM tool or dependency could
  try to make Crab fetch internal services (cloud metadata endpoints, RFC1918 ranges).
- **Secret theft.** Tokens in env vars or on disk could be read by a process compromise.
- **Replay.** A captured webhook could be replayed indefinitely.

## What's hardened by default

| Defense | Where | Notes |
|---|---|---|
| HMAC-SHA256 webhook signature | `packages/security/src/hmac.ts` | Constant-time comparison; rejects oversize bodies before hashing. |
| Replay window | `packages/security/src/hmac.ts` | Opt-in via `CRAB_WEBHOOK_REPLAY_WINDOW_S` (default 300s). |
| Webhook size cap | `apps/server/src/app.ts` | `CRAB_WEBHOOK_MAX_BODY_BYTES` (default 1 MiB). |
| Inbound dedupe | `packages/storage/src/sqlite.ts` | Replayed message ids are dropped. |
| Egress allowlist | `packages/security/src/egress.ts` | Only `graph.facebook.com` + LLM provider host by default. |
| SSRF guard | `packages/security/src/egress.ts` | DNS-resolves and rejects loopback / RFC1918 / link-local / 100.64/10. |
| Operator approval | `CRAB_EGRESS_MODE=approve` | New destinations are queued, not silently allowed. |
| Audit log | `packages/security/src/audit.ts` | Append-only JSONL of every secret read, egress decision, webhook accept/reject. |
| Linux Landlock | `packages/security/src/sandbox.ts` | Best-effort filesystem confinement when `node-landlock` is installed. |
| Docker hardening | `infra/docker-compose.yml` | `read_only`, `cap_drop: ALL`, `no-new-privileges`, default seccomp, non-root user. |
| Distroless image | `infra/Dockerfile` | No shell, no package manager, minimal attack surface. |
| Secrets via env | `packages/security/src/secrets.ts` | No plaintext token files; pluggable KMS adapter. |
| Constant-time token compare | `verifyHandshakeToken` | Timing-safe verify-token compare on the GET handshake. |

## What you should still do

- **Rotate tokens** quarterly. Use the System User token, not a temporary debug token.
- **Set `CRAB_PUBLIC_URL`** to the exact URL you registered with Meta — useful for
  generated links, not used for verification (signature verification is what protects
  the endpoint).
- **Run behind TLS.** Meta requires HTTPS for webhooks; let your platform (Fly, Render,
  Cloud Run, ALB, etc.) terminate TLS — Crab itself listens on plain HTTP inside the
  trust boundary.
- **Treat the audit log as security telemetry.** Ship `~/.crab/workspace/audit.jsonl`
  to your log aggregator and alert on `egress.blocked.ssrf` / `webhook.rejected`.

## Known limitations

- The in-process Linux sandbox depends on `node-landlock` and `node-seccomp`, which are
  optional native deps. When missing, the container's seccomp profile + capability drops
  are what enforce the boundary. macOS and Windows hosts always rely on Docker / a VM.
- The WhatsApp 24-hour customer-service window is enforced *only based on inbound
  messages this process has observed*. If you scale horizontally, share session state
  via the SQLite/external storage layer or proactively re-open the window with templates.
