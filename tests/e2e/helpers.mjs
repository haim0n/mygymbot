// Shared setup for browser tests: a phone-sized Chromium, a fixed clock, seeded storage and a fake AI.
// One-time setup: npx playwright install chromium, uv sync. The bundle comes from npm run build (test:e2e runs it).
import { chromium, devices } from "playwright";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const COMMIT = "abc1234-dirty"; // as if deployed with uncommitted changes
export const NOW = new Date("2026-10-03T18:00:00"); // a Saturday evening

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const freePort = () =>
  new Promise((resolve) => {
    const probe = createServer().listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

// The Python server on its own port, with `seed` as the dev user's data, so tests never share data.
export async function startServer(seed) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "gymbot-test-"));
  await writeFile(path.join(dir, "dev.json"), JSON.stringify(seed));
  const port = await freePort();
  const env = { ...process.env, PORT: String(port), GYMBOT_DATA_DIR: dir, GYMBOT_IAP_AUDIENCE: "", GYMBOT_COMMIT: COMMIT };
  const server = spawn(path.join(ROOT, ".venv/bin/python"), ["-m", "server"], { cwd: ROOT, env, stdio: ["ignore", "ignore", "pipe"] });
  let log = "";
  server.stderr.on("data", (chunk) => (log += chunk));
  const url = `http://127.0.0.1:${port}/`;
  for (let attempt = 0; ; attempt++) {
    try {
      if ((await fetch(url)).ok) break;
    } catch {
      // not listening yet
    }
    if (attempt === 100 || server.exitCode !== null) throw new Error(`The server didn't start:\n${log}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return {
    url,
    close: async () => {
      server.kill();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

// `ai(body)` returns the text the fake AI replies with; every request body is kept in `aiRequests`.
export async function openApp(t, { seed = {}, ai = () => "OK" } = {}) {
  const server = await startServer(seed); // data kept across reloads, like the real app
  const browser = await chromium.launch();
  const page = await browser.newPage({ ...devices["Pixel 5"] });
  const errors = [];
  const aiRequests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.install({ time: NOW });
  await page.route("**/api/ask", async (route) => {
    const body = route.request().postDataJSON();
    aiRequests.push(body);
    await route.fulfill({ json: { text: ai(body) } });
  });
  await page.goto(server.url);
  t.after(async () => {
    await browser.close();
    await server.close();
  });
  return { page, errors, aiRequests };
}

export const section = (page, heading) =>
  page.locator("section", { has: page.getByRole("heading", typeof heading === "string" ? { name: heading, exact: true } : { name: heading }) });
export const stored = (page, key) => page.evaluate(async (k) => (await fetch(`/api/storage/${encodeURIComponent(k)}`)).json(), key);
export const settle = (page) => page.waitForTimeout(400); // storage writes are debounced by 300 ms
export const isCoachChat = (body) => body.system.startsWith("You are GymBot, a direct");
export const exerciseNames = (list) =>
  list.getByRole("button", { name: /^Show details for / }).evaluateAll((els) => els.map((e) => e.getAttribute("aria-label").replace("Show details for ", "")));
