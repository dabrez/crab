import type { IncomingMessage, OutgoingMessage, SessionId } from "./types.js";
import type { MessageBus } from "./bus.js";

/** Minimal LLM interface so core doesn't import a specific provider. */
export interface LlmTurn {
  /** Free-form input from the user. */
  prompt: string;
  /** Prior conversation, oldest-first. Caller is responsible for truncating. */
  history: Array<{ role: "user" | "assistant"; content: string }>;
  /** Hard cap so a runaway loop is bounded. */
  maxOutputTokens?: number;
  /** Cancellation. */
  signal?: AbortSignal;
}

export interface LlmProvider {
  complete(turn: LlmTurn): Promise<{ text: string }>;
}

export interface SessionMemory {
  /** Append a turn to a session's history. */
  append(sessionId: SessionId, role: "user" | "assistant", content: string): Promise<void>;
  /** Get the most recent N turns for prompt construction. */
  recent(sessionId: SessionId, n: number): Promise<Array<{ role: "user" | "assistant"; content: string }>>;
}

export interface AgentOptions {
  bus: MessageBus;
  llm: LlmProvider;
  memory: SessionMemory;
  /** System prompt prepended to every turn. */
  systemPrompt?: string;
  /** History window. Default 20. */
  historyTurns?: number;
  /** Hard limit on response tokens. Default 1024. */
  maxOutputTokens?: number;
  /** If true, only respond to text messages (skip media for v1). */
  textOnly?: boolean;
}

/**
 * The agent: subscribes to inbound messages, runs an LLM completion, sends the
 * reply back through the bus.
 */
export class Agent {
  private unsubscribe?: () => void;
  private readonly inFlight = new Map<SessionId, AbortController>();

  constructor(private readonly opts: AgentOptions) {}

  start(): void {
    this.unsubscribe = this.opts.bus.onIncoming((msg) => this.handle(msg));
  }

  stop(): void {
    this.unsubscribe?.();
    for (const ctrl of this.inFlight.values()) ctrl.abort();
    this.inFlight.clear();
  }

  private extractText(msg: IncomingMessage): string | undefined {
    if (msg.content.type === "text") return msg.content.text;
    if (msg.content.type === "interactive-reply") return msg.content.replyTitle ?? msg.content.replyId;
    return undefined;
  }

  private async handle(msg: IncomingMessage): Promise<void> {
    const text = this.extractText(msg);
    if (text === undefined) {
      if (this.opts.textOnly) return;
      // Non-text content: surface a generic acknowledgment for v1.
      await this.reply(msg, "I received a non-text message. Text-only support is enabled.");
      return;
    }

    // Cancel any prior in-flight completion for this session — most recent
    // user message wins.
    this.inFlight.get(msg.sessionId)?.abort();
    const ctrl = new AbortController();
    this.inFlight.set(msg.sessionId, ctrl);

    try {
      await this.opts.memory.append(msg.sessionId, "user", text);
      const history = await this.opts.memory.recent(msg.sessionId, this.opts.historyTurns ?? 20);
      const promptHistory = this.opts.systemPrompt
        ? [{ role: "user" as const, content: `[system]\n${this.opts.systemPrompt}` }, ...history.slice(0, -1)]
        : history.slice(0, -1);

      const result = await this.opts.llm.complete({
        prompt: text,
        history: promptHistory,
        maxOutputTokens: this.opts.maxOutputTokens ?? 1024,
        signal: ctrl.signal,
      });

      await this.opts.memory.append(msg.sessionId, "assistant", result.text);
      await this.reply(msg, result.text);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      console.error("[agent] completion failed", err);
      await this.reply(msg, "Sorry, something went wrong on my end. Please try again.");
    } finally {
      if (this.inFlight.get(msg.sessionId) === ctrl) this.inFlight.delete(msg.sessionId);
    }
  }

  private async reply(incoming: IncomingMessage, text: string): Promise<void> {
    const out: OutgoingMessage = {
      tenantId: incoming.tenantId,
      channel: incoming.channel,
      sessionId: incoming.sessionId,
      to: incoming.from,
      content: { type: "text", text },
    };
    await this.opts.bus.send(out);
  }
}

/** In-memory session memory. The storage package provides a persistent version. */
export class InMemorySessionMemory implements SessionMemory {
  private readonly store = new Map<SessionId, Array<{ role: "user" | "assistant"; content: string }>>();

  async append(sessionId: SessionId, role: "user" | "assistant", content: string): Promise<void> {
    const arr = this.store.get(sessionId) ?? [];
    arr.push({ role, content });
    this.store.set(sessionId, arr);
  }

  async recent(sessionId: SessionId, n: number): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
    const arr = this.store.get(sessionId) ?? [];
    return arr.slice(Math.max(0, arr.length - n));
  }
}
