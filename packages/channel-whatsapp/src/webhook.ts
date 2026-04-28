import { verifyHandshakeToken, verifyHmacSignature, type VerifyResult } from "@crab/security/hmac";
import type { InboundEnvelope } from "./types.js";

export interface WebhookConfig {
  appSecret: string;
  verifyToken: string;
  maxBodyBytes: number;
  /** Replay window in seconds. 0 disables. */
  replayWindowS?: number;
}

export interface ParsedWebhook {
  envelope: InboundEnvelope;
}

export type WebhookResult =
  | { ok: true; parsed: ParsedWebhook }
  | { ok: false; status: 400 | 401 | 403 | 413; reason: string };

/**
 * Meta sends a GET on the webhook URL to verify ownership at subscription time:
 *
 *   GET /webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...
 *
 * Echo the challenge if the token matches.
 */
export function handleHandshake(query: Record<string, string | undefined>, config: WebhookConfig): { status: number; body: string } {
  if (query["hub.mode"] !== "subscribe") return { status: 400, body: "bad mode" };
  const provided = query["hub.verify_token"];
  if (!provided || !verifyHandshakeToken(provided, config.verifyToken)) {
    return { status: 403, body: "verify_token mismatch" };
  }
  const challenge = query["hub.challenge"];
  if (!challenge) return { status: 400, body: "missing challenge" };
  return { status: 200, body: challenge };
}

/**
 * Verify and parse an inbound POST.
 *
 * The signature MUST be checked against the *raw* request body bytes, not the
 * re-serialised JSON — Fastify must be configured with a raw-body parser for
 * this route. See apps/server/src/routes/whatsapp.ts.
 */
export function handleWebhook(rawBody: Buffer, headers: Record<string, string | undefined>, config: WebhookConfig): WebhookResult {
  const sig = headers["x-hub-signature-256"];
  const verify: VerifyResult = verifyHmacSignature({
    body: rawBody,
    signatureHeader: sig,
    secret: config.appSecret,
    maxBodyBytes: config.maxBodyBytes,
    ...(config.replayWindowS ? { replayWindowS: config.replayWindowS } : {}),
  });

  if (!verify.ok) {
    if (verify.reason === "body-too-large") return { ok: false, status: 413, reason: verify.reason };
    if (verify.reason === "missing-signature") return { ok: false, status: 401, reason: verify.reason };
    return { ok: false, status: 401, reason: verify.reason };
  }

  let envelope: InboundEnvelope;
  try {
    envelope = JSON.parse(rawBody.toString("utf8")) as InboundEnvelope;
  } catch {
    return { ok: false, status: 400, reason: "invalid-json" };
  }
  if (envelope.object !== "whatsapp_business_account" || !Array.isArray(envelope.entry)) {
    return { ok: false, status: 400, reason: "unexpected-shape" };
  }
  return { ok: true, parsed: { envelope } };
}
