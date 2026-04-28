import Database, { type Database as Db } from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ApprovalRequest } from "@crab/security/egress";
import type { SessionId, SessionMemory, TenantId } from "@crab/core";
import type { Storage } from "./index.js";

export interface SqliteStorageOptions {
  /** Filesystem path to the database. */
  path: string;
}

export class SqliteStorage implements Storage {
  private readonly db: Db;

  constructor(opts: SqliteStorageOptions) {
    mkdirSync(dirname(opts.path), { recursive: true });
    this.db = new Database(opts.path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        tenant_id    TEXT NOT NULL,
        session_id   TEXT NOT NULL,
        seq          INTEGER NOT NULL,
        role         TEXT NOT NULL,
        content      TEXT NOT NULL,
        created_at   INTEGER NOT NULL,
        PRIMARY KEY (tenant_id, session_id, seq)
      );

      CREATE TABLE IF NOT EXISTS inbound_seen (
        tenant_id    TEXT NOT NULL,
        external_id  TEXT NOT NULL,
        seen_at      INTEGER NOT NULL,
        PRIMARY KEY (tenant_id, external_id)
      );

      CREATE TABLE IF NOT EXISTS approvals (
        tenant_id    TEXT NOT NULL,
        host         TEXT NOT NULL,
        state        TEXT NOT NULL CHECK (state IN ('pending','approved','denied')),
        resolved_ip  TEXT,
        reason       TEXT,
        created_at   INTEGER NOT NULL,
        decided_at   INTEGER,
        decided_by   TEXT,
        PRIMARY KEY (tenant_id, host)
      );
    `);
  }

  memory(tenantId: TenantId): SessionMemory {
    const append = this.db.prepare(`
      INSERT INTO messages (tenant_id, session_id, seq, role, content, created_at)
      VALUES (?, ?, COALESCE((SELECT MAX(seq) + 1 FROM messages WHERE tenant_id = ? AND session_id = ?), 0), ?, ?, ?)
    `);
    const recent = this.db.prepare(`
      SELECT role, content FROM messages
      WHERE tenant_id = ? AND session_id = ?
      ORDER BY seq DESC LIMIT ?
    `);

    return {
      async append(sessionId: SessionId, role: "user" | "assistant", content: string): Promise<void> {
        append.run(tenantId, sessionId, tenantId, sessionId, role, content, Date.now());
      },
      async recent(sessionId: SessionId, n: number) {
        const rows = recent.all(tenantId, sessionId, n) as Array<{ role: "user" | "assistant"; content: string }>;
        return rows.reverse();
      },
    };
  }

  approvalQueue(tenantId: TenantId) {
    const upsert = this.db.prepare(`
      INSERT INTO approvals (tenant_id, host, state, resolved_ip, reason, created_at)
      VALUES (?, ?, 'pending', ?, ?, ?)
      ON CONFLICT (tenant_id, host) DO NOTHING
    `);
    const isApproved = this.db.prepare(`
      SELECT 1 FROM approvals WHERE tenant_id = ? AND host = ? AND state = 'approved'
    `);
    const list = this.db.prepare(`
      SELECT host, resolved_ip AS resolvedIp, reason, created_at AS createdAt
      FROM approvals WHERE tenant_id = ? AND state = 'pending'
      ORDER BY created_at ASC
    `);
    const decide = this.db.prepare(`
      UPDATE approvals SET state = ?, decided_at = ?, decided_by = ?
      WHERE tenant_id = ? AND host = ?
    `);

    return {
      async enqueue(req: ApprovalRequest): Promise<void> {
        upsert.run(tenantId, req.host, req.resolvedIp, req.reason, req.createdAt);
      },
      async isApproved(host: string): Promise<boolean> {
        return isApproved.get(tenantId, host) !== undefined;
      },
      async list(): Promise<ApprovalRequest[]> {
        return list.all(tenantId) as ApprovalRequest[];
      },
      async approve(host: string, approvedBy: string): Promise<void> {
        decide.run("approved", Date.now(), approvedBy, tenantId, host);
      },
      async deny(host: string): Promise<void> {
        decide.run("denied", Date.now(), "operator", tenantId, host);
      },
    };
  }

  async recordInboundOnce(tenantId: TenantId, externalId: string): Promise<boolean> {
    const stmt = this.db.prepare(`
      INSERT INTO inbound_seen (tenant_id, external_id, seen_at)
      VALUES (?, ?, ?)
      ON CONFLICT (tenant_id, external_id) DO NOTHING
    `);
    const r = stmt.run(tenantId, externalId, Date.now());
    return r.changes === 1;
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
