import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { COMMIT, openApp, section, settle, stored } from "./helpers.mjs";
import { userWorkout, settings } from "../fixtures.mjs";

test("export: every gymbot key as one JSON object, next to the app version and commit", async (t) => {
  const seed = { "gymbot:workouts": [userWorkout], "gymbot:settings": settings() };
  const { page, errors } = await openApp(t, { seed });
  await page.getByRole("button", { name: "Goals", exact: true }).tap();
  const { version } = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
  await page.getByText(`GymBot ${version} ${COMMIT}`).waitFor();
  await page.getByRole("button", { name: "Export data" }).tap();
  const exported = JSON.parse(await page.getByLabel("Exported data").inputValue());
  assert.deepEqual(exported["gymbot:workouts"], seed["gymbot:workouts"]);
  assert.deepEqual(exported["gymbot:settings"], seed["gymbot:settings"]);
  assert.deepEqual(errors, []);
});

test("bodyweight: logged in Progress, one entry per day, charted with the change", async (t) => {
  const { page, errors } = await openApp(t, {
    seed: { "gymbot:workouts": [userWorkout], "gymbot:bodyweight": [{ date: "2026-09-20", weight: 82.5 }] },
  });
  await page.getByRole("button", { name: "Progress", exact: true }).tap();
  const panel = section(page, "Bodyweight");
  await panel.getByLabel("Today's weight").fill("81");
  await panel.getByRole("button", { name: "Log" }).tap();
  await panel.getByLabel("Today's weight").fill("80.5");
  await panel.getByLabel("Today's weight").press("Enter");
  await panel.getByText("Now 80.5 kg, down 2 kg since").waitFor();
  await panel.locator("svg.recharts-surface").waitFor(); // the chart draws after it measures its box
  await settle(page);
  assert.deepEqual(await stored(page, "gymbot:bodyweight"), [{ date: "2026-09-20", weight: 82.5 }, { date: "2026-10-03", weight: 80.5 }]);
  assert.deepEqual(errors, []);
});

test("saves: a failed save shows Not saved yet, is retried, and the newest value lands", async (t) => {
  const { page, errors } = await openApp(t, {
    seed: { "gymbot:workouts": [userWorkout], "gymbot:bodyweight": [{ date: "2026-09-20", weight: 82.5 }] },
  });
  const offline = (route) => (route.request().method() === "PUT" ? route.abort() : route.continue());
  await page.route("**/api/storage/**", offline);
  await page.getByRole("button", { name: "Progress", exact: true }).tap();
  const panel = section(page, "Bodyweight");
  await panel.getByLabel("Today's weight").fill("81");
  await panel.getByRole("button", { name: "Log" }).tap();
  const banner = page.getByRole("status").filter({ hasText: "Not saved yet" });
  await banner.waitFor();
  await panel.getByLabel("Today's weight").fill("80.5");
  await panel.getByRole("button", { name: "Log" }).tap();
  await settle(page);

  await page.unroute("**/api/storage/**", offline);
  await banner.waitFor({ state: "detached", timeout: 15000 });
  assert.deepEqual(await stored(page, "gymbot:bodyweight"), [{ date: "2026-09-20", weight: 82.5 }, { date: "2026-10-03", weight: 80.5 }]);
  assert.deepEqual(errors, []);
});

test("errors: an uncaught error in the app is reported to the server once", async (t) => {
  const { page, errors } = await openApp(t, { seed: { "gymbot:workouts": [userWorkout] } });
  const reports = [];
  page.on("request", (request) => request.url().endsWith("/api/errors") && reports.push(request.postDataJSON()));
  const report = page.waitForRequest("**/api/errors");
  for (let i = 0; i < 2; i++) await page.addScriptTag({ content: 'throw new Error("boom");' }); // twice, reported once
  await report;
  await settle(page);
  assert.equal(reports.length, 1);
  assert.match(reports[0].message, /boom/);
  assert.equal(reports[0].version, JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8")).version);
  assert.deepEqual(errors, ["boom", "boom"]);
});

test("feedback: sent from Goals with the app version", async (t) => {
  const { page, errors } = await openApp(t, { seed: { "gymbot:workouts": [userWorkout] } });
  await page.getByRole("button", { name: "Goals", exact: true }).tap();
  const panel = section(page, "Feedback");
  assert.ok(await panel.getByRole("button", { name: "Send feedback" }).isDisabled());
  await panel.getByLabel("Feedback").fill("The rest timer should vibrate");
  const request = page.waitForRequest("**/api/feedback");
  await panel.getByRole("button", { name: "Send feedback" }).tap();
  const { version } = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
  assert.deepEqual((await request).postDataJSON(), { text: "The rest timer should vibrate", version });
  await panel.getByText("Sent. Thank you.").waitFor();
  assert.equal(await panel.getByLabel("Feedback").inputValue(), "");
  assert.deepEqual(errors, []);
});
