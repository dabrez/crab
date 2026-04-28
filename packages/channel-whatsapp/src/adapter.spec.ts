import { describe, expect, it, vi } from "vitest";
import type { IncomingMessage, OutgoingMessage } from "@crab/core";
import { WhatsAppAdapter } from "./adapter.js";
import type { WhatsAppApi } from "./api.js";
import type { InboundEnvelope } from "./types.js";

function makeAdapter(api: Pick<WhatsAppApi, "send">) {
  return new WhatsAppAdapter({
    api: api as WhatsAppApi,
    tenantId: "default",
    phoneNumberId: "PNID",
  });
}

const ENVELOPE_TEXT: InboundEnvelope = {
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

describe("WhatsAppAdapter.ingest", () => {
  it("translates text messages to core IncomingMessage and fires the handler", async () => {
    const a = makeAdapter({ send: vi.fn() });
    const seen: IncomingMessage[] = [];
    a.onIncoming((m) => void seen.push(m));
    await a.ingest(ENVELOPE_TEXT);
    expect(seen).toHaveLength(1);
    const m = seen[0]!;
    expect(m.from).toMatchObject({ id: "1555", name: "Ada" });
    expect(m.to).toMatchObject({ id: "PNID" });
    expect(m.sessionId).toBe("whatsapp:PNID:1555");
    expect(m.externalId).toBe("wamid.X");
    expect(m.timestamp).toBe(100);
    if (m.content.type !== "text") throw new Error("expected text");
    expect(m.content.text).toBe("hi");
  });

  it("translates interactive button replies to interactive-reply", async () => {
    const a = makeAdapter({ send: vi.fn() });
    const seen: IncomingMessage[] = [];
    a.onIncoming((m) => void seen.push(m));
    await a.ingest({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "E",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: { display_phone_number: "1", phone_number_id: "PNID" },
                messages: [
                  {
                    id: "wamid.btn",
                    from: "1555",
                    timestamp: "100",
                    type: "interactive",
                    interactive: { type: "button_reply", button_reply: { id: "yes", title: "Yes" } },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    const c = seen[0]!.content;
    if (c.type !== "interactive-reply") throw new Error("expected interactive-reply");
    expect(c.replyId).toBe("yes");
    expect(c.replyTitle).toBe("Yes");
  });

  it("forwards delivery statuses", async () => {
    const a = makeAdapter({ send: vi.fn() });
    const recs: unknown[] = [];
    a.onReceipt((r) => void recs.push(r));
    await a.ingest({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "E",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: { display_phone_number: "1", phone_number_id: "PNID" },
                statuses: [{ id: "wamid.Y", status: "delivered", timestamp: "200", recipient_id: "1555" }],
              },
            },
          ],
        },
      ],
    });
    expect(recs).toHaveLength(1);
  });
});

describe("WhatsAppAdapter.send", () => {
  it("constructs a correct WhatsApp text outbound request", async () => {
    const send = vi.fn().mockResolvedValue({ messages: [{ id: "wamid.SENT" }] });
    const a = makeAdapter({ send });
    await a.ingest(ENVELOPE_TEXT); // open the customer-service window
    const msg: OutgoingMessage = {
      tenantId: "default",
      channel: "whatsapp",
      sessionId: "whatsapp:PNID:1555",
      to: { id: "1555" },
      content: { type: "text", text: "hello" },
    };
    const result = await a.send(msg);
    expect(result.externalId).toBe("wamid.SENT");
    expect(send).toHaveBeenCalledWith({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "1555",
      type: "text",
      text: { body: "hello" },
    });
  });

  it("constructs an interactive-buttons request", async () => {
    const send = vi.fn().mockResolvedValue({ messages: [{ id: "x" }] });
    const a = makeAdapter({ send });
    await a.ingest(ENVELOPE_TEXT);
    await a.send({
      tenantId: "default",
      channel: "whatsapp",
      sessionId: "whatsapp:PNID:1555",
      to: { id: "1555" },
      content: {
        type: "interactive-buttons",
        body: "Pick one",
        buttons: [
          { id: "a", title: "A" },
          { id: "b", title: "B" },
        ],
      },
    });
    const arg = send.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.type).toBe("interactive");
    const interactive = arg.interactive as { type: string; action: { buttons: unknown[] } };
    expect(interactive.type).toBe("button");
    expect(interactive.action.buttons).toHaveLength(2);
  });

  it("rejects non-template sends outside the 24h customer-service window", async () => {
    const send = vi.fn();
    const a = makeAdapter({ send });
    await expect(
      a.send({
        tenantId: "default",
        channel: "whatsapp",
        sessionId: "whatsapp:PNID:1555",
        to: { id: "1555" },
        content: { type: "text", text: "hi" },
      }),
    ).rejects.toThrow(/customer-service window/);
    expect(send).not.toHaveBeenCalled();
  });

  it("allows template sends outside the 24h window", async () => {
    const send = vi.fn().mockResolvedValue({ messages: [{ id: "x" }] });
    const a = makeAdapter({ send });
    await a.send({
      tenantId: "default",
      channel: "whatsapp",
      sessionId: "whatsapp:PNID:1555",
      to: { id: "1555" },
      content: { type: "template", name: "hello_world", languageCode: "en_US" },
    });
    expect(send).toHaveBeenCalledTimes(1);
  });
});
