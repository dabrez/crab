#!/usr/bin/env node
import { Command } from "commander";

import { listChannels } from "./commands/channels.js";
import { doctor } from "./commands/doctor.js";
import { onboard } from "./commands/onboard.js";
import { start } from "./commands/start.js";

const program = new Command();

program
  .name("crab")
  .description("A hardened, easy-to-set-up AI assistant for WhatsApp.")
  .version("0.1.0");

program
  .command("onboard")
  .description("Interactive setup wizard for the WhatsApp Business Cloud API channel.")
  .option("--workspace-dir <path>", "Override the workspace directory")
  .option("--skip-test", "Skip the test message round-trip")
  .action(async (opts) => {
    await onboard({
      ...(opts.workspaceDir ? { workspaceDir: opts.workspaceDir } : {}),
      ...(opts.skipTest ? { skipTest: true } : {}),
    });
  });

program
  .command("start")
  .description("Start the Crab server.")
  .action(async () => {
    await start();
  });

program
  .command("doctor")
  .description("Validate config and connectivity.")
  .action(async () => {
    await doctor();
  });

const channels = program.command("channels").description("Manage messaging channels.");
channels
  .command("list")
  .description("List configured channels.")
  .action(async () => {
    await listChannels();
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
