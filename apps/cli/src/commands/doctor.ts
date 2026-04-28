import { createEgressGuard } from "@crab/security";
import { info } from "../prompt.js";
import { defaultWorkspaceDir, readConfig } from "../workspace.js";

interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}

export async function doctor(opts: { workspaceDir?: string } = {}): Promise<void> {
  const workspaceDir = opts.workspaceDir ?? defaultWorkspaceDir();
  const cfg = await readConfig(workspaceDir);
  const checks: Check[] = [];

  if (!cfg) {
    checks.push({ name: "config exists", ok: false, detail: "run `crab onboard` first" });
    print(checks);
    process.exitCode = 1;
    return;
  }

  checks.push({ name: "config exists", ok: true, detail: `${workspaceDir}/config.json` });
  checks.push({ name: "WhatsApp app secret set", ok: cfg.whatsapp.appSecret.length >= 16 });
  checks.push({ name: "WhatsApp access token set", ok: cfg.whatsapp.accessToken.length >= 16 });
  checks.push({ name: "WhatsApp phone number id set", ok: cfg.whatsapp.phoneNumberId.length > 0 });
  checks.push({ name: "WhatsApp verify token set", ok: cfg.whatsapp.verifyToken.length >= 16 });
  checks.push({ name: "Anthropic API key set", ok: cfg.llm.apiKey.length >= 16 });
  checks.push({ name: "public URL configured", ok: !!cfg.server.publicUrl, detail: cfg.server.publicUrl ?? "(none)" });

  // Egress sanity: try resolving graph.facebook.com under the guard.
  const egress = createEgressGuard({ allowlist: ["graph.facebook.com"], mode: "enforce" });
  try {
    await egress.check("https://graph.facebook.com/v22.0/me");
    checks.push({ name: "egress: graph.facebook.com reachable & non-private", ok: true });
  } catch (err) {
    checks.push({ name: "egress: graph.facebook.com reachable & non-private", ok: false, detail: (err as Error).message });
  }

  print(checks);
  if (checks.some((c) => !c.ok)) process.exitCode = 1;
}

function print(checks: Check[]): void {
  for (const c of checks) {
    const mark = c.ok ? "ok " : "FAIL";
    info(`  [${mark}] ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
  }
}
