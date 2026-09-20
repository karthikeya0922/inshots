import path from "node:path";
import { createRequire } from "node:module";
import type { Browser } from "playwright";
import { exec } from "./exec.js";

/**
 * Launch headless Chromium, downloading the Playwright browser build on first use
 * so a fresh install never fails with "Executable doesn't exist".
 */
let installAttempted = false;

export async function launchChromium(args: string[]): Promise<Browser> {
  const { chromium } = await import("playwright");
  const launch = () => chromium.launch({ headless: true, args });
  try {
    return await launch();
  } catch (err) {
    const msg = (err as Error).message ?? "";
    if (!/Executable doesn't exist|browserType\.launch|Looks like Playwright/i.test(msg) || installAttempted) throw err;
    installAttempted = true;
    process.stderr.write("[frameo] Playwright Chromium is not installed yet — downloading it once (~150 MB)…\n");
    const cli = playwrightCli();
    const res = await exec(process.execPath, [cli, "install", "chromium"], { timeoutMs: 15 * 60_000, inheritEnv: true });
    if (res.code !== 0) throw new Error(`Playwright Chromium could not be installed: ${(res.stderr || res.stdout).trim().split(/\r?\n/).slice(-3).join(" | ")}. Run: npx playwright install chromium`);
    return await launch();
  }
}

function playwrightCli(): string {
  const require = createRequire(import.meta.url);
  const pkg = require.resolve("playwright/package.json");
  return path.join(path.dirname(pkg), "cli.js");
}
