import type { Channel, ChannelId, DeliveryReceipt, IncomingMessage, MessageContent, OutgoingContent, OutgoingMessage, SendResult, TenantId } from "@crab/core";
import type { AuditLog } from "@crab/security/audit";
import { WhatsAppApi } from "./api.js";
import type { InboundEnvelope, InboundMessage, InboundStatus, OutboundRequest } from "./types.js";

export const WHATSAPP_CHANNEL_ID: ChannelId = "whatsapp";

export interface WhatsAppAdapterOptions {
  api: WhatsAppApi;
  tenantId: TenantId;
  /** The phone number id this adapter is bound to. Used to construct sessionIds. */
  phoneNumberId: string;
  audit?: AuditLog;
  /**
   * If true, when the 24-hour customer-service window has closed we skip
   * non-template outbound messages. v1 default: true.
   */
  enforceCustomerServiceWindow?: boolean;
}

const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Translates between the WhatsApp Cloud API wire format and Crab's
 * channel-agnostic types, and implements the `Channel` interface so the bus
 * can drive it.
 */
export class WhatsAppAdapter implements Channel {
  readonly id = WHATSAPP_CHANNEL_ID;
  private incomingHandler?: (msg: IncomingMessage) => Promise<void> | void;
  private receiptHandler?: (receipt: DeliveryReceipt) => Promise<void> | void;
  /** sessionId -> last inbound timestamp (ms). Tracks the 24h window. */
  private lastInboundAt = new Map<string, number>();

  constructor(private readonly opts: WhatsAppAdapterOptions) {}

  async init(): Promise<void> {
    // No-op for Cloud API: nothing to connect.
  }

  onIncoming(handler: (msg: IncomingMessage) => Promise<void> | void): void {
    this.incomingHandler = handler;
  }

  onReceipt(handler: (receipt: DeliveryReceipt) => Promise<void> | void): void {
    this.receiptHandler = handler;
  }

  async send(msg: OutgoingMessage): Promise<SendResult> {
    if (this.opts.enforceCustomerServiceWindow !== false) {
      const inWindow = this.isWithinCustomerServiceWindow(msg.sessionId);
      if (!inWindow && msg.content.type !== "template") {
        throw new Error(
          `outside 24-hour customer-service window for session ${msg.sessionId}; only 'template' messages allowed`,
        );
      }
    }
    const req = this.toOutboundRequest(msg.to.id, msg.content);
    const res = await this.opts.api.send(req);
    const externalId = res.messages[0]?.id ?? "";
    return { externalId };
  }

  async dispose(): Promise<void> {
    this.lastInboundAt.clear();
  }

  /**
   * Feed a verified inbound webhook payload through the adapter. Called by
   * the server route after webhook signature verification.
   */
  async ingest(envelope: InboundEnvelope): Promise<void> {
    for (const entry of envelope.entry) {
      for (const change of entry.changes) {
        const v = change.value;
        if (v.messages) {
          for (const m of v.messages) {
            const incoming = this.toIncomingMessage(m, v);
            if (incoming) {
              this.lastInboundAt.set(incoming.sessionId, incoming.timestamp * 1000);
              this.opts.audit?.append({
                kind: "webhook.accepted",
                channel: this.id,
                messageId: incoming.externalId,
              });
              await this.incomingHandler?.(incoming);
            }
          }
        }
        if (v.statuses) {
          for (const s of v.statuses) {
            await this.receiptHandler?.(this.toReceipt(s));
          }
        }
      }
    }
  }

  private isWithinCustomerServiceWindow(sessionId: string): boolean {
    const last = this.lastInboundAt.get(sessionId);
    if (!last) return false;
    return Date.now() - last < SESSION_WINDOW_MS;
  }

