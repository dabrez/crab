# Crab

A hardened, easy-to-set-up AI assistant for WhatsApp.

Crab is a self-hosted personal AI assistant that talks to your users on WhatsApp via the
**official WhatsApp Business Cloud API** — not the Baileys / QR-code bridge that older
self-hosted assistants rely on. It is OpenClaw-compatible in spirit (channel/plugin
architecture, `~/.crab/workspace` state) and inherits sandboxing and egress-control ideas
from NVIDIA NemoClaw without depending on NVIDIA OpenShell.

## Why

- **Native WhatsApp Business Cloud API.** No phone-linking, no risk of an account ban
  for using an unofficial WhatsApp Web bridge, no daemon babysitting a phone.
- **One-command setup.** `pnpm crab onboard` walks you through Meta's app dashboard,
  generates a verify token, opens an ngrok tunnel for local dev, and round-trips a test
  message before you finish.
- **Secure by default.** HMAC-verified webhooks, egress allowlist with operator
  approval, SSRF guards on every outbound fetch, Linux Landlock + seccomp filtering when
  available, distroless non-root container with read-only root filesystem.
- **Single-tenant today, multi-tenant tomorrow.** All storage and APIs carry a
  `tenantId`; v1 always passes `"default"`, but you don't rewrite anything to add
  multi-tenant later.

## Quickstart

```bash
pnpm install
pnpm crab onboard          # interactive wizard
pnpm crab start            # start the assistant
```

For Docker:

```bash
cp .env.example .env       # edit with your Meta credentials
docker compose up
```

## Docs

- [`docs/getting-started.md`](docs/getting-started.md) — clone-to-first-message walkthrough.
- [`docs/whatsapp.md`](docs/whatsapp.md) — Cloud API integration details and why we don't use Baileys.
- [`docs/security.md`](docs/security.md) — threat model and what's hardened by default.
- [`docs/deployment.md`](docs/deployment.md) — Docker / Fly / Railway / Render / Vercel.
- [`docs/roadmap.md`](docs/roadmap.md) — v2 onboarding UI, v3 Manus-style autonomous features.

## Repo layout

```
apps/cli                 # `crab` CLI: onboard, doctor, channels, start
apps/server              # Fastify server: webhook + health + (later) onboarding API
apps/web                 # v2 onboarding UI (stub) — WhatsApp/Facebook/Instagram visual language
packages/core            # Channel-agnostic types, message bus, agent runner
packages/channel-whatsapp# WhatsApp Business Cloud API adapter
packages/llm             # LLM provider abstraction (Anthropic by default)
packages/security        # HMAC, egress allowlist, SSRF guard, secrets, sandbox, audit
packages/storage         # SQLite-backed workspace storage; multi-tenant ready
infra/                   # Dockerfile, docker-compose, deploy templates
docs/                    # See above
```

## License

Apache-2.0
