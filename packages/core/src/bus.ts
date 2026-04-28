import type { AuditLog } from "@crab/security/audit";
import type { Channel, ChannelId, DeliveryReceipt, IncomingMessage, OutgoingMessage, SendResult } from "./types.js";

export type IncomingHandler = (msg: IncomingMessage) => Promise<void> | void;
export type ReceiptHandler = (receipt: DeliveryReceipt) => Promise<void> | void;

export interface MessageBusOptions {
  audit?: AuditLog;
}

/**
 * Routes inbound channel events to subscribers and outbound actions to channels.
 *
 * Subscribers (the agent) only ever talk to the bus, never directly to a channel.
 * That decoupling is what lets us add channels later without touching agent code.
 */
export class MessageBus {
  private readonly channels = new Map<ChannelId, Channel>();
  private readonly incomingHandlers = new Set<IncomingHandler>();
  private readonly receiptHandlers = new Set<ReceiptHandler>();
  private readonly audit?: AuditLog;

  constructor(opts: MessageBusOptions = {}) {
    if (opts.audit) this.audit = opts.audit;
  }

  registerChannel(channel: Channel): void {
    if (this.channels.has(channel.id)) {
      throw new Error(`channel already registered: ${channel.id}`);
    }
    this.channels.set(channel.id, channel);
    channel.onIncoming(async (msg) => {
      for (const h of this.incomingHandlers) {
        await h(msg);
      }
    });
    channel.onReceipt(async (r) => {
      for (const h of this.receiptHandlers) {
        await h(r);
      }
    });
  }

  onIncoming(handler: IncomingHandler): () => void {
    this.incomingHandlers.add(handler);
    return () => this.incomingHandlers.delete(handler);
  }

  onReceipt(handler: ReceiptHandler): () => void {
    this.receiptHandlers.add(handler);
    return () => this.receiptHandlers.delete(handler);
  }

  async send(msg: OutgoingMessage): Promise<SendResult> {
    const channel = this.channels.get(msg.channel);
    if (!channel) throw new Error(`unknown channel: ${msg.channel}`);
    this.audit?.append({
      kind: "channel.send",
      channel: msg.channel,
      to: msg.to.id,
      messageType: msg.content.type,
    });
    return channel.send(msg);
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.channels.values()].map((c) => c.dispose()));
    this.channels.clear();
    this.incomingHandlers.clear();
    this.receiptHandlers.clear();
  }
}
