// Local server: builds dev/main.jsx, serves dev/, keeps the app's data in a JSON file, and proxies the Claude API.
//   npm run dev    → http://localhost:5173, rebuilds on save, test data in data/dev.json
//   npm start      → http://localhost:8080, built once at start, your real data in data/gymbot.json
//   ANTHROPIC_API_KEY=sk-... → real coach replies (the key never reaches the browser)
//   HOST=...       → address to listen on (default 127.0.0.1: this machine only). Anyone who can reach
//                    another address can use your API key and data, so only pick one behind Tailscale or similar.
// Without a key, every Claude call gets a short placeholder reply, so the app still runs.
import http from "node:http";
import { constants, copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEV_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DEV_DIR, "..");
const CONTENT_TYPES = { ".html": "text/html", ".js": "text/javascript", ".map": "application/json" };
const PLACEHOLDER_REPLY = "(Dev mode: set ANTHROPIC_API_KEY to get real coach replies.)";

// The build stays in memory, so `npm start` and `npm run dev` can run side by side without sharing a bundle.
const bundle = new Map(); // "/app.js" → bytes
let buildOnce;
async function build({ watch }) {
  const esbuild = await import("esbuild");
  const keepInMemory = {
    name: "keep-in-memory",
    setup: (builder) =>
      builder.onEnd((result) => {
        for (const file of result.outputFiles ?? []) bundle.set(`/${path.basename(file.path)}`, file.contents);
      }),
  };
  const context = await esbuild.context({
    entryPoints: [path.join(DEV_DIR, "main.jsx")],
    outfile: path.join(DEV_DIR, "app.js"), // names the output; nothing is written to disk
    bundle: true,
    jsx: "automatic",
    sourcemap: true,
    write: false,
    logLevel: "warning",
    plugins: [keepInMemory],
  });
  await context.rebuild();
  if (watch) await context.watch();
  else await context.dispose();
}

// The app's data as { "gymbot:workouts": [...], ... }, one entry per window.storage key (the same shape as Export data).
// Without a file (tests) it lives only in memory.
async function openStore(file, seed = {}) {
  let data = { ...seed };
  if (file) {
    try {
      data = JSON.parse(await readFile(file, "utf8")); // a corrupt file stops the server instead of being overwritten
      // The first copy of each day, taken before new code touches the data, so a bad change can be undone.
      const backups = path.join(path.dirname(file), "backups");
      await mkdir(backups, { recursive: true });
      const backup = path.join(backups, `${path.basename(file, ".json")}-${new Date().toISOString().slice(0, 10)}.json`);
      await copyFile(file, backup, constants.COPYFILE_EXCL).catch((error) => {
        if (error.code !== "EEXIST") throw error;
      });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await mkdir(path.dirname(file), { recursive: true });
    }
  }

  // Writes go one at a time, through a temporary file, so a crash never leaves half a file.
  let saving = Promise.resolve();
  const save = () => {
    if (!file) return Promise.resolve();
    saving = saving
      .catch(() => {})
      .then(async () => {
        await writeFile(`${file}.tmp`, JSON.stringify(data, null, 1));
        await rename(`${file}.tmp`, file);
      });
    return saving;
  };
  return { data, save };
}

async function readBody(request) {
  let body = "";
  for await (const chunk of request) body += chunk;
  return body;
}

// GET, PUT and DELETE /api/storage/<key> work on one value.
async function handleStorage(store, request, response, url) {
  const key = decodeURIComponent(url.pathname.slice("/api/storage/".length));
  if (request.method === "GET") {
    if (!Object.hasOwn(store.data, key)) return void response.writeHead(404).end();
    response.writeHead(200, { "content-type": "application/json" });
    return void response.end(JSON.stringify(store.data[key]));
  }
  if (request.method === "PUT") {
    let value;
    try {
      value = JSON.parse(await readBody(request)); // the app only stores JSON; parsing keeps the file readable
    } catch {
      return void response.writeHead(400).end("Value must be JSON");
    }
    store.data[key] = value;
  } else if (request.method === "DELETE") {
    delete store.data[key];
  } else {
    return void response.writeHead(405).end();
  }
  await store.save();
  response.writeHead(204).end();
}

async function proxyToClaude(request, response) {
  const body = await readBody(request);
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

async function serveFile(url, response) {
  if (bundle.has(url.pathname)) {
    response.writeHead(200, { "content-type": CONTENT_TYPES[path.extname(url.pathname)] });
    return void response.end(bundle.get(url.pathname));
  }
  const name = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
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

// `dataFile` null keeps data in memory, starting from `seed` (tests).
export async function startServer({ port = 5173, host = "127.0.0.1", watch = false, dataFile = null, seed } = {}) {
  buildOnce ??= build({ watch });
  await buildOnce;
  const store = await openStore(dataFile, seed);
  const route = (request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname.startsWith("/api/storage/")) return handleStorage(store, request, response, url);
    if (request.method === "POST" && url.pathname === "/api/messages") return proxyToClaude(request, response);
    return serveFile(url, response);
  };
  const server = http.createServer((request, response) =>
    route(request, response).catch((error) => {
      // A failed request must not take the server down mid-workout.
      console.error(error);
      if (!response.headersSent) response.writeHead(500);
      response.end();
    })
  );
  await new Promise((resolve) => server.listen(port, host, resolve));
  const url = `http://${host}:${server.address().port}/`;
  return { url, close: () => new Promise((resolve) => server.close(resolve)) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const live = process.argv.includes("--live"); // npm start: your real data, no rebuilds until restarted
  const dataFile = path.join(ROOT, "data", live ? "gymbot.json" : "dev.json");
  const { url } = await startServer({ port: Number(process.env.PORT) || (live ? 8080 : 5173), host: process.env.HOST, watch: !live, dataFile });
  console.log(`GymBot: ${url}  data: ${path.relative(ROOT, dataFile)}${process.env.ANTHROPIC_API_KEY ? "" : "  (no ANTHROPIC_API_KEY: placeholder coach replies)"}`);
}
