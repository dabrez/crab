import type { LlmProvider, LlmTurn } from "@crab/core";
import type { EgressGuard } from "@crab/security/egress";

export interface AnthropicProviderOptions {
  apiKey: string;
  model?: string;
  egress: EgressGuard;
  apiBase?: string;
  /** Optional system prompt applied to every request. */
  system?: string;
}

interface AnthropicMessageRequest {
  model: string;
  max_tokens: number;
  system?: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}

interface AnthropicMessageResponse {
  content: Array<{ type: "text"; text: string }>;
}

/**
 * Minimal Anthropic Messages API client. Routes outbound traffic through the
 * EgressGuard so it's covered by the allowlist + SSRF defenses.
 *
 * The official @anthropic-ai/sdk would be a drop-in upgrade later; rolling our
 * own here keeps dependencies tiny and lets every outbound HTTP call go
 * through the same chokepoint.
 */
export class AnthropicProvider implements LlmProvider {
  private readonly apiBase: string;
  private readonly model: string;
  private readonly system?: string;

  constructor(private readonly opts: AnthropicProviderOptions) {
    this.apiBase = opts.apiBase ?? "https://api.anthropic.com";
    this.model = opts.model ?? "claude-opus-4-7";
    if (opts.system) this.system = opts.system;
  }

  async complete(turn: LlmTurn): Promise<{ text: string }> {
    const body: AnthropicMessageRequest = {
      model: this.model,
      max_tokens: turn.maxOutputTokens ?? 1024,
      messages: [...turn.history, { role: "user", content: turn.prompt }],
    };
    if (this.system) body.system = this.system;

    const init: RequestInit = {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.opts.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    };
    if (turn.signal) init.signal = turn.signal;

    const res = await this.opts.egress.fetch(`${this.apiBase}/v1/messages`, init);
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`anthropic ${res.status}: ${errBody.slice(0, 500)}`);
    }
    const json = (await res.json()) as AnthropicMessageResponse;
    const text = json.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("");
    return { text };
  }
}
