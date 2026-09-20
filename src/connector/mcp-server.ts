#!/usr/bin/env node
/**
 * Hyperframe Launch MCP server.
 *
 * Tools:
 *   create_launch_video   — full pipeline: repo → runtime → UI → DNA → storyboard → Hyperframes → mp4
 *   analyze_repository    — repository intelligence only (fast, no runtime)
 *   render_launch_video   — re-run check + render on an existing launch-output (after agent edits)
 *   get_launch_status     — read artifacts of an existing launch-output
 */
import path from "node:path";
import { promises as fs } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createLaunchVideo, renderExisting, withDefaults } from "./pipeline.js";
import { summaryLines } from "../output/index.js";
import { cloneRepository, analyzeRepository } from "../repository/index.js";
import { removeDir } from "../shared/fs.js";
import type { LaunchOptions, ProgressEvent } from "../types.js";

const server = new McpServer({ name: "hyperframe-launch", version: "0.1.0" });

const launchInput = {
  repository_url: z.string().describe("GitHub URL, git URL, owner/repo, or local path"),
  duration: z.number().min(15).max(30).optional().describe("Target seconds (default 24)"),
  format: z.enum(["landscape", "vertical", "square"]).optional(),
  tone: z.string().optional().describe("polished | cinematic | minimal | playful | technical | app-store | bold, or freeform direction"),
  voice: z.boolean().optional(),
  music: z.boolean().optional().describe("default true"),
  sfx: z.boolean().optional().describe("default true"),
  branch: z.string().optional(),
  platform: z.enum(["linkedin", "x", "instagram-reel", "youtube-short", "product-hunt", "generic"]).optional(),
  style: z.string().optional(),
  target_audience: z.string().optional(),
  output_dir: z.string().optional(),
  run: z.boolean().optional().describe("Run the app and explore it in a browser (default true)"),
  install: z.boolean().optional().describe("Allow dependency installation with scripts disabled (default true)"),
  render: z.boolean().optional().describe("Render with Hyperframes (default true)"),
  quality: z.enum(["draft", "looks", "delivery"]).optional(),
  max_screens: z.number().min(1).max(30).optional(),
};

server.registerTool(
  "create_launch_video",
  {
    title: "Create launch video",
    description: "Turn a software repository into a launch video built from its real UI: clones the repo, analyzes the codebase, runs the app, explores it in a browser, analyzes UI/UX, builds Product DNA, verifies claims, writes a storyboard, hands a composition to Hyperframes, renders launch.mp4, and writes share copy. Returns the output directory, a step summary, and the quality gate.",
    inputSchema: launchInput,
  },
  async (args) => {
    const events: ProgressEvent[] = [];
    const partial = toOptions(args);
    const result = await createLaunchVideo(partial, { report: (e) => events.push(e) });
    const lines = summaryLines({ options: withDefaults(partial), repo: result.repositoryAnalysis, runtime: result.runtimeAnalysis, ui: result.uiAnalysis, dna: result.productDNA, storyboard: result.storyboard, render: result.render, files: result.files, shareCopyText: "" }, result.qualityGate);
    const text = [
      ...lines,
      "",
      `Output: ${result.outputDir}`,
      result.render.status === "rendered" ? `Video: ${result.render.videoPath}` : `Video not rendered: ${result.render.reason}`,
      `Poster: ${result.render.posterPath ?? "n/a"}`,
      "",
      "Artifacts: product-dna.json, repository-analysis.json, runtime-analysis.json, ui-analysis.json, claim-verification.json, launch-plan.md, storyboard.md, composition-brief.md, share-copy/*, composition/",
      "",
      "To refine: edit composition/index.html or storyboard copy, then call render_launch_video with the output directory.",
    ].join("\n");
    return {
      content: [{ type: "text", text }],
      structuredContent: {
        ok: result.ok,
        outputDir: result.outputDir,
        summary: lines,
        render: result.render,
        qualityGate: result.qualityGate,
        productDNA: { name: result.productDNA.name, category: result.productDNA.category, tagline: result.productDNA.tagline, features: result.productDNA.verified_features.map((f) => f.name), screens: result.productDNA.screens.length, style: result.productDNA.visual_identity.style },
        storyboard: result.storyboard.scenes.map((s) => ({ scene: s.scene, purpose: s.purpose, start: s.start, duration: s.duration, text: s.text, source: s.sourceFile ?? null, motion: s.motion })),
        warnings: events.filter((e) => e.status === "warn" || e.status === "fail").map((e) => e.message),
      },
    };
  },
);

