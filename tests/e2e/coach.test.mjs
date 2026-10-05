import { test } from "node:test";
import assert from "node:assert/strict";
import { openApp, section, stored, settle } from "./helpers.mjs";
import { userWorkout, yesterdayWorkout, settings } from "../fixtures.mjs";

test("check-in: asks about the latest workout, sends, saves, then goes away", async (t) => {
  const { page, errors, claudeRequests } = await openApp(t, {
    seed: { "gymbot:workouts": [userWorkout, yesterdayWorkout] },
    claude: (body) => (body.system.includes("checking in after a workout") ? "Good session. Rest the knee." : "OK"),
  });
  await page.getByRole("button", { name: /^Log/ }).tap();
  const card = section(page, "How did it go?");
  assert.ok(await card.getByRole("button", { name: "Send to coach" }).isDisabled());

  await card.getByRole("radio", { name: "Hard" }).tap();
  await card.getByRole("radio", { name: "A little" }).tap();
  await card.getByPlaceholder(/Slept badly/).fill("left knee a bit sore");
  await card.getByRole("button", { name: "Send to coach" }).tap();
  await page.getByText("Rest the knee.").waitFor();
  await settle(page);

  const sent = claudeRequests.find((b) => b.system.includes("checking in after a workout")).messages[0].content;
  assert.ok(sent.startsWith("CHECK-IN for the 2026-10-02 workout: effort Hard; pain A little; note: left knee a bit sore"));
  const saved = (await stored(page, "gymbot:workouts")).find((w) => w.id === "oct2").checkIn;
  assert.deepEqual({ ...saved, reply: undefined }, { effort: "Hard", pain: "A little", note: "left knee a bit sore", reply: undefined });
  assert.equal(await card.count(), 0);
  assert.deepEqual(errors, []);
});

test("coach: video tags become library links; anything else is dropped", async (t) => {
  const { page, errors } = await openApp(t, {
    seed: { "gymbot:workouts": [userWorkout] },
    claude: (body) => (body.system.startsWith("You are GymBot, a direct") ? "Neutral grip.\n[video: Hammer Curl]\n[video: Zercher Squat]\nhttps://example.com/fake" : "OK"),
  });
  await page.getByPlaceholder("Message your coach").fill("how do I do hammer curls?");
  await page.getByRole("button", { name: "Send" }).tap();
  await page.getByText("Neutral grip.").waitFor();
  const reply = page.locator("div.rounded-bl-md").last();
  assert.deepEqual(await reply.getByRole("link").evaluateAll((links) => links.map((a) => a.href)), ["https://www.youtube.com/watch?v=zC3nLlEvin4"]);
  assert.ok(!(await reply.innerText()).includes("Zercher"));
  assert.deepEqual(errors, []);
});

test("today card: planned workout first, and the daily note becomes a pep talk", async (t) => {
  const { page, errors, claudeRequests } = await openApp(t, {
    seed: { "gymbot:workouts": [userWorkout], "gymbot:settings": settings({ trainingDays: [6], trainingTime: "20:00" }) },
    claude: (body) => (body.system.includes("motivation note") ? "Big one tonight." : "OK"),
  });
  await page.getByText("Big one tonight.").waitFor();
  const facts = await section(page, "Today").locator("li").allInnerTexts();
  assert.match(facts[0], /^Workout planned today at 20:00/);
  const note = claudeRequests.find((b) => b.system.includes("motivation note"));
  assert.ok(note.system.includes("pep talk"));
  assert.ok(note.messages[0].content.includes("Workout planned today at 20:00"));
  assert.deepEqual(errors, []);
});
