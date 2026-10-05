// Shared setup for browser tests: a phone-sized Chromium, a fixed clock, seeded storage and a fake Claude.
// One-time setup: npx playwright install chromium
import { chromium, devices } from "playwright";
import { startServer } from "../../dev/server.mjs";

export const NOW = new Date("2026-10-03T18:00:00"); // a Saturday evening

// `claude(body)` returns the text the fake Claude replies with; every request body is kept in `claudeRequests`.
export async function openApp(t, { seed = {}, claude = () => "OK" } = {}) {
  const server = await startServer({ port: 0, seed }); // data in memory, kept across reloads like the real app
  const browser = await chromium.launch();
  const page = await browser.newPage({ ...devices["Pixel 5"] });
  const errors = [];
  const claudeRequests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.install({ time: NOW });
  await page.route("**/api/messages", async (route) => {
    const body = route.request().postDataJSON();
    claudeRequests.push(body);
    await route.fulfill({ json: { content: [{ type: "text", text: claude(body) }] } });
  });
  await page.goto(server.url);
  t.after(async () => {
    await browser.close();
    await server.close();
  });
  return { page, errors, claudeRequests };
}

export const section = (page, heading) =>
  page.locator("section", { has: page.getByRole("heading", typeof heading === "string" ? { name: heading, exact: true } : { name: heading }) });
export const stored = (page, key) => page.evaluate(async (k) => JSON.parse((await window.storage.get(k)).value), key);
export const settle = (page) => page.waitForTimeout(400); // storage writes are debounced by 300 ms
export const isCoachChat = (body) => body.system.startsWith("You are GymBot, a direct");
export const exerciseNames = (list) =>
  list.getByRole("button", { name: /^Show details for / }).evaluateAll((els) => els.map((e) => e.getAttribute("aria-label").replace("Show details for ", "")));
