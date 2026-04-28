import { homedir } from "node:os";
import { join } from "node:path";

export interface ServerConfig {
  host: string;
  port: number;
  publicUrl: string | undefined;
  workspaceDir: string;
  logLevel: string;
  webhook: {
    maxBodyBytes: number;
    replayWindowS: number;
  };
  whatsapp: {
    appSecret: string;
    accessToken: string;
    phoneNumberId: string;
    businessAccountId: string;
    verifyToken: string;
    apiVersion: string;
  };
  llm: {
    provider: "anthropic";
    apiKey: string;
    model: string;
  };
  egress: {
    extraAllowlist: string[];
    mode: "enforce" | "approve";
  };
  tenantId: string;
}

function expandHome(p: string): string {
  return p.startsWith("~") ? join(homedir(), p.slice(1)) : p;
}

function req(env: NodeJS.ProcessEnv, key: string): string {
  const v = env[key];
  if (!v) throw new Error(`required env var missing: ${key}`);
  return v;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const workspaceDir = expandHome(env.CRAB_WORKSPACE_DIR ?? "~/.crab/workspace");
  const result: ServerConfig = {
    host: env.CRAB_HOST ?? "0.0.0.0",
    port: Number(env.CRAB_PORT ?? 3000),
    publicUrl: env.CRAB_PUBLIC_URL,
    workspaceDir,
    logLevel: env.CRAB_LOG_LEVEL ?? "info",
    webhook: {
      maxBodyBytes: Number(env.CRAB_WEBHOOK_MAX_BODY_BYTES ?? 1_048_576),
      replayWindowS: Number(env.CRAB_WEBHOOK_REPLAY_WINDOW_S ?? 300),
    },
    whatsapp: {
      appSecret: req(env, "WHATSAPP_APP_SECRET"),
      accessToken: req(env, "WHATSAPP_ACCESS_TOKEN"),
      phoneNumberId: req(env, "WHATSAPP_PHONE_NUMBER_ID"),
      businessAccountId: env.WHATSAPP_BUSINESS_ACCOUNT_ID ?? "",
      verifyToken: req(env, "WHATSAPP_VERIFY_TOKEN"),
      apiVersion: env.WHATSAPP_API_VERSION ?? "v22.0",
    },
    llm: {
      provider: "anthropic",
      apiKey: req(env, "ANTHROPIC_API_KEY"),
      model: env.CRAB_LLM_MODEL ?? "claude-opus-4-7",
    },
    egress: {
      extraAllowlist: (env.CRAB_EGRESS_ALLOWLIST ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      mode: (env.CRAB_EGRESS_MODE === "enforce" ? "enforce" : "approve"),
    },
    tenantId: "default",
  };
  return result;
}
