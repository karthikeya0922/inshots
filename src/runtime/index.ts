import type { LaunchOptions, ProgressReporter, RepositoryAnalysis, RuntimeAnalysis } from "../types.js";
import type { ScanResult } from "../repository/scanner.js";
import { launchApp, type LaunchedApp, type LaunchFailure } from "./launcher.js";
import { exploreApp } from "./browser.js";
import { analyzeFlows } from "../intelligence/flows.js";
import { renderSourceVisuals } from "../ui/source-visuals.js";
import { staticPalette } from "../ui/design-system.js";
import { redactSecrets } from "../repository/secrets.js";

export { launchApp, exploreApp };

export interface RuntimeStageInput {
  repoRoot: string;
  analysis: RepositoryAnalysis;
  scan: ScanResult;
  options: LaunchOptions;
  outputDir: string;
  report: ProgressReporter;
}

/**
 * Runtime stage: launch the application (when possible), explore it in a
 * browser, capture screens, derive flows. Never fails the pipeline — when the
 * app cannot run we record `runtime_unavailable` and produce source-derived
 * visuals instead.
 */
export async function runRuntimeStage(input: RuntimeStageInput): Promise<RuntimeAnalysis> {
  const { analysis, options, outputDir, report, repoRoot, scan } = input;
  const result: RuntimeAnalysis = { status: "skipped", screens: [], flows: [], logExcerpt: [], sourceDerived: [] };
  const app = analysis.primaryApp;

  if (!options.run) {
    result.status = "skipped";
    result.reason = "runtime disabled (--no-run)";
  } else if (!app || !app.runCommand) {
    result.status = "runtime_unavailable";
    result.reason = app ? `primary app (${app.kind}) has no runnable dev command` : "no runnable application detected";
  } else {
    result.app = app;
    report({ step: "runtime", status: "start", message: `Launching ${app.frameworks.join("/") || app.kind} app${app.dir ? ` in ${app.dir}` : ""}` });
    const launched = await launchApp(repoRoot, app, {
      install: options.install,
      installTimeoutMs: options.timeouts.install,
      startupTimeoutMs: options.timeouts.startup,
      appEnv: options.appEnv,
      report,
    });
    if ("url" in launched) {
      await exploreLaunched(launched as LaunchedApp, input, result);
    } else {
      const failure = launched as LaunchFailure;
      result.status = "runtime_unavailable";
      result.reason = failure.reason;
      result.command = failure.command;
      result.logExcerpt = failure.logs.map((l) => redactSecrets(l).text).slice(-30);
      report({ step: "runtime", status: "warn", message: `Application could not run: ${failure.reason}` });
    }
  }

  // Fallback / complement: source-derived visuals.
  if (result.screens.length === 0) {
    report({ step: "runtime", status: "start", message: "Rendering source-derived visuals from the repository" });
    try {
      const palette = staticPalette(analysis.designTokens);
      result.sourceDerived = await renderSourceVisuals(scan, analysis, { outputDir, assetDir: "assets/source", palette });
      report({ step: "runtime", status: "done", message: `${result.sourceDerived.length} source-derived visual(s) rendered` });
    } catch (err) {
      report({ step: "runtime", status: "warn", message: `Source visuals failed: ${(err as Error).message}` });
    }
  }
  return result;
}

async function exploreLaunched(launched: LaunchedApp, input: RuntimeStageInput, result: RuntimeAnalysis): Promise<void> {
  const { analysis, options, outputDir, report } = input;
  result.status = "ok";
  result.url = launched.url;
  result.command = launched.command;
  result.startupMs = launched.startupMs;
  result.installMs = launched.installMs;
  report({ step: "runtime", status: "done", message: `Application launched at ${launched.url} (${(launched.startupMs / 1000).toFixed(1)}s)` });
  try {
    const explored = await exploreApp({
      baseUrl: launched.url,
      outputDir,
      assetDir: "assets/runtime",
      staticRoutes: analysis.routes,
      maxScreens: options.maxScreens,
      navigationTimeoutMs: options.timeouts.navigation,
      format: options.format,
      report,
      mobile: options.format === "vertical",
    });
    result.screens = explored.screens;
    result.mobileScreens = explored.mobileScreens;
    if (explored.warnings.length) result.logExcerpt.push(...explored.warnings.slice(0, 10));
    result.flows = analyzeFlows(result.screens, analysis.features);
    if (result.screens.length === 0) {
      result.status = "runtime_unavailable";
      result.reason = "application started but no page could be captured";
    }
  } catch (err) {
    result.status = "runtime_unavailable";
    result.reason = `browser exploration failed: ${(err as Error).message}`;
    report({ step: "browser", status: "warn", message: result.reason });
  } finally {
    result.logExcerpt.push(...launched.logs().map((l) => redactSecrets(l).text).slice(-20));
    await launched.stop().catch(() => {});
  }
}
