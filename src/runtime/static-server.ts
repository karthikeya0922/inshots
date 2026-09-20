import http from "node:http";
import path from "node:path";
import { promises as fs } from "node:fs";
import { findFreePort } from "./process-manager.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json",
  ".wasm": "application/wasm",
};

export interface StaticServer {
  url: string;
  port: number;
  close(): Promise<void>;
}

/** Serve a directory of static files (for plain HTML projects and built output). */
export async function serveStatic(root: string, preferredPort = 4173): Promise<StaticServer> {
  const port = await findFreePort(preferredPort);
  const absRoot = path.resolve(root);
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      let rel = decodeURIComponent(url.pathname);
      let file = path.resolve(absRoot, "." + rel);
      if (!file.startsWith(absRoot)) {
        res.writeHead(403).end();
        return;
      }
      let stat = await fs.stat(file).catch(() => null);
      if (stat?.isDirectory()) {
        file = path.join(file, "index.html");
        stat = await fs.stat(file).catch(() => null);
      }
      if (!stat && !path.extname(file)) {
        // SPA/pretty URLs: try `.html` then fall back to index.html
        const html = file + ".html";
        stat = await fs.stat(html).catch(() => null);
        if (stat) file = html;
        else {
          file = path.join(absRoot, "index.html");
          stat = await fs.stat(file).catch(() => null);
        }
      }
      if (!stat) {
        res.writeHead(404, { "content-type": "text/plain" }).end("not found");
        return;
      }
      const data = await fs.readFile(file);
      res.writeHead(200, { "content-type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream", "cache-control": "no-store" });
      res.end(data);
    } catch {
      res.writeHead(500).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
