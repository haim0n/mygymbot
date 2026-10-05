// Local dev server: builds dev/main.jsx, serves dev/, and proxies the Claude API.
//   npm run dev                         → http://localhost:5173, rebuilds on save
//   ANTHROPIC_API_KEY=sk-... npm run dev → real coach replies (the key never reaches the browser)
// Without a key, every Claude call gets a short placeholder reply, so the app still runs.
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEV_DIR = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_TYPES = { ".html": "text/html", ".js": "text/javascript", ".map": "application/json" };
const PLACEHOLDER_REPLY = "(Dev mode: set ANTHROPIC_API_KEY to get real coach replies.)";

let buildOnce;
async function build({ watch }) {
  // GYMBOT_PREBUILT=1 skips the build (used when dev/app.js is produced some other way).
  if (process.env.GYMBOT_PREBUILT) return;
  const esbuild = await import("esbuild");
  const options = {
    entryPoints: [path.join(DEV_DIR, "main.jsx")],
    outfile: path.join(DEV_DIR, "app.js"),
    bundle: true,
    jsx: "automatic",
    sourcemap: true,
    logLevel: "warning",
  };
  if (!watch) return esbuild.build(options);
  const context = await esbuild.context(options);
  await context.rebuild();
  await context.watch();
}

async function proxyToClaude(request, response) {
  let body = "";
  for await (const chunk of request) body += chunk;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ content: [{ type: "text", text: PLACEHOLDER_REPLY }] }));
    return;
  }
  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body,
  });
  response.writeHead(upstream.status, { "content-type": "application/json" });
  response.end(await upstream.text());
}

async function serveFile(request, response) {
  const name = new URL(request.url, "http://localhost").pathname === "/" ? "index.html" : new URL(request.url, "http://localhost").pathname.slice(1);
  const file = path.join(DEV_DIR, path.normalize(name));
  if (!file.startsWith(DEV_DIR)) return void response.writeHead(403).end();
  try {
    const data = await readFile(file);
    response.writeHead(200, { "content-type": CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream" });
    response.end(data);
  } catch {
    response.writeHead(404).end("Not found");
  }
}

export async function startServer({ port = 5173, watch = false } = {}) {
  buildOnce ??= build({ watch });
  await buildOnce;
  const server = http.createServer((request, response) =>
    request.method === "POST" && request.url === "/api/messages" ? proxyToClaude(request, response) : serveFile(request, response)
  );
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  return { url, close: () => new Promise((resolve) => server.close(resolve)) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { url } = await startServer({ port: Number(process.env.PORT) || 5173, watch: true });
  console.log(`GymBot dev server: ${url}${process.env.ANTHROPIC_API_KEY ? "" : "  (no ANTHROPIC_API_KEY: placeholder coach replies)"}`);
}
