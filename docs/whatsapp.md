# WhatsApp Business Cloud API integration

## Why the Cloud API and not Baileys / WhatsApp Web

Older self-hosted assistants (OpenClaw included) bridge to WhatsApp via
[Baileys](https://github.com/WhiskeySockets/Baileys), an unofficial WhatsApp Web
reverse-engineered library. It's fast to set up — you scan a QR code and your personal
account answers messages — but it has three serious problems for production:

1. It violates WhatsApp's terms of service. Accounts using Baileys can be (and are)
   banned without warning.
2. It requires a long-running paired phone session. Reboots, network blips, and Web
   client updates all force a re-pair.
3. There is no isolation between business and personal use. The same phone number that
   answers your bot is the one your friends text.

Crab uses the **official WhatsApp Business Cloud API** instead:

- Hosted by Meta. No phone-pairing.
- Multiple test numbers free; production numbers are inexpensive after verification.
- First-class support for templates, interactive buttons/lists, media, reactions.

## Webhook endpoint

```
GET  /webhooks/whatsapp   # Meta's verification handshake
POST /webhooks/whatsapp   # message + status deliveries
```

Both are signature-verified and rate-limited. The POST handler is bounded by
`CRAB_WEBHOOK_MAX_BODY_BYTES` (default 1 MiB) and rejects oversize requests before
hashing.

## Outbound

`@crab/channel-whatsapp` exposes a small `WhatsAppApi.send()` that speaks the standard
Cloud API request shapes:

- `text` — `{ type: "text", text: { body } }`
- `template` — `{ type: "template", template: { name, language: { code } } }`
- `interactive-buttons` — up to 3 reply buttons.
- `interactive-list` — up to 10 sectioned rows.
- `image` — link or pre-uploaded media id.
- `reaction` — emoji reaction to an inbound message.

## 24-hour customer-service window

Cloud API only allows free-form (non-template) messages within 24 hours of the user's
last inbound message. Crab tracks this per session and refuses to send free-form
messages outside the window — it returns a typed error so callers can decide to send a
template instead.

## Templates

Templates must be approved in the Meta Business Manager. Once approved, send them with:

```ts
await bus.send({
  channel: "whatsapp",
  to: { id: "1555..." },
  content: { type: "template", name: "order_shipped", languageCode: "en_US" },
  // ...
});
```

## Media

For inbound media, Crab passes the `mediaId` through; downloading the binary is left to
the application layer (so we don't accidentally pull megabytes through the egress guard
for every photo). When you do download media, route the call through the egress guard
so the SSRF / allowlist rules apply.
