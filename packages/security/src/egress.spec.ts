import { describe, expect, it } from "vitest";
import { EgressDeniedError, createEgressGuard, hostMatchesAllowlist, type ApprovalQueue, type ApprovalRequest } from "./egress.js";

describe("hostMatchesAllowlist", () => {
  it("matches exact hosts", () => {
    expect(hostMatchesAllowlist("graph.facebook.com", ["graph.facebook.com"])).toBe(true);
  });
  it("matches wildcard suffixes", () => {
    expect(hostMatchesAllowlist("api.us.anthropic.com", ["*.anthropic.com"])).toBe(true);
  });
  it("rejects unrelated hosts", () => {
    expect(hostMatchesAllowlist("evil.example.com", ["graph.facebook.com"])).toBe(false);
  });
  it("is case-insensitive", () => {
    expect(hostMatchesAllowlist("GRAPH.facebook.com", ["graph.facebook.com"])).toBe(true);
  });
});

describe("createEgressGuard", () => {
  it("allows ip-literal allowlist hosts", async () => {
    const g = createEgressGuard({ allowlist: ["8.8.8.8"], mode: "enforce" });
    const r = await g.check("https://8.8.8.8/");
    expect(r.host).toBe("8.8.8.8");
  });

  it("rejects loopback IPs (SSRF guard)", async () => {
    const g = createEgressGuard({ allowlist: ["127.0.0.1"], mode: "enforce" });
    await expect(g.check("https://127.0.0.1/")).rejects.toBeInstanceOf(EgressDeniedError);
  });

  it("rejects RFC1918 IPs (SSRF guard)", async () => {
    const g = createEgressGuard({ allowlist: ["10.0.0.5"], mode: "enforce" });
    await expect(g.check("https://10.0.0.5/")).rejects.toMatchObject({ reasonCode: "private-ip" });
  });

  it("rejects link-local IPs (SSRF guard)", async () => {
    const g = createEgressGuard({ allowlist: ["169.254.169.254"], mode: "enforce" });
    // Even though metadata IP would be allowlisted, SSRF guard fires first.
    await expect(g.check("https://169.254.169.254/")).rejects.toMatchObject({ reasonCode: "link-local" });
  });

  it("rejects non-allowlisted public hosts in enforce mode", async () => {
    const g = createEgressGuard({ allowlist: ["8.8.8.8"], mode: "enforce" });
    await expect(g.check("https://1.1.1.1/")).rejects.toMatchObject({ reasonCode: "not-allowlisted" });
  });

  it("queues for approval in approve mode", async () => {
    const queued: ApprovalRequest[] = [];
    const queue: ApprovalQueue = {
      enqueue: async (r) => void queued.push(r),
      isApproved: async () => false,
    };
    const g = createEgressGuard({ allowlist: [], mode: "approve", approvalQueue: queue });
    await expect(g.check("https://1.1.1.1/")).rejects.toMatchObject({ reasonCode: "pending-approval" });
    expect(queued).toHaveLength(1);
    expect(queued[0]!.host).toBe("1.1.1.1");
  });

  it("allows previously-approved hosts", async () => {
    const queue: ApprovalQueue = {
      enqueue: async () => undefined,
      isApproved: async (h) => h === "1.1.1.1",
    };
    const g = createEgressGuard({ allowlist: [], mode: "approve", approvalQueue: queue });
    const r = await g.check("https://1.1.1.1/");
    expect(r.host).toBe("1.1.1.1");
  });

  it("rejects non-http(s) schemes", async () => {
    const g = createEgressGuard({ allowlist: ["*"], mode: "enforce" });
    await expect(g.check("file:///etc/passwd")).rejects.toMatchObject({ reasonCode: "invalid-host" });
  });
});
