import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { build } from "./app.js";
import type { ServerConfig } from "./config.js";

const APP_SECRET = "test-app-secret";
const VERIFY_TOKEN = "test-verify-token-aaaaaaaaaaaaaaaa";

function envelope(messageId = "wamid.X", body = "hello") {
  return {
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
              messages: [{ id: messageId, from: "1555", timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body } }],
            },
          },
        ],
      },
    ],
  };
}

function sign(body: Buffer): string {
  return "sha256=" + createHmac("sha256", APP_SECRET).update(body).digest("hex");
}

describe("server integration: webhook → agent → outbound", () => {
  let tmp: string;
  let originalFetch: typeof globalThis.fetch;
  const fetchMock = vi.fn();

  function makeConfig(): ServerConfig {
    return {
      host: "127.0.0.1",
      port: 0,
      publicUrl: undefined,
      workspaceDir: tmp,
      logLevel: "fatal",
      webhook: { maxBodyBytes: 1_048_576, replayWindowS: 0 },
      whatsapp: {
        appSecret: APP_SECRET,
        accessToken: "TOK",
        phoneNumberId: "PNID",
        businessAccountId: "WABA",
        verifyToken: VERIFY_TOKEN,
        apiVersion: "v22.0",
      },
      llm: { provider: "anthropic", apiKey: "AK", model: "claude-opus-4-7" },
      egress: { extraAllowlist: ["api.anthropic.com"], mode: "enforce" },
      tenantId: "default",
    };
  }

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "crab-it-"));
    originalFetch = globalThis.fetch;
    fetchMock.mockReset();
    // Default: any fetch returns success.
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("api.anthropic.com")) {
        return new Response(
          JSON.stringify({ content: [{ type: "text", text: "Hi, Ada!" }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("graph.facebook.com")) {
        return new Response(
          JSON.stringify({ messaging_product: "whatsapp", contacts: [], messages: [{ id: "wamid.SENT" }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("verifies the GET handshake with the configured token", async () => {
    const app = await build(makeConfig());
    try {
      const res = await app.fastify.inject({
        method: "GET",
        url: `/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=42`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.body).toBe("42");

      const bad = await app.fastify.inject({
        method: "GET",
        url: `/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=42`,
      });
      expect(bad.statusCode).toBe(403);
    } finally {
      await app.shutdown();
    }
  });

  it("rejects unsigned POSTs", async () => {
    const app = await build(makeConfig());
    try {
      const body = Buffer.from(JSON.stringify(envelope()));
      const res = await app.fastify.inject({
        method: "POST",
        url: "/webhooks/whatsapp",
        headers: { "content-type": "application/json" },
        payload: body,
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.shutdown();
    }
  });

  it("rejects POSTs with a tampered body", async () => {
    const app = await build(makeConfig());
    try {
      const original = Buffer.from(JSON.stringify(envelope()));
      const sig = sign(original);
      const tampered = Buffer.from(JSON.stringify(envelope("wamid.X", "tampered")));
      const res = await app.fastify.inject({
        method: "POST",
        url: "/webhooks/whatsapp",
        headers: { "content-type": "application/json", "x-hub-signature-256": sig },
        payload: tampered,
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.shutdown();
    }
  });

  it("end-to-end: signed webhook → LLM → outbound WhatsApp send", async () => {
    const app = await build(makeConfig());
    try {
      const body = Buffer.from(JSON.stringify(envelope()));
      const res = await app.fastify.inject({
        method: "POST",
        url: "/webhooks/whatsapp",
        headers: { "content-type": "application/json", "x-hub-signature-256": sign(body) },
        payload: body,
      });
      expect(res.statusCode).toBe(200);

      // The actual processing happens on setImmediate; wait for it.
      await new Promise((r) => setTimeout(r, 200));

      const calledHosts = fetchMock.mock.calls.map((c) => c[0] as string);
      expect(calledHosts.some((u) => u.includes("api.anthropic.com"))).toBe(true);
      expect(calledHosts.some((u) => u.includes("graph.facebook.com"))).toBe(true);
    } finally {
      await app.shutdown();
    }
  });

  it("dedupes a replayed webhook with the same message id", async () => {
    const app = await build(makeConfig());
    try {
      const body = Buffer.from(JSON.stringify(envelope("wamid.DUPE")));
      const sig = sign(body);
      const headers = { "content-type": "application/json", "x-hub-signature-256": sig };
      await app.fastify.inject({ method: "POST", url: "/webhooks/whatsapp", headers, payload: body });
      await new Promise((r) => setTimeout(r, 100));
      const before = fetchMock.mock.calls.length;
      await app.fastify.inject({ method: "POST", url: "/webhooks/whatsapp", headers, payload: body });
      await new Promise((r) => setTimeout(r, 100));
      const after = fetchMock.mock.calls.length;
      // Second delivery should not have re-triggered an outbound send.
      expect(after - before).toBe(0);
    } finally {
      await app.shutdown();
    }
  });
});
