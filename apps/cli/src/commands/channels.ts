import { info } from "../prompt.js";
import { readConfig } from "../workspace.js";

/**
 * v1 only ships the WhatsApp channel; the subcommands surface its config
 * for inspection. Future channels will register here.
 */
export async function listChannels(): Promise<void> {
  const cfg = await readConfig();
  if (!cfg) {
    info("No workspace config found. Run `crab onboard` first.");
    process.exitCode = 1;
    return;
  }
  info("Configured channels:");
  info(`  - whatsapp`);
  info(`      phone_number_id     = ${cfg.whatsapp.phoneNumberId}`);
  info(`      business_account_id = ${cfg.whatsapp.businessAccountId}`);
  info(`      api_version         = ${cfg.whatsapp.apiVersion}`);
}
