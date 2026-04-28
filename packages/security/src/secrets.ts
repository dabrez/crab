import type { AuditLog } from "./audit.js";

/**
 * A SecretStore is the only sanctioned way to read sensitive values.
 *
 * Reads are audited so a leak can be reconstructed from the audit log alone.
 */
export interface SecretStore {
  get(key: string): Promise<string | undefined>;
  /** Throws if the secret is missing — convenience for required values. */
  require(key: string): Promise<string>;
  /** Replace a value. Used by token-rotation helpers. */
  set?(key: string, value: string): Promise<void>;
}

export interface EnvSecretStoreOptions {
  env?: NodeJS.ProcessEnv;
  audit?: AuditLog;
  /** Caller name for audit events (e.g. "whatsapp.api"). */
  caller?: string;
}

/** Reads secrets from process.env. The default for self-hosted deploys. */
export class EnvSecretStore implements SecretStore {
  private readonly env: NodeJS.ProcessEnv;
  private readonly audit?: AuditLog;
  private readonly caller: string;

  constructor(opts: EnvSecretStoreOptions = {}) {
    this.env = opts.env ?? process.env;
    if (opts.audit) this.audit = opts.audit;
    this.caller = opts.caller ?? "unknown";
  }

  async get(key: string): Promise<string | undefined> {
    const v = this.env[key];
    this.audit?.append({ kind: "secret.read", key, caller: this.caller, found: v !== undefined });
    return v;
  }

  async require(key: string): Promise<string> {
    const v = await this.get(key);
    if (!v) throw new MissingSecretError(key);
  return v;
  }
}

export class MissingSecretError extends Error {
  constructor(public readonly key: string) {
    super(`required secret missing: ${key}`);
    this.name = "MissingSecretError";
  }
}

/**
 * Pluggable KMS hook. Real implementations (AWS, GCP, Vault) live in their own
 * adapters; this is the contract.
 */
export interface KmsAdapter {
  decrypt(ciphertext: string): Promise<string>;
  encrypt(plaintext: string): Promise<string>;
}
