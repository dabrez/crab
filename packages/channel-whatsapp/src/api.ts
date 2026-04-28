import type { EgressGuard } from "@crab/security/egress";
import type { OutboundRequest, SendResponse } from "./types.js";

export interface WhatsAppApiOptions {
  accessToken: string;
  phoneNumberId: string;
  egress: EgressGuard;
  apiVersion?: string;
  apiBase?: string;
}

export class WhatsAppApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: number | undefined,
    public readonly title: string | undefined,
    public readonly raw: unknown,
  ) {
    super(`WhatsApp API ${status}: ${title ?? "error"} (code=${code ?? "?"})`);
    this.name = "WhatsAppApiError";
  }
}

/**
 * Thin client for the WhatsApp Business Cloud API.
 *
 * Every outbound HTTP call goes through the EgressGuard so the allowlist /
 * SSRF / approval policy applies uniformly.
 */
export class WhatsAppApi {
  private readonly endpoint: string;

  constructor(private readonly opts: WhatsAppApiOptions) {
    const base = opts.apiBase ?? "https://graph.facebook.com";
    const ver = opts.apiVersion ?? "v22.0";
    this.endpoint = `${base}/${ver}/${opts.phoneNumberId}/messages`;
  }

  async send(req: OutboundRequest): Promise<SendResponse> {
    const res = await this.opts.egress.fetch(this.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.opts.accessToken}`,
      },
      body: JSON.stringify(req),
    });
    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new WhatsAppApiError(res.status, undefined, "non-JSON response", text);
    }
    if (!res.ok) {
      const e = (json as { error?: { code?: number; message?: string } }).error;
      throw new WhatsAppApiError(res.status, e?.code, e?.message, json);
    }
    return json as SendResponse;
  }

  /** Mark a previously-received message as read. */
  async markRead(messageId: string): Promise<void> {
    await this.send({
      messaging_product: "whatsapp",
      status: "read",
      message_id: messageId,
    } as OutboundRequest);
  }
}
