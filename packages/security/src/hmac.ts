import { createHmac, timingSafeEqual } from "node:crypto";

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: "missing-signature" | "bad-format" | "mismatch" | "body-too-large" | "stale" };

export interface VerifyOptions {
  /** Raw request body bytes — MUST be the bytes the signature was computed over. */
  body: Buffer;
  /** Value of the signature header (e.g. `sha256=abcdef...`). */
  signatureHeader: string | undefined;
  /** App secret used as the HMAC key. */
  secret: string;
  /** Hard cap on body size before we even hash. */
  maxBodyBytes: number;
  /** Optional unix-seconds timestamp from the request. If provided, enforce replayWindowS. */
  timestamp?: number;
  /** Reject requests older than this many seconds. Only used if timestamp is provided. */
  replayWindowS?: number;
  /** Algorithm; defaults to sha256. */
  algorithm?: "sha256";
}

/**
 * Verify a Meta-style HMAC webhook signature in constant time.
 *
 * Meta sends `X-Hub-Signature-256: sha256=<hex>` where the digest is HMAC-SHA256
 * of the raw request body keyed by the app secret.
 */
export function verifyHmacSignature(opts: VerifyOptions): VerifyResult {
  if (opts.body.byteLength > opts.maxBodyBytes) {
    return { ok: false, reason: "body-too-large" };
  }
  if (!opts.signatureHeader) {
    return { ok: false, reason: "missing-signature" };
  }

  const algorithm = opts.algorithm ?? "sha256";
  const prefix = `${algorithm}=`;
  if (!opts.signatureHeader.startsWith(prefix)) {
    return { ok: false, reason: "bad-format" };
  }

  const providedHex = opts.signatureHeader.slice(prefix.length);
  if (!/^[a-f0-9]+$/i.test(providedHex)) {
    return { ok: false, reason: "bad-format" };
  }

  let providedBuf: Buffer;
  try {
    providedBuf = Buffer.from(providedHex, "hex");
  } catch {
    return { ok: false, reason: "bad-format" };
  }

  const expectedBuf = createHmac(algorithm, opts.secret).update(opts.body).digest();
  if (providedBuf.byteLength !== expectedBuf.byteLength) {
    return { ok: false, reason: "mismatch" };
  }
  if (!timingSafeEqual(providedBuf, expectedBuf)) {
    return { ok: false, reason: "mismatch" };
  }

  if (opts.timestamp !== undefined && opts.replayWindowS !== undefined) {
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - opts.timestamp) > opts.replayWindowS) {
      return { ok: false, reason: "stale" };
    }
  }

  return { ok: true };
}

/** Verify Meta's GET-handshake `hub.verify_token` (constant-time). */
export function verifyHandshakeToken(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.byteLength !== b.byteLength) return false;
  return timingSafeEqual(a, b);
}
