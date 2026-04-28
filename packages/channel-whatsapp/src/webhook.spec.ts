import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { handleHandshake, handleWebhook } from "./webhook.js";

const APP_SECRET = "shh-secret";
const VERIFY_TOKEN = "vtoken-1234567890abcdef";

const ENVELOPE = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "ENTRY1",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "1", phone_number_id: "PNID" },
            contacts: [{ profile: { name: "Ada" }, wa_id: "1555" }],
            messages: [{ id: "wamid.X", from: "1555", timestamp: "100", type: "text", text: { body: "hi" } }],
          },
        },
      ],
    },
  ],
};

function sign(body: Buffer): string {
  return "sha256=" + createHmac("sha256", APP_SECRET).update(body).digest("hex");
}

describe("handleHandshake", () => {
  const config = { appSecret: APP_SECRET, verifyToken: VERIFY_TOKEN, maxBodyBytes: 1024 };

  it("echoes the challenge when the verify token matches", () => {
    const r = handleHandshake(
      { "hub.mode": "subscribe", "hub.verify_token": VERIFY_TOKEN, "hub.challenge": "42" },
      config,
    );
    expect(r).toEqual({ status: 200, body: "42" });
  });

  it("rejects a bad verify token", () => {
    const r = handleHandshake(
      { "hub.mode": "subscribe", "hub.verify_token": "wrong", "hub.challenge": "42" },
      config,
    );
    expect(r.status).toBe(403);
  });

  it("rejects bad mode", () => {
    const r = handleHandshake({ "hub.mode": "delete" }, config);
    expect(r.status).toBe(400);
  });
});

describe("handleWebhook", () => {
  const config = { appSecret: APP_SECRET, verifyToken: VERIFY_TOKEN, maxBodyBytes: 1024 };

  it("accepts a correctly-signed payload", () => {
    const body = Buffer.from(JSON.stringify(ENVELOPE));
    const r = handleWebhook(body, { "x-hub-signature-256": sign(body) }, config);
    expect(r.ok).toBe(true);
  });

  it("rejects when the signature header is missing", () => {
    const body = Buffer.from(JSON.stringify(ENVELOPE));
    const r = handleWebhook(body, {}, config);
    expect(r).toMatchObject({ ok: false, status: 401 });
  });

  it("rejects when the body has been tampered with", () => {
    const body = Buffer.from(JSON.stringify(ENVELOPE));
    const sig = sign(body);
    const tampered = Buffer.from(JSON.stringify({ ...ENVELOPE, object: "page" }));
    const r = handleWebhook(tampered, { "x-hub-signature-256": sig }, config);
    expect(r).toMatchObject({ ok: false, status: 401 });
  });

  it("rejects oversize bodies before parsing", () => {
    const big = Buffer.alloc(2048, 0x41);
    const r = handleWebhook(big, { "x-hub-signature-256": sign(big) }, config);
    expect(r).toMatchObject({ ok: false, status: 413 });
  });

  it("rejects payloads of an unexpected shape", () => {
    const body = Buffer.from(JSON.stringify({ object: "page", entry: [] }));
    const r = handleWebhook(body, { "x-hub-signature-256": sign(body) }, config);
    expect(r).toMatchObject({ ok: false, status: 400, reason: "unexpected-shape" });
  });

  it("rejects invalid JSON", () => {
    const body = Buffer.from("{not-json");
    const r = handleWebhook(body, { "x-hub-signature-256": sign(body) }, config);
    expect(r).toMatchObject({ ok: false, status: 400, reason: "invalid-json" });
  });
});
