import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

/**
 * Tiny prompt helpers — keeps the CLI free of an interactive-prompt dep.
 *
 * For password-style entry we don't echo, but we don't bother with the full
 * tty-raw dance for v1: the user pastes from a clipboard once during onboard
 * and we never ask again.
 */

const rl = createInterface({ input, output });

export async function ask(question: string, defaultValue?: string): Promise<string> {
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  const ans = (await rl.question(`${question}${suffix}: `)).trim();
  return ans || defaultValue || "";
}

export async function askRequired(question: string): Promise<string> {
  for (;;) {
    const v = await ask(question);
    if (v) return v;
    output.write("(required)\n");
  }
}

export async function confirm(question: string, defaultYes = true): Promise<boolean> {
  const suffix = defaultYes ? "[Y/n]" : "[y/N]";
  const ans = (await rl.question(`${question} ${suffix}: `)).trim().toLowerCase();
  if (!ans) return defaultYes;
  return ans === "y" || ans === "yes";
}

export function close(): void {
  rl.close();
}

export function info(line: string): void {
  output.write(`${line}\n`);
}
