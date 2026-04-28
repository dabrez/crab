import type { ApprovalQueue, ApprovalRequest } from "@crab/security/egress";
import type { SessionMemory, TenantId } from "@crab/core";

/**
 * Storage interface. Every method takes a `tenantId` so the same storage
 * backend can serve multi-tenant later without changing call sites.
 */
export interface Storage {
  memory(tenantId: TenantId): SessionMemory;
  approvalQueue(tenantId: TenantId): ApprovalQueue & {
    list(): Promise<ApprovalRequest[]>;
    approve(host: string, approvedBy: string): Promise<void>;
    deny(host: string): Promise<void>;
  };
  /** Dedupe key store for inbound webhooks. Returns true if newly inserted. */
  recordInboundOnce(tenantId: TenantId, externalId: string): Promise<boolean>;
  close(): Promise<void>;
}

export { SqliteStorage } from "./sqlite.js";