server.registerTool(
  "analyze_repository",
  {
    title: "Analyze repository",
    description: "Repository intelligence only: frameworks, backend, database, runnable apps, static routes, evidence-backed features, design tokens, brand assets. Fast — no install, no runtime, no video.",
    inputSchema: { repository_url: z.string(), branch: z.string().optional() },
  },
  async ({ repository_url, branch }) => {
    const clone = await cloneRepository(repository_url, { branch });
    try {
      const repo = await analyzeRepository(clone);
      const a = repo.analysis;
      const summary = `${a.name} — ${a.description}\nFrontend: ${a.frameworks.frontend.join(", ") || "none"}\nBackend: ${a.frameworks.backend.join(", ") || "none"}\nDatabase: ${a.frameworks.database.join(", ") || "none"}\nRun: ${a.primaryApp?.runCommand ? [a.primaryApp.runCommand.cmd, ...a.primaryApp.runCommand.args].join(" ") : "not runnable"}\nRoutes: ${a.routes.slice(0, 12).map((r) => r.path).join(", ")}\nFeatures:\n${a.features.slice(0, 12).map((f) => `- ${f.name} (${f.confidence}) ← ${f.evidence.slice(0, 2).join(", ")}`).join("\n")}`;
      return { content: [{ type: "text", text: summary }], structuredContent: { ...a, source: { ...a.source, localPath: clone.isLocal ? a.source.localPath : "[workspace]" } } as Record<string, unknown> };
    } finally {
      if (!clone.isLocal) await removeDir(clone.localPath).catch(() => {});
    }
  },
);

server.registerTool(
  "render_launch_video",
  {
    title: "Render launch video",
    description: "Re-run `hyperframes check` and `hyperframes render` for an existing launch-output directory (use after editing composition/index.html). Picks the poster frame and bakes it as frame 0.",
    inputSchema: { output_dir: z.string(), quality: z.enum(["draft", "looks", "delivery"]).optional() },
  },
  async ({ output_dir, quality }) => {
    const r = await renderExisting(path.resolve(output_dir), { quality });
    return { content: [{ type: "text", text: r.status === "rendered" ? `Rendered ${r.videoPath} (${r.ffprobe?.durationSec ?? "?"}s)` : `Not rendered: ${r.reason}` }], structuredContent: r as unknown as Record<string, unknown> };
  },
);

server.registerTool(
  "get_launch_status",
  {
    title: "Get launch status",
    description: "Read the artifacts of an existing launch-output directory: summary, quality gate, storyboard, product DNA, share copy.",
    inputSchema: { output_dir: z.string() },
  },
  async ({ output_dir }) => {
    const dir = path.resolve(output_dir);
    const read = async (f: string) => fs.readFile(path.join(dir, f), "utf8").catch(() => null);
    const result = JSON.parse((await read("launch-result.json")) ?? "null");
    const dna = JSON.parse((await read("product-dna.json")) ?? "null");
    const storyboard = await read("storyboard.md");
    const copy = await read("share-copy/short-caption.md");
    const text = result ? `${(result.summary as string[]).join("\n")}\n\n${storyboard ?? ""}\n\nShort caption: ${copy ?? ""}` : `No launch-result.json in ${dir}`;
    return { content: [{ type: "text", text }], structuredContent: { result, dna, hasVideo: !!(await fs.stat(path.join(dir, "launch.mp4")).catch(() => null)) } };
  },
);

function toOptions(args: Record<string, unknown>): Partial<LaunchOptions> & { repositoryUrl: string } {
  return {
    repositoryUrl: String(args.repository_url),
    duration: args.duration as number | undefined,
    format: args.format as LaunchOptions["format"] | undefined,
    tone: args.tone as string | undefined,
    voice: args.voice as boolean | undefined,
    music: args.music as boolean | undefined,
    sfx: args.sfx as boolean | undefined,
    branch: args.branch as string | undefined,
    platform: args.platform as LaunchOptions["platform"] | undefined,
    style: args.style as string | undefined,
    targetAudience: args.target_audience as string | undefined,
    outputDir: args.output_dir as string | undefined,
    run: args.run as boolean | undefined,
    install: args.install as boolean | undefined,
    render: args.render as boolean | undefined,
    quality: args.quality as LaunchOptions["quality"] | undefined,
    maxScreens: args.max_screens as number | undefined,
  };
}

const transport = new StdioServerTransport();
await server.connect(transport);
