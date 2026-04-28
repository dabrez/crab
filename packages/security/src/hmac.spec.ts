import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { verifyHandshakeToken, verifyHmacSignature } from "./hmac.js";

const SECRET = "test-app-secret";
const BODY = Buffer.from(JSON.stringify({ entry: [{ id: "1" }] }));
const validSig = "sha256=" + createHmac("sha256", SECRET).update(BODY).digest("hex");

describe("verifyHmacSignature", () => {
  it("accepts a valid signature", () => {
    const r = verifyHmacSignature({ body: BODY, signatureHeader: validSig, secret: SECRET, maxBodyBytes: 1024 });
    expect(r.ok).toBe(true);
  });

  it("rejects a tampered body", () => {
    const tampered = Buffer.from(BODY.toString("utf8") + " ");
    const r = verifyHmacSignature({ body: tampered, signatureHeader: validSig, secret: SECRET, maxBodyBytes: 1024 });
    expect(r).toEqual({ ok: false, reason: "mismatch" });
  });

  it("rejects when signature header is missing", () => {
    const r = verifyHmacSignature({ body: BODY, signatureHeader: undefined, secret: SECRET, maxBodyBytes: 1024 });
    expect(r).toEqual({ ok: false, reason: "missing-signature" });
  });

  it("rejects malformed signature headers", () => {
    const cases = ["", "abcdef", "md5=abc", "sha256=zzz", "sha256="];
    for (const sig of cases) {
      const r = verifyHmacSignature({ body: BODY, signatureHeader: sig, secret: SECRET, maxBodyBytes: 1024 });
      expect(r.ok).toBe(false);
    }
  });

  it("rejects bodies over the size cap before hashing", () => {
    const big = Buffer.alloc(2048, 0x41);
    const sig = "sha256=" + createHmac("sha256", SECRET).update(big).digest("hex");
    const r = verifyHmacSignature({ body: big, signatureHeader: sig, secret: SECRET, maxBodyBytes: 1024 });
    expect(r).toEqual({ ok: false, reason: "body-too-large" });
  });

  it("rejects stale timestamps when a replay window is configured", () => {
    const stale = Math.floor(Date.now() / 1000) - 600;
    const r = verifyHmacSignature({
      body: BODY,
      signatureHeader: validSig,
      secret: SECRET,
      maxBodyBytes: 1024,
      timestamp: stale,
      replayWindowS: 60,
    });
    expect(r).toEqual({ ok: false, reason: "stale" });
  });

  it("accepts fresh timestamps inside the replay window", () => {
    const r = verifyHmacSignature({
      body: BODY,
      signatureHeader: validSig,
      secret: SECRET,
      maxBodyBytes: 1024,
      timestamp: Math.floor(Date.now() / 1000),
      replayWindowS: 60,
    });
    expect(r.ok).toBe(true);
  });
});

describe("verifyHandshakeToken", () => {
  it("matches identical tokens", () => {
    expect(verifyHandshakeToken("abc123", "abc123")).toBe(true);
  });
  it("rejects mismatched tokens", () => {
    expect(verifyHandshakeToken("abc123", "abc124")).toBe(false);
  });
  it("rejects different-length tokens", () => {
    expect(verifyHandshakeToken("abc", "abc123")).toBe(false);
  });
});
