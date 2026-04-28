import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { AuditLog } from "./audit.js";

export type EgressMode = "enforce" | "approve";

export interface EgressPolicy {
  /** Hosts that are always allowed (exact match or trailing wildcard like `*.example.com`). */
  allowlist: string[];
  /** What to do when a host is not on the allowlist. */
  mode: EgressMode;
  /** Optional sink for approval requests when mode = 'approve'. */
  approvalQueue?: ApprovalQueue;
  /** Optional audit log. */
  audit?: AuditLog;
}

export interface ApprovalRequest {
  host: string;
  resolvedIp: string;
  reason: string;
  createdAt: number;
}

export interface ApprovalQueue {
  enqueue(req: ApprovalRequest): Promise<void>;
  isApproved(host: string): Promise<boolean>;
}

export class EgressDeniedError extends Error {
  constructor(
    public readonly host: string,
    public readonly reasonCode: "not-allowlisted" | "private-ip" | "loopback" | "link-local" | "invalid-host" | "pending-approval",
  ) {
    super(`egress denied: ${host} (${reasonCode})`);
    this.name = "EgressDeniedError";
  }
}

const PRIVATE_V4_RANGES: ReadonlyArray<readonly [number, number]> = [
  [ip4("10.0.0.0"), ip4("10.255.255.255")],
  [ip4("172.16.0.0"), ip4("172.31.255.255")],
  [ip4("192.168.0.0"), ip4("192.168.255.255")],
  [ip4("100.64.0.0"), ip4("100.127.255.255")],
];
const LOOPBACK_V4: readonly [number, number] = [ip4("127.0.0.0"), ip4("127.255.255.255")];
const LINK_LOCAL_V4: readonly [number, number] = [ip4("169.254.0.0"), ip4("169.254.255.255")];

function ip4(s: string): number {
  const parts = s.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    throw new Error(`bad ipv4: ${s}`);
  }
  return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
}

function inRange(addr: number, range: readonly [number, number]): boolean {
  return addr >= range[0] && addr <= range[1];
}

function classifyV4(addr: number): "ok" | "loopback" | "private" | "link-local" {
  if (inRange(addr, LOOPBACK_V4)) return "loopback";
  if (inRange(addr, LINK_LOCAL_V4)) return "link-local";
  for (const r of PRIVATE_V4_RANGES) if (inRange(addr, r)) return "private";
  return "ok";
}

function classifyV6(addr: string): "ok" | "loopback" | "private" | "link-local" {
  const lower = addr.toLowerCase();
  if (lower === "::1") return "loopback";
  if (lower.startsWith("fe80:") || lower.startsWith("fe80::")) return "link-local";
  // Unique local addresses fc00::/7
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return "private";
  // IPv4-mapped: ::ffff:a.b.c.d — extract the v4 portion
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return classifyV4(ip4(mapped[1]!));
  return "ok";
}

export function hostMatchesAllowlist(host: string, allowlist: readonly string[]): boolean {
  const h = host.toLowerCase();
  for (const entry of allowlist) {
    const e = entry.toLowerCase();
    if (e === h) return true;
    if (e.startsWith("*.")) {
      const suffix = e.slice(1); // ".example.com"
      if (h.endsWith(suffix)) return true;
    }
  }
  return false;
}

export interface EgressGuard {
  check(url: string): Promise<{ host: string; resolvedIp: string }>;
  fetch(input: string | URL, init?: RequestInit): Promise<Response>;
}

export function createEgressGuard(policy: EgressPolicy): EgressGuard {
  async function resolveAndClassify(host: string): Promise<{ ip: string; cls: "ok" | "loopback" | "private" | "link-local" }> {
    if (isIP(host)) {
      const v = isIP(host);
      const cls = v === 4 ? classifyV4(ip4(host)) : classifyV6(host);
      return { ip: host, cls };
    }
    const { address, family } = await lookup(host, { verbatim: true });
    const cls = family === 4 ? classifyV4(ip4(address)) : classifyV6(address);
    return { ip: address, cls };
  }

  async function check(url: string): Promise<{ host: string; resolvedIp: string }> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new EgressDeniedError(url, "invalid-host");
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new EgressDeniedError(parsed.host, "invalid-host");
    }
    const host = parsed.hostname;

    const { ip, cls } = await resolveAndClassify(host);
    if (cls !== "ok") {
      policy.audit?.append({
        kind: "egress.blocked.ssrf",
        host,
        ip,
        reason: cls,
      });
      throw new EgressDeniedError(host, cls === "loopback" ? "loopback" : cls === "link-local" ? "link-local" : "private-ip");
    }

    if (hostMatchesAllowlist(host, policy.allowlist)) {
      return { host, resolvedIp: ip };
    }

    if (policy.mode === "approve" && policy.approvalQueue) {
      const approved = await policy.approvalQueue.isApproved(host);
      if (approved) {
        return { host, resolvedIp: ip };
      }
      await policy.approvalQueue.enqueue({
        host,
        resolvedIp: ip,
        reason: "not on allowlist",
        createdAt: Math.floor(Date.now() / 1000),
      });
      policy.audit?.append({ kind: "egress.queued", host, ip });
      throw new EgressDeniedError(host, "pending-approval");
    }

    policy.audit?.append({ kind: "egress.blocked.allowlist", host, ip });
    throw new EgressDeniedError(host, "not-allowlisted");
  }

  async function guardedFetch(input: string | URL, init?: RequestInit): Promise<Response> {
    const url = typeof input === "string" ? input : input.toString();
    await check(url);
    policy.audit?.append({ kind: "egress.allowed", url });
    return fetch(input, init);
  }

  return { check, fetch: guardedFetch };
}
