import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { info } from "../prompt.js";
import { readConfig } from "../workspace.js";

/**
 * `crab start` is just a friendly wrapper around `pnpm --filter @crab/server start`
 * so users don't need to remember workspace filter flags.
 */
export async function start(): Promise<void> {
  const cfg = await readConfig();
  if (!cfg) {
    info("No workspace config found. Run `crab onboard` first.");
    process.exitCode = 1;
    return;
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, "..", "..", "..", "..");
  const child = spawn("pnpm", ["--filter", "@crab/server", "start"], {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env,
  });
  child.on("exit", (code) => process.exit(code ?? 0));
}
