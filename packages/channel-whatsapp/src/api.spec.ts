import { describe, expect, it, vi } from "vitest";
import { WhatsAppApi, WhatsAppApiError } from "./api.js";
import type { EgressGuard } from "@crab/security";

function fakeEgress(fetch: typeof globalThis.fetch): EgressGuard {
  return {
    async check() {
      return { host: "graph.facebook.com", resolvedIp: "1.2.3.4" };
    },
    fetch: (input, init) => fetch(input as string, init),
  };
}

describe("WhatsAppApi.send", () => {
  it("targets the Cloud API endpoint with the expected version and id", async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://graph.facebook.com/v22.0/PNID/messages");
      expect(init.method).toBe("POST");
      expect((init.headers as Record<string, string>).authorization).toBe("Bearer TOK");
      return new Response(JSON.stringify({ messaging_product: "whatsapp", contacts: [], messages: [{ id: "wamid.SENT" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const api = new WhatsAppApi({ accessToken: "TOK", phoneNumberId: "PNID", egress: fakeEgress(fetchMock as unknown as typeof globalThis.fetch) });
    const r = await api.send({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "1555",
      type: "text",
      text: { body: "hi" },
    });
    expect(r.messages[0]!.id).toBe("wamid.SENT");
  });

  it("throws WhatsAppApiError with status + code when Meta returns an error", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ error: { code: 131030, message: "Recipient phone number not in allowed list" } }), {
        status: 400,
      }),
    );
    const api = new WhatsAppApi({ accessToken: "TOK", phoneNumberId: "PNID", egress: fakeEgress(fetchMock as unknown as typeof globalThis.fetch) });
    await expect(
      api.send({ messaging_product: "whatsapp", to: "1555", type: "text", text: { body: "hi" } }),
    ).rejects.toBeInstanceOf(WhatsAppApiError);
  });

  it("respects custom api version", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain("/v23.0/");
      return new Response(JSON.stringify({ messages: [{ id: "x" }] }), { status: 200 });
    });
    const api = new WhatsAppApi({
      accessToken: "TOK",
      phoneNumberId: "PNID",
      egress: fakeEgress(fetchMock as unknown as typeof globalThis.fetch),
      apiVersion: "v23.0",
    });
    await api.send({ messaging_product: "whatsapp", to: "1", type: "text", text: { body: "hi" } });
  });
});
