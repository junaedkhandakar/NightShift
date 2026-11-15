// Tiny static file server for previewing the docs site locally.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = process.argv[2] ?? ".";
const port = Number(process.argv[3] ?? 4173);

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

createServer(async (req, res) => {
  let target = path.join(root, decodeURIComponent(req.url.split("?")[0]));
  if (target.endsWith(path.sep) || req.url === "/") target = path.join(target, "index.html");

  try {
    const data = await readFile(target);
    res.writeHead(200, { "Content-Type": types[path.extname(target)] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
}).listen(port, () => console.log(`serving ${root} on http://localhost:${port}`));
