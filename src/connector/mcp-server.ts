#!/usr/bin/env node
/**
 * Frameo MCP server — one tool: `frameo`.
 *
 * repo → runtime → real UI capture → UI/UX analysis → Product DNA → verified storyboard
 * → Hyperframes composition → render → 30-second frameo.mp4 + share copy.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createLaunchVideo, withDefaults } from "./pipeline.js";
import { summaryLines } from "../output/index.js";
import type { LaunchOptions, ProgressEvent } from "../types.js";

const server = new McpServer({ name: "frameo", version: "0.1.0" });

server.registerTool(
  "frameo",
  {
    title: "Frameo — launch video from a repository",
    description: "Turn a software repository into a 30-second launch video built from its real UI: clones the repo, analyzes the codebase, runs the app, explores it in a browser, analyzes UI/UX, builds Product DNA, verifies every claim, writes a storyboard, hands a composition to Hyperframes, renders frameo.mp4 (+ poster) and writes share copy for LinkedIn, X, Product Hunt and short-form. Returns the output directory, a step summary, and the quality gate.",
    inputSchema: {
      repository_url: z.string().describe("GitHub URL, git URL, owner/repo, or local path"),
      duration: z.number().min(15).max(30).optional().describe("Target seconds (default 30)"),
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
      quality: z.enum(["draft", "looks", "delivery"]).optional(),
    },
  },
  async (args) => {
    const events: ProgressEvent[] = [];
    const partial: Partial<LaunchOptions> & { repositoryUrl: string } = {
      repositoryUrl: String(args.repository_url),
      duration: args.duration,
      format: args.format,
      tone: args.tone,
      voice: args.voice,
      music: args.music,
      sfx: args.sfx,
      branch: args.branch,
      platform: args.platform,
      style: args.style,
      targetAudience: args.target_audience,
      outputDir: args.output_dir,
      quality: args.quality,
    };
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

const transport = new StdioServerTransport();
await server.connect(transport);
