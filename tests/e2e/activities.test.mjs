import { test } from "node:test";
import assert from "node:assert/strict";
import { openApp, section, isCoachChat } from "./helpers.mjs";
import { userWorkout } from "../fixtures.mjs";

test("activities: log a run and yoga; Progress and the coach see them", async (t) => {
  const { page, errors, aiRequests } = await openApp(t, { seed: { "gymbot:workouts": [userWorkout] } });
  await page.getByRole("button", { name: /^Log/ }).tap();
  const panel = section(page, "Log an activity");
  assert.equal(await panel.getByLabel("Minutes").count(), 0); // small until an activity is picked

  await panel.getByRole("button", { name: "Running", exact: true }).tap();
  await panel.getByLabel("Minutes").fill("28");
  await panel.getByLabel("Distance (km)").fill("5");
  await panel.getByRole("radio", { name: "Moderate" }).tap();
  await panel.getByRole("button", { name: "Save running" }).tap();
  assert.ok((await section(page, "Session saved").innerText()).includes("Running 28 min, 5 km (5:36 /km) logged."));

  await panel.getByRole("button", { name: "Yoga", exact: true }).tap();
  assert.equal(await panel.getByLabel(/^Distance/).count(), 0); // no distance for yoga
  await panel.getByLabel("Minutes").fill("45");
  await panel.getByRole("button", { name: "Save yoga" }).tap();

  await page.getByRole("button", { name: "Progress", exact: true }).tap();
  const week = await section(page, "Activities, last 7 days")
    .locator("li")
    .evaluateAll((rows) => rows.map((row) => [row.querySelector(".flex-1").textContent, row.querySelector(".text-right").textContent]));
  assert.deepEqual(week, [["Yoga", "1 session, 45 min"], ["Running", "1 session, 28 min, 5 km"]]);

  await page.getByRole("button", { name: "Coach", exact: true }).tap();
  await page.getByRole("button", { name: "Plan my next session" }).tap();
  await page.waitForTimeout(300);
  const context = aiRequests.filter(isCoachChat).at(-1).system;
  assert.ok(context.includes("ACTIVITIES, LAST 7 DAYS: Yoga: 1 session, 45 min; Running: 1 session, 28 min, 5 km"));
  assert.ok(context.includes("2026-10-03: Running 28 min, 5 km (moderate)"));
  assert.deepEqual(errors, []);
});
