import { applySandbox } from "@crab/security";
import { build } from "./app.js";
import { loadConfig } from "./config.js";

async function main(): Promise<void> {
  const config = loadConfig();

  const sandbox = await applySandbox();
  console.log("[crab] sandbox:", sandbox.applied ? "applied" : "skipped");
  for (const note of sandbox.notes) console.log(`  - ${note}`);

  const app = await build(config);

  const onSignal = async (sig: string): Promise<void> => {
    app.fastify.log.info({ sig }, "shutting down");
    await app.shutdown();
    process.exit(0);
  };
  process.on("SIGINT", () => void onSignal("SIGINT"));
  process.on("SIGTERM", () => void onSignal("SIGTERM"));

  await app.fastify.listen({ host: config.host, port: config.port });
  app.fastify.log.info(
    { url: config.publicUrl ?? `http://${config.host}:${config.port}` },
    "crab is listening — paste this URL into Meta's webhook config",
  );
}

main().catch((err) => {
  console.error("[crab] fatal", err);
  process.exit(1);
});
