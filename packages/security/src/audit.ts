import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export type AuditEvent =
  | { kind: "secret.read"; key: string; caller: string; found: boolean }
  | { kind: "egress.allowed"; url: string }
  | { kind: "egress.blocked.allowlist"; host: string; ip: string }
  | { kind: "egress.blocked.ssrf"; host: string; ip: string; reason: string }
  | { kind: "egress.queued"; host: string; ip: string }
  | { kind: "egress.approved"; host: string; approvedBy: string }
  | { kind: "webhook.accepted"; channel: string; messageId?: string }
  | { kind: "webhook.rejected"; channel: string; reason: string }
  | { kind: "channel.send"; channel: string; to: string; messageType: string }
  | { kind: "operator.action"; action: string; detail?: string };

export interface AuditLog {
  append(event: AuditEvent): void;
}

/** No-op log; useful in tests. */
export const nullAuditLog: AuditLog = { append: () => undefined };

/**
 * Append-only JSONL audit log. Writes are fire-and-forget (queued internally)
 * so callers don't need to await them.
 */
export class FileAuditLog implements AuditLog {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly path: string) {}

  append(event: AuditEvent): void {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...event }) + "\n";
    this.queue = this.queue
      .then(() => mkdir(dirname(this.path), { recursive: true }))
      .then(() => appendFile(this.path, line, { mode: 0o600 }))
      .catch((err) => {
        // Audit failures are themselves an alertable event — emit to stderr so
        // log shippers pick it up.
        console.error("[audit] failed to write event", err);
      });
  }

  async flush(): Promise<void> {
    await this.queue;
  }
}
