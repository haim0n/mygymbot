// A phone-sized tour of the app for review: every tab, a started workout with the rest bar, and About you.
// Run: node scripts/screenshots.mjs DATA.json OUT_DIR  (DATA.json: a user's stored data, e.g. a copy of their bucket file).
// The server works on a temporary copy, so the tour's taps never change DATA.json. With Google credentials on this
// machine, the app's AI calls on load (daily note, photo matches) are real Gemini calls billed to mygymbot.
import { chromium, devices } from "playwright";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { startServer } from "../tests/e2e/helpers.mjs";

const [dataFile, outDir] = process.argv.slice(2);
if (!dataFile || !outDir) throw new Error("Usage: node scripts/screenshots.mjs DATA.json OUT_DIR");
await mkdir(outDir, { recursive: true });
const server = await startServer(JSON.parse(await readFile(dataFile, "utf8")));
const browser = await chromium.launch();
const page = await browser.newPage({ ...devices["Pixel 5"] });
const shot = async (name) => {
  await page.waitForTimeout(800); // let charts measure and pictures load
  await page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: true });
  console.log(path.join(outDir, `${name}.png`));
};
const tab = (name) => page.getByRole("button", { name, exact: true }).tap();

try {
  await page.goto(server.url);
  for (const name of ["Coach", "Form", "Progress", "Goals"]) {
    await tab(name);
    await shot(name.toLowerCase());
  }
  await page.getByRole("button", { name: /^Log/ }).first().tap();
  await shot("log");
  const start = page.getByRole("button", { name: /^Start with Up next|^Start plan / }).first();
  if (await start.count()) {
    await start.tap();
    await shot("workout");
    await page.getByRole("button", { name: "Set 1 done" }).first().tap();
    await page.waitForTimeout(1500); // the coach's rest note
    await page.screenshot({ path: path.join(outDir, "resting.png") }); // the viewport: the rest bar is fixed at the top
    console.log(path.join(outDir, "resting.png"));
  }
} finally {
  await browser.close();
  await server.close();
}
