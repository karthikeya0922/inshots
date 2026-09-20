import path from "node:path";
import type { RepositoryAnalysis } from "../types.js";
import { cloneRepository, type CloneResult } from "./clone.js";
import { scanRepository, type ScanResult } from "./scanner.js";
import { detectFrameworks } from "./framework-detector.js";
import { analyzeFeatures } from "./feature-analyzer.js";
import { humanize } from "../shared/text.js";

export { cloneRepository, scanRepository, detectFrameworks, analyzeFeatures };
export type { ScanResult, CloneResult };

export interface RepositoryStage {
  clone: CloneResult;
  scan: ScanResult;
  analysis: RepositoryAnalysis;
}

export async function analyzeRepository(clone: CloneResult): Promise<RepositoryStage> {
  const scan = await scanRepository(clone.localPath);
  const det = detectFrameworks(scan);
  const features = analyzeFeatures(scan, det);
  const warnings: string[] = [];

  const pkgName = readPackageName(scan);
  // The README title is the author's own spelling ("csvkit-js", "/brag") — keep it. Package/dir names get humanized.
  const name = cleanName(scan.readme.title, true) ?? cleanName(pkgName) ?? humanize(path.basename(clone.localPath).replace(/-[a-z0-9]{6,}$/, ""));
  const description = scan.readme.tagline ?? scan.readme.description ?? readPackageDescription(scan) ?? "";

  if (!det.primaryApp) warnings.push("No runnable application detected; the video will use source-derived visuals.");
  if (det.apps.filter((a) => a.kind === "frontend" || a.kind === "fullstack").length > 1) warnings.push(`Multiple frontend applications found; using ${det.primaryApp?.dir || "root"} as primary.`);
  if (scan.secrets.redactedFiles.length) warnings.push(`${scan.secrets.redactedFiles.length} file(s) contained secret-like values and were redacted or skipped.`);

  const analysis: RepositoryAnalysis = {
    source: {
      url: clone.url,
      branch: clone.branch,
      commit: clone.commit,
      localPath: clone.localPath,
      clonedAt: new Date().toISOString(),
    },
    name,
    description,
    languages: sortRecord(scan.languages),
    fileCount: scan.files.length,
    readme: scan.readme,
    frameworks: {
      frontend: det.frontend,
      backend: det.backend,
      database: det.database,
      tooling: det.tooling,
      ai: det.ai,
    },
    dependencies: det.dependencies,
    apps: det.apps,
    primaryApp: det.primaryApp,
    routes: det.routes,
    features,
    designTokens: scan.designTokens,
    brandAssets: scan.brandAssets,
    secrets: scan.secrets,
    importantFiles: scan.importantFiles,
    license: detectLicense(scan),
    warnings,
  };
  return { clone, scan, analysis };
}

function detectLicense(scan: ScanResult): string | undefined {
  const f = scan.files.find((f) => /^(LICENSE|LICENCE|COPYING)(\.(md|txt))?$/i.test(f.rel));
  const c = f?.content ?? "";
  if (!f) {
    const pkg = scan.byRel.get("package.json")?.content;
    const m = pkg?.match(/"license"\s*:\s*"([^"]+)"/);
    return m?.[1];
  }
  if (/MIT License/i.test(c)) return "MIT";
  if (/Apache License/i.test(c)) return "Apache-2.0";
  if (/GNU GENERAL PUBLIC LICENSE/i.test(c)) return /Version 3/i.test(c) ? "GPL-3.0" : "GPL-2.0";
  if (/GNU AFFERO/i.test(c)) return "AGPL-3.0";
  if (/BSD/i.test(c)) return "BSD";
  if (/Mozilla Public License/i.test(c)) return "MPL-2.0";
  if (/ISC License/i.test(c)) return "ISC";
  if (/unlicense/i.test(c)) return "Unlicense";
  return "custom";
}

function readPackageName(scan: ScanResult): string | undefined {
  const pkg = scan.byRel.get("package.json")?.content;
  if (!pkg) return undefined;
  try {
    const name = (JSON.parse(pkg) as { name?: string }).name;
    return name?.replace(/^@[^/]+\//, "");
  } catch {
    return undefined;
  }
}

function readPackageDescription(scan: ScanResult): string | undefined {
  const pkg = scan.byRel.get("package.json")?.content;
  if (pkg) {
    try {
      const d = (JSON.parse(pkg) as { description?: string }).description;
      if (d) return d;
    } catch {
      /* ignore */
    }
  }
  const py = scan.byRel.get("pyproject.toml")?.content;
  const m = py?.match(/description\s*=\s*"([^"]+)"/);
  return m?.[1];
}

function cleanName(s?: string, verbatim = false): string | undefined {
  if (!s) return undefined;
  const t = s.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "").replace(/\s+/g, " ").trim();
  if (!t || t.length > 60) return undefined;
  if (/^(readme|project|untitled)$/i.test(t)) return undefined;
  return !verbatim && /^[a-z0-9-_.]+$/.test(t) ? humanize(t) : t;
}

function sortRecord(r: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(r).sort((a, b) => b[1] - a[1]));
}
