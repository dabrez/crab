# Roadmap

## v1 (this release): WhatsApp Business Cloud API + hardening

Shipped:

- Native WhatsApp Business Cloud API channel (no Baileys / WhatsApp Web).
- HMAC-verified webhook with replay window and body cap.
- Egress allowlist + SSRF guard + operator approval (NemoClaw-inspired).
- Distroless, non-root, read-only Docker image; one-click templates for Fly, Railway,
  Render, Vercel.
- `crab onboard` CLI wizard and `crab doctor` validator.
- SQLite-backed session memory and inbound dedupe.
- Vitest unit + integration coverage for security, WhatsApp adapter, and the full
  webhook → agent → outbound path.

## v2: Visual onboarding UI

See [`apps/web/README.md`](../apps/web/README.md). Web onboarding flow whose visual
language draws from WhatsApp, Facebook, and Instagram so users feel they're extending
the Meta product surface they came from. Reuses the v1 `WorkspaceConfig` schema and
`doctor` checks.

## v3: Autonomous-agent capabilities (Manus feature delta)

Goal: give Crab the autonomous task-execution capabilities that
[Manus](https://manus.im) demonstrates but that OpenClaw does not provide today, while
keeping every new capability inside the existing security envelope (egress guard,
sandbox, audit log).

Capabilities to add, in rough priority order:

1. **Long-running task runner.** Agent loop persists across messages; tasks survive
   process restarts; user can ask "what are you working on?" and get a status reply
   over WhatsApp. New module: `packages/tasks` with a `Task` lifecycle (`pending`,
   `running`, `paused`, `done`, `failed`) backed by the storage layer.
2. **Tool use with sandboxed shell.** Headless container per task (Docker-in-Docker or
   Firecracker microVM) with the `defaultProfile` from `packages/security/src/sandbox.ts`
   applied. Tools: `bash`, `python`, `read_file`, `write_file`, scoped to the task's
   workspace dir. Egress guard applies at the host network layer too.
3. **Browser automation.** Playwright running inside the same task sandbox. Outbound
   HTTPS goes through the egress proxy so the allowlist applies to scripted browsing
   too. Screenshots returned as WhatsApp image messages.
4. **Code execution.** Run user-uploaded code in the same sandbox. Resource limits
   (CPU, memory, walltime) enforced by the runtime.
5. **File handling.** Inbound WhatsApp documents stored in the task workspace; outbound
   results sent back as documents. Media virus-scanned at ingress.
6. **Plan/replan loop.** Explicit plan-then-execute pattern: agent emits a structured
   plan (JSON), user can approve / edit it on WhatsApp via interactive buttons, then
   executes step-by-step with progress updates.
7. **Multi-tenant.** Storage seam (already in place) gets a real implementation —
   per-tenant secrets, billing hooks, admin console. Coordinates with v2's web app.

### Caveats

- Anything that gives an LLM a shell or a browser raises the bar on the security model.
  v3 must not regress v1 defaults: egress allowlist + SSRF guard apply to *every*
  outbound call, including ones made by browser automation; sandbox profiles are
  enforced at the OS layer, not just at the API layer.
- "Manus features" is a moving target; the list above is the publicly-known set as of
  the v1 release. Re-validate before starting v3.
