# apps/web — Onboarding UI (v2, planned)

Status: **stub only.** Not yet implemented. v1 ships the CLI wizard; this directory
captures the design direction for the visual onboarding UI so the work has a home and
isn't accidentally re-litigated.

## Goal

A web UI that walks someone through connecting Crab to a WhatsApp Business account,
designed to *feel* like the Meta product family it integrates with — drawing on the
visual language of WhatsApp, Facebook, and Instagram. The user should feel like they're
extending the same product surface, not landing on a developer console.

## Visual language references

| Element | Inspired by | Why |
|---|---|---|
| Primary green & rounded message bubbles in the preview pane | WhatsApp | The user is configuring a WhatsApp bot — the success state should look like WhatsApp. |
| Card-stacked step layout, soft shadows, rounded buttons | Facebook (Meta Business Suite) | Matches the dashboard the user just left to come configure us. |
| Story-style horizontal progress bar, full-bleed media in step illustrations | Instagram | Conveys "you're partway through a small linear flow" without a heavy stepper. |
| Typography: Inter / SF Pro fallback stack | All three | Keeps it neutral; matches Meta's web product type. |

## Flow (v2 sketch)

1. **Welcome.** Brand intro card, "Connect WhatsApp" CTA.
2. **Meta App.** Inline help to find App Secret + token, with screenshots of the Meta
   dashboard and live-validating inputs.
3. **Phone number.** Pick from a dropdown populated by hitting the Graph API with the
   token entered in step 2.
4. **Webhook.** Auto-generates verify token, displays the callback URL; offers a "test
   from Meta" round-trip button that confirms the GET handshake succeeded.
5. **LLM.** Anthropic key + model picker.
6. **Try it.** WhatsApp-style preview: a fake conversation pane on the right where the
   user can send a message to the just-configured number and see Crab reply.

## Tech (proposed)

- React + Vite + TypeScript.
- Tailwind for utility CSS, with a small `theme.ts` exposing tokens
  (`color.wa.green`, `color.fb.blue`, `radius.bubble`) so the WhatsApp/Facebook/
  Instagram palette is a single source of truth.
- React Hook Form for input validation; Zod schemas shared with the server.
- Lives behind the same Fastify server as the API (`/onboard/*` routes), no separate
  deploy.

## Out of scope for v2

- Full SaaS multi-tenant admin (lives behind v3).
- Mobile-native onboarding.
- Theming / white-labeling.

## Engineering notes

When implementing, reuse:

- The `WorkspaceConfig` type from `apps/cli/src/workspace.ts` — same shape, written by
  both the CLI and the web onboarding flow.
- The `doctor` checks in `apps/cli/src/commands/doctor.ts` — surface them as the final
  step's success criteria.
- The `WhatsAppApi` client from `@crab/channel-whatsapp` — for the live phone-number
  picker and the test-message round-trip.
