# Getting started

This walkthrough takes you from "fresh clone" to "WhatsApp message gets an AI reply" in
about 10 minutes.

## Prerequisites

- Node.js 22 or newer.
- pnpm (`npm i -g pnpm` or `corepack enable`).
- A Meta Business account with the WhatsApp product enabled. The free test phone number
  Meta provides is enough.
- An Anthropic API key.
- A way to expose your local server over HTTPS — either a public URL on a server you
  own, or [ngrok](https://ngrok.com) for local development.

## 1. Clone and install

```bash
git clone https://github.com/your-org/crab.git
cd crab
pnpm install
```

## 2. Run the onboarding wizard

```bash
pnpm crab onboard
```

The wizard will ask for:

1. **Meta App Secret** — App settings → Basic → "App Secret".
2. **System User access token** — Business Settings → Users → System Users → Generate
   token. Pick a *long-lived* (60-day or permanent) token with `whatsapp_business_messaging`
   and `whatsapp_business_management` permissions.
3. **Phone Number ID** — WhatsApp → Configuration → API Setup. The number that says
   "From".
4. **WhatsApp Business Account (WABA) ID** — same panel.
5. **Anthropic API key**.

The wizard generates a strong webhook **verify token** for you and writes everything to
`~/.crab/workspace/config.json` (mode 0600) plus `.env` in the working directory.

## 3. Tell Meta where to send webhooks

In the Meta App dashboard, go to **WhatsApp → Configuration → Webhook**:

- **Callback URL**: `<your-public-url>/webhooks/whatsapp`
- **Verify token**: (the one the wizard generated; it's printed at the end)
- **Webhook fields**: subscribe to `messages` and `message_status_updates`.

For local development:

```bash
ngrok http 3000
# copy the https://...ngrok-free.app URL into the Meta dashboard
```

## 4. Start the server

```bash
pnpm crab start
```

Then send a WhatsApp message to your business test number. You should get a reply
within a couple of seconds.

## 5. Validate

```bash
pnpm crab doctor
```

All checks should report `[ok]`. If any fail, the detail line tells you what's missing.

## What's next

- Read [`security.md`](security.md) for the threat model and what's hardened by default.
- Read [`deployment.md`](deployment.md) for production deploy targets (Docker, Fly.io,
  Railway, Render).
- Read [`whatsapp.md`](whatsapp.md) for the details of the Cloud API integration.