  private toIncomingMessage(m: InboundMessage, v: InboundEnvelope["entry"][number]["changes"][number]["value"]): IncomingMessage | undefined {
    const content = this.toMessageContent(m);
    if (!content) return undefined;
    const fromContact = v.contacts?.find((c) => c.wa_id === m.from);
    const sessionId = `${this.id}:${this.opts.phoneNumberId}:${m.from}`;
    const result: IncomingMessage = {
      tenantId: this.opts.tenantId,
      channel: this.id,
      sessionId,
      from: { id: m.from, ...(fromContact?.profile.name ? { name: fromContact.profile.name } : {}) },
      to: { id: v.metadata.phone_number_id },
      externalId: m.id,
      timestamp: parseInt(m.timestamp, 10),
      content,
    };
    return result;
  }

  private toMessageContent(m: InboundMessage): MessageContent | undefined {
    switch (m.type) {
      case "text":
        return { type: "text", text: m.text.body };
      case "image":
        return {
          type: "image",
          mediaId: m.image.id,
          ...(m.image.caption ? { caption: m.image.caption } : {}),
          ...(m.image.mime_type ? { mimeType: m.image.mime_type } : {}),
        };
      case "audio":
        return { type: "audio", mediaId: m.audio.id, ...(m.audio.mime_type ? { mimeType: m.audio.mime_type } : {}) };
      case "document":
        return {
          type: "document",
          mediaId: m.document.id,
          ...(m.document.filename ? { filename: m.document.filename } : {}),
          ...(m.document.mime_type ? { mimeType: m.document.mime_type } : {}),
        };
      case "interactive": {
        const i = m.interactive;
        if (i.type === "button_reply") {
          return { type: "interactive-reply", replyId: i.button_reply.id, replyTitle: i.button_reply.title };
        }
        if (i.type === "list_reply") {
          return { type: "interactive-reply", replyId: i.list_reply.id, replyTitle: i.list_reply.title };
        }
        return undefined;
      }
      case "system":
        return { type: "system", event: "wa-system", detail: m.system.body };
      default:
        return undefined;
    }
  }

  private toReceipt(s: InboundStatus): DeliveryReceipt {
    return {
      tenantId: this.opts.tenantId,
      channel: this.id,
      sessionId: `${this.id}:${this.opts.phoneNumberId}:${s.recipient_id}`,
      externalId: s.id,
      status: s.status,
      timestamp: parseInt(s.timestamp, 10),
      ...(s.errors?.[0]
        ? { error: { code: String(s.errors[0].code), message: s.errors[0].message ?? s.errors[0].title } }
        : {}),
    };
  }

  private toOutboundRequest(to: string, content: OutgoingContent): OutboundRequest {
    switch (content.type) {
      case "text":
        return { messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { body: content.text } };
      case "interactive-buttons":
        return {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to,
          type: "interactive",
          interactive: {
            type: "button",
            ...(content.header ? { header: { type: "text", text: content.header } } : {}),
            body: { text: content.body },
            ...(content.footer ? { footer: { text: content.footer } } : {}),
            action: {
              buttons: content.buttons.map((b) => ({ type: "reply" as const, reply: { id: b.id, title: b.title } })),
            },
          },
        };
      case "interactive-list":
        return {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to,
          type: "interactive",
          interactive: {
            type: "list",
            ...(content.header ? { header: { type: "text", text: content.header } } : {}),
            body: { text: content.body },
            ...(content.footer ? { footer: { text: content.footer } } : {}),
            action: {
              button: content.buttonText,
              sections: content.sections,
            },
          },
        };
      case "template":
        return {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to,
          type: "template",
          template: {
            name: content.name,
            language: { code: content.languageCode },
            ...(content.components ? { components: content.components } : {}),
          },
        };
      case "image":
        return {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to,
          type: "image",
          image: { link: content.url, ...(content.caption ? { caption: content.caption } : {}) },
        };
      case "reaction":
        return {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to,
          type: "reaction",
          reaction: { message_id: content.toMessageId, emoji: content.emoji },
        };
    }
  }
}
