/**
 * Channel-agnostic message and event types.
 *
 * These mirror the OpenClaw plugin model so a Channel here could in principle
 * be ported to OpenClaw with a thin shim. The shape is deliberately small —
 * channel-specific richness lives in `metadata`.
 */

export type TenantId = string; // "default" in single-tenant v1
export type ChannelId = string; // e.g. "whatsapp"
export type SessionId = string; // per-conversation, namespaced by channel

export interface PartyRef {
  /** Channel-native identifier (phone number, user id, etc.) */
  id: string;
  /** Optional display name. */
  name?: string;
}

export type MessageContent =
  | { type: "text"; text: string }
  | { type: "image"; mediaId: string; caption?: string; mimeType?: string }
  | { type: "audio"; mediaId: string; mimeType?: string }
  | { type: "document"; mediaId: string; filename?: string; mimeType?: string }
  | { type: "interactive-reply"; replyId: string; replyTitle?: string }
  | { type: "system"; event: string; detail?: string };

export interface IncomingMessage {
  tenantId: TenantId;
  channel: ChannelId;
  sessionId: SessionId;
  from: PartyRef;
  to: PartyRef;
  /** Channel-native message id (for dedupe). */
  externalId: string;
  /** Unix seconds. */
  timestamp: number;
  content: MessageContent;
  /** Channel-specific extras. Keep free-form so channels can grow. */
  metadata?: Record<string, unknown>;
}

export type OutgoingContent =
  | { type: "text"; text: string }
  | {
      type: "interactive-buttons";
      body: string;
      header?: string;
      footer?: string;
      buttons: Array<{ id: string; title: string }>;
    }
  | {
      type: "interactive-list";
      body: string;
      header?: string;
      footer?: string;
      buttonText: string;
      sections: Array<{
        title?: string;
        rows: Array<{ id: string; title: string; description?: string }>;
      }>;
    }
  | { type: "template"; name: string; languageCode: string; components?: unknown[] }
  | { type: "image"; url: string; caption?: string }
  | { type: "reaction"; toMessageId: string; emoji: string };

export interface OutgoingMessage {
  tenantId: TenantId;
  channel: ChannelId;
  sessionId: SessionId;
  to: PartyRef;
  content: OutgoingContent;
  /** Optional client-supplied id for delivery tracking. */
  clientRef?: string;
}

export type MessageStatus = "sent" | "delivered" | "read" | "failed";

export interface DeliveryReceipt {
  tenantId: TenantId;
  channel: ChannelId;
  sessionId: SessionId;
  externalId: string;
  status: MessageStatus;
  timestamp: number;
  error?: { code: string; message: string };
}

export interface SendResult {
  externalId: string;
}

/**
 * A Channel is the plugin contract. WhatsApp is one implementation; Telegram,
 * Discord, etc. would be others.
 */
export interface Channel {
  readonly id: ChannelId;
  init(): Promise<void>;
  send(message: OutgoingMessage): Promise<SendResult>;
  /** Channel pushes inbound events through this callback. */
  onIncoming(handler: (msg: IncomingMessage) => Promise<void> | void): void;
  /** Channel pushes delivery status updates through this callback. */
  onReceipt(handler: (receipt: DeliveryReceipt) => Promise<void> | void): void;
  dispose(): Promise<void>;
}
