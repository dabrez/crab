import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { ask, askRequired, close, confirm, info } from "../prompt.js";
import { defaultWorkspaceDir, readConfig, renderEnvFile, writeConfig, type WorkspaceConfig } from "../workspace.js";

const META_DASHBOARD = "https://developers.facebook.com/apps";
const WA_DOCS = "https://developers.facebook.com/docs/whatsapp/cloud-api/get-started";

export interface OnboardOptions {
  workspaceDir?: string;
  /** If true, skip the test message round-trip. */
  skipTest?: boolean;
}

export async function onboard(opts: OnboardOptions = {}): Promise<void> {
  const workspaceDir = opts.workspaceDir ?? defaultWorkspaceDir();
  info("");
  info("=== crab onboarding ===");
  info("This wizard will set up the WhatsApp Business Cloud API channel.");
  info("");

  const existing = await readConfig(workspaceDir);
  if (existing) {
    const overwrite = await confirm(
      `Existing config found at ${join(workspaceDir, "config.json")}. Overwrite?`,
      false,
    );
    if (!overwrite) {
      info("Keeping existing config. Run 'crab doctor' to validate it.");
      close();
      return;
    }
  }

  info(`Step 1/5: Meta App credentials.`);
  info(`  Open ${META_DASHBOARD} and create (or open) a Business app with the WhatsApp product.`);
  info(`  Reference: ${WA_DOCS}`);
  info("");

  const appSecret = await askRequired("App Secret");
  const accessToken = await askRequired("System User permanent access token");
  const phoneNumberId = await askRequired("Phone Number ID");
  const businessAccountId = await askRequired("WhatsApp Business Account (WABA) ID");
  const apiVersion = (await ask("WhatsApp Cloud API version", "v22.0")) || "v22.0";

  info("");
  info(`Step 2/5: Verify token.`);
  const verifyToken = randomBytes(32).toString("hex");
  info(`  Generated a strong verify_token for you: ${verifyToken.slice(0, 12)}…`);

  info("");
  info(`Step 3/5: LLM provider.`);
  const apiKey = await askRequired("Anthropic API key");
  const model = (await ask("Model", "claude-opus-4-7")) || "claude-opus-4-7";

  info("");
  info(`Step 4/5: Server.`);
  const host = (await ask("Bind host", "0.0.0.0")) || "0.0.0.0";
  const port = Number((await ask("Bind port", "3000")) || "3000");
  const publicUrl = (await ask(
    "Public HTTPS URL Meta will POST to (leave blank for now if using ngrok)",
    "",
  )).trim();

  const cfg: WorkspaceConfig = {
    tenantId: "default",
    whatsapp: {
      appSecret,
      accessToken,
      phoneNumberId,
      businessAccountId,
      verifyToken,
      apiVersion,
    },
    llm: { provider: "anthropic", apiKey, model },
    server: {
      host,
      port,
      ...(publicUrl ? { publicUrl } : {}),
    },
  };

  const cfgPath = await writeConfig(cfg, workspaceDir);
  await writeFile(".env", renderEnvFile(cfg), { mode: 0o600 });

  info("");
  info(`Step 5/5: Connect Meta to your webhook.`);
  info(`  In the Meta App dashboard → WhatsApp → Configuration → Webhook:`);
  info(`    Callback URL: ${publicUrl || "<your public URL>"}/webhooks/whatsapp`);
  info(`    Verify token: ${verifyToken}`);
  info(`    Subscribe to: messages, message_status_updates`);
  info("");

  info(`Wrote ${cfgPath} (mode 0600)`);
  info(`Wrote .env in this directory (mode 0600)`);
  info("");
  info(`Next steps:`);
  info(`  1) Start the server:    pnpm crab start`);
  info(`  2) Validate setup:      pnpm crab doctor`);
  info(`  3) Send a WhatsApp message to your business number to test.`);
  if (!opts.skipTest) {
    info(`  (Outbound test-template sending will be added in v1.1.)`);
  }
  close();
}
