import { test } from "node:test";
import assert from "node:assert/strict";
import { isCoachChat, openApp, section, stored, settle } from "./helpers.mjs";
import { userWorkout, yesterdayWorkout, settings } from "../fixtures.mjs";

test("check-in: asks about the latest workout, sends, saves, then goes away", async (t) => {
  const { page, errors, aiRequests } = await openApp(t, {
    seed: { "gymbot:workouts": [userWorkout, yesterdayWorkout] },
    ai: (body) => (body.system.includes("checking in after a workout") ? "Good session. Rest the knee." : "OK"),
  });
  await page.getByRole("button", { name: /^Log/ }).tap();
  const card = section(page, "How did it go?");
  assert.match(await card.innerText(), /yesterday's workout/); // asked the day after, not right after the finish screen
  assert.ok(await card.getByRole("button", { name: "Send to coach" }).isDisabled());

  await card.getByRole("radio", { name: "Hard" }).tap();
  await card.getByRole("radio", { name: "A little" }).tap();
  await card.getByPlaceholder(/Slept badly/).fill("left knee a bit sore");
  await card.getByRole("button", { name: "Send to coach" }).tap();
  await page.getByText("Rest the knee.").waitFor();
  await settle(page);

  const sent = aiRequests.find((b) => b.system.includes("checking in after a workout")).messages[0].content;
  assert.ok(sent.startsWith("CHECK-IN for the 2026-10-02 workout: effort Hard; pain A little; note: left knee a bit sore"));
  const saved = (await stored(page, "gymbot:workouts")).find((w) => w.id === "oct2").checkIn;
  assert.deepEqual({ ...saved, reply: undefined }, { effort: "Hard", pain: "A little", note: "left knee a bit sore", reply: undefined });
  assert.equal(await card.count(), 0);
  assert.deepEqual(errors, []);
});

test("coach: video tags become library links; anything else is dropped", async (t) => {
  const { page, errors } = await openApp(t, {
    seed: { "gymbot:workouts": [userWorkout] },
    ai: (body) => (body.system.startsWith("You are MyGymBot, a direct") ? "Neutral grip.\n[video: Hammer Curl]\n[video: Zercher Squat]\nhttps://example.com/fake" : "OK"),
  });
  await page.getByPlaceholder("Message your coach").fill("how do I do hammer curls?");
  await page.getByRole("button", { name: "Send" }).tap();
  await page.getByText("Neutral grip.").waitFor();
  const reply = page.locator("div.rounded-bl-md").last();
  assert.deepEqual(await reply.getByRole("link").evaluateAll((links) => links.map((a) => a.href)), ["https://www.youtube.com/watch?v=zC3nLlEvin4"]);
  assert.ok(!(await reply.innerText()).includes("Zercher"));
  assert.deepEqual(errors, []);
});

test("coach: the chat opens at the latest message under a pinned Today card, and follows new replies", async (t) => {
  const chat = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `Message ${i}` }));
  const { page, errors } = await openApp(t, {
    seed: { "gymbot:workouts": [userWorkout], "gymbot:chat": chat },
    ai: (body) => (isCoachChat(body) ? "The newest reply." : "OK"),
  });
  // Visible means inside the window and inside the chat pane, which scrolls on its own.
  const visible = (locator) =>
    locator.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const pane = el.closest(".overflow-y-auto")?.getBoundingClientRect() ?? { top: 0, bottom: innerHeight };
      return box.top >= Math.max(0, pane.top) && box.bottom <= Math.min(innerHeight, pane.bottom);
    });
  const shows = async (locator) => {
    for (let i = 0; i < 20 && !(await visible(locator)); i++) await page.waitForTimeout(50); // the pane scrolls after layout
    return visible(locator);
  };
  const today = page.getByRole("heading", { name: "Today" });
  await page.getByText("Message 29", { exact: true }).waitFor();
  assert.ok(await shows(page.getByText("Message 29", { exact: true })));
  assert.ok(!(await visible(page.getByText("Message 0", { exact: true }))));
  assert.ok(await shows(today));

  await today.tap(); // open Today, then typing closes it again to make room for the keyboard
  assert.equal(await today.getByRole("button").getAttribute("aria-expanded"), "true");
  assert.ok(await shows(page.getByText("Message 29", { exact: true })));
  await page.getByPlaceholder("Message your coach").tap();
  assert.equal(await today.getByRole("button").getAttribute("aria-expanded"), "false");
  await page.getByPlaceholder("Message your coach").fill("what next?");
  await page.getByRole("button", { name: "Send" }).tap();
  await page.getByText("The newest reply.").waitFor();
  assert.ok(await shows(page.getByText("The newest reply.")));
  assert.ok(await shows(today));
  assert.equal(await page.evaluate(() => scrollY), 0); // the page itself never scrolls
  assert.deepEqual(errors, []);
});

test("coach memory: what the athlete says is remembered, shown in Goals, editable, and sent with later chats", async (t) => {
  const { page, errors, aiRequests } = await openApp(t, {
    seed: { "gymbot:workouts": [userWorkout] },
    ai: (body) => (!isCoachChat(body) ? "OK" : body.messages.at(-1).content.includes("like") ? "Dumbbells it is.\n[remember: Prefers dumbbells over barbells]" : "Upper body today."),
  });
  await page.getByPlaceholder("Message your coach").fill("I like dumbbells more than barbells");
  await page.getByRole("button", { name: "Send" }).tap();
  await page.getByText("Noted: Prefers dumbbells over barbells").waitFor();
  await settle(page);
  assert.deepEqual((await stored(page, "gymbot:settings")).coachMemory.map((f) => f.text), ["Prefers dumbbells over barbells"]);

  await page.getByRole("button", { name: "Goals", exact: true }).tap();
  const panel = section(page, "What your coach knows");
  await panel.getByLabel("Fact 1", { exact: true }).fill("Prefers dumbbells");
  await page.getByRole("button", { name: "Coach", exact: true }).tap();
  await page.getByPlaceholder("Message your coach").fill("what should I do today?");
  await page.getByRole("button", { name: "Send" }).tap();
  await settle(page);
  assert.match(aiRequests.filter(isCoachChat).at(-1).system, /WHAT YOU KNOW ABOUT THE ATHLETE[^\n]*\n- Prefers dumbbells \(\d{4}-\d\d-\d\d\)/);

  await page.getByRole("button", { name: "Goals", exact: true }).tap();
  await panel.getByRole("button", { name: "Delete fact 1" }).tap();
  await panel.getByRole("button", { name: "Tap again to delete" }).tap();
  await panel.getByText("Tell your coach about preferences").waitFor();
  await settle(page);
  assert.deepEqual((await stored(page, "gymbot:settings")).coachMemory, []);
  assert.deepEqual(errors, []);
});

test("onboarding: a new athlete's coach asks first, then the profile and plans it suggests are saved", async (t) => {
  const { page, errors, aiRequests } = await openApp(t, {
    ai: (body) =>
      isCoachChat(body)
        ? "Here's your start.\n[profile: experience: Beginner; daysPerWeek: 3; sessionMinutes: 45; focus: General fitness; equipment: Dumbbells, bench; music: hip hop]\n[plan: A: Goblet Squat, Push-up]\n[plan: B: Romanian Deadlift, Lat Pulldown]"
        : "OK",
  });
  await page.getByRole("button", { name: "Skip" }).tap(); // the first-time tour
  await page.getByText("A few quick questions first").waitFor();
  assert.equal(await page.getByRole("button", { name: "Clear chat" }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Analyze my last 4 weeks" }).count(), 0); // no quick prompts about data they don't have
  await page.getByPlaceholder("Message your coach").fill("Just feel fitter");
  await page.getByRole("button", { name: "Send" }).tap();
  await page.getByText("Here's your start.").waitFor();

  const sent = aiRequests.find(isCoachChat);
  assert.ok(sent.system.includes("NEW ATHLETE"));
  assert.deepEqual(sent.messages, [{ role: "user", content: "Just feel fitter" }]); // the opening question is in the prompt, not a turn
  await page.getByRole("button", { name: "Save to profile" }).tap();
  await page.getByRole("button", { name: "Save plan A" }).tap();
  await page.getByRole("button", { name: "Save plan B" }).tap();
  await page.getByText("Your first workout is ready: A.").waitFor();
  await page.getByText("A few quick questions first").waitFor(); // still in the chat
  await settle(page);

  const saved = await stored(page, "gymbot:settings");
  assert.deepEqual(
    [saved.profile.experience, saved.profile.daysPerWeek, saved.profile.sessionMinutes, saved.profile.focus, saved.profile.equipment, saved.profile.music],
    ["Beginner", 3, 45, "General fitness", ["dumbbell", "bench"], "hip hop"]
  );
  assert.deepEqual(saved.routines.map((r) => r.name), ["A", "B"]);
  assert.equal(aiRequests.filter((b) => b.system.includes("motivation note")).length, 0); // no daily note before there's anything to say

  await page.getByRole("button", { name: "Clear chat" }).tap(); // the chat is gone for good, so it takes a second tap
  await page.getByText("Here's your start.").waitFor();
  await page.getByRole("button", { name: "Tap again to clear" }).tap();
  await page.getByText("Here's your start.").waitFor({ state: "detached" });
  assert.deepEqual(errors, []);
});

test("first-time tour: once for a new athlete, one card per tab, then the interview; Goals shows it again, Back closes it", async (t) => {
  const { page, errors } = await openApp(t);
  const tour = page.getByRole("dialog");
  const tab = (name) => page.getByRole("navigation").getByRole("button", { name, exact: true });
  await tour.getByText("1 of 5").waitFor();
  assert.equal(await tab("Coach").getAttribute("aria-current"), "page");
  for (const [i, name] of ["Log", "Food", "Progress", "Goals"].entries()) {
    await tour.getByRole("button", { name: "Next" }).tap();
    await tour.getByText(`${i + 2} of 5`).waitFor();
    assert.equal(await tab(name).getAttribute("aria-current"), "page"); // the screen behind is the tab it describes
  }
  assert.equal(await tour.getByRole("button", { name: "Skip" }).count(), 0);
  await tour.getByRole("button", { name: "Get started" }).tap();
  await tour.waitFor({ state: "detached" });
  await page.getByText("A few quick questions first").waitFor(); // back on Coach, where the interview starts
  for (let i = 0; i < 20 && !(await stored(page, "gymbot:settings"))?.tourSeen; i++) await page.waitForTimeout(100);
  assert.equal((await stored(page, "gymbot:settings")).tourSeen, true);

  await page.reload();
  await page.getByText("A few quick questions first").waitFor();
  assert.equal(await tour.count(), 0); // once

  await tab("Goals").tap();
  await page.getByRole("button", { name: "Show the tour again" }).tap();
  await tour.getByText("1 of 5").waitFor();
  await page.goBack(); // Android's Back skips it
  await tour.waitFor({ state: "detached" });
  assert.deepEqual(errors, []);
});

test("onboarding: the coach's first message offers to import history from another app", async (t) => {
  const { page, errors } = await openApp(t);
  await page.getByRole("button", { name: "Skip" }).tap(); // the first-time tour
  await page.getByText("Already logging workouts in another app").waitFor();
  await page.getByRole("button", { name: "Import history" }).tap();
  await section(page, "Import history").getByText("Export a CSV from Strong, Hevy").waitFor(); // Log, with the import open
  assert.equal(await page.getByRole("button", { name: "Close import" }).count(), 1);
  assert.deepEqual(errors, []);
});

test("today card: planned workout first, and the daily note becomes a pep talk", async (t) => {
  const { page, errors, aiRequests } = await openApp(t, {
    seed: { "gymbot:workouts": [userWorkout], "gymbot:settings": settings({ trainingDays: [6], trainingTime: "20:00" }) },
    ai: (body) => (body.system.includes("motivation note") ? "Big one tonight." : "OK"),
  });
  const today = section(page, /^Today/);
  await today.getByText("Workout planned today at 20:00").waitFor(); // closed, it shows the first fact
  await today.getByRole("button").tap();
  await page.getByText("Big one tonight.").waitFor();
  const facts = await today.locator("li").allInnerTexts();
  assert.match(facts[0], /^Workout planned today at 20:00/);
  const note = aiRequests.find((b) => b.system.includes("motivation note"));
  assert.ok(note.system.includes("pep talk"));
  assert.ok(note.messages[0].content.includes("Workout planned today at 20:00"));
  assert.deepEqual(errors, []);
});

test("injuries: the profile note is read into muscles, and Autopilot holds the lifts that work them", async (t) => {
  const { page, errors, aiRequests } = await openApp(t, {
    seed: { "gymbot:workouts": [userWorkout] },
    ai: (body) => (body.system.startsWith("Below is an athlete's note") ? '{"muscles":["shoulders","nonsense"]}' : "OK"),
  });
  await page.getByRole("button", { name: "Goals", exact: true }).tap();
  await page.getByPlaceholder(/Left shoulder gets cranky/).fill("Left shoulder sore since last week");
  await page.getByText("Autopilot keeps the weight on lifts that work your shoulders.").waitFor();
  assert.equal(aiRequests.filter((b) => b.system.startsWith("Below is an athlete's note")).length, 1); // once, after typing stopped
  await settle(page);
  assert.deepEqual((await stored(page, "gymbot:settings")).injuryAreas, { notes: "Left shoulder sore since last week", muscles: ["shoulders"] });

  await page.getByRole("button", { name: /^Log/ }).tap();
  const bench = page.locator("li", { hasText: "Bench Press (Dumbbell)" }).first();
  await bench.getByText("Hold for pain").waitFor();
  assert.match(await bench.innerText(), /Easy on your shoulders/);
  assert.deepEqual(errors, []);
});

test("equipment: picked in Goals by place, by tap or from the logged workouts, and the coach plans with it", async (t) => {
  const { page, errors, aiRequests } = await openApp(t, { seed: { "gymbot:workouts": [userWorkout] } });
  await page.getByRole("button", { name: "Goals", exact: true }).tap();
  const panel = section(page, "Equipment");
  await panel.getByText("Pick where you train").waitFor();
  const pressed = () => panel.getByRole("button", { pressed: true }).allInnerTexts();
  assert.deepEqual(await pressed(), []); // not chosen yet

  await panel.getByRole("button", { name: "Home gym" }).tap();
  assert.deepEqual(await pressed(), ["Dumbbells", "Bench", "Pull-up bar"]);
  await panel.getByRole("button", { name: "Bench", exact: true }).tap();
  await panel.getByLabel("Dumbbells up to (kg)").fill("20");
  await settle(page);
  const { profile } = await stored(page, "gymbot:settings");
  assert.deepEqual([profile.equipment, profile.dumbbellMax], [["dumbbell", "pullUpBar"], "20"]);

  await panel.getByRole("button", { name: "From my workouts" }).tap(); // the Sep 23 workout
  assert.deepEqual(await pressed(), ["Dumbbells", "Kettlebells", "Cable machine", "Weight machines"]);
  await panel.getByRole("button", { name: "No equipment" }).tap();
  assert.deepEqual(await pressed(), []);
  assert.equal(await panel.getByLabel("Dumbbells up to (kg)").count(), 0);

  await page.getByRole("button", { name: "Coach", exact: true }).tap();
  await page.getByPlaceholder("Message your coach").fill("Plan my next workout");
  await page.getByRole("button", { name: "Send" }).tap();
  await page.getByText("OK").waitFor();
  assert.ok(aiRequests.find(isCoachChat).system.includes("EQUIPMENT: none, so plan bodyweight exercises only."));
  assert.deepEqual(errors, []);
});

test("form check: in the exercise's details sheet; photos go to the AI as base64 JPEG images next to the request", async (t) => {
  const { page, errors, aiRequests } = await openApp(t, {
    seed: { "gymbot:workouts": [userWorkout] },
    ai: (body) => (body.system.startsWith("You are an expert strength coach") ? "**Verdict**: solid lockout." : "OK"),
  });
  await page.getByRole("button", { name: /^Log/ }).tap();
  await page.getByRole("button", { name: "Show details for Bench Press (Dumbbell)" }).first().tap();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: "Check my form" }).tap(); // folded until asked for
  await sheet.getByLabel("Upload a video or photos").setInputFiles({ name: "lockout.png", mimeType: "image/png", buffer: Buffer.from(PNG_1PX, "base64") });
  await sheet.getByAltText("Frame 1").waitFor();
  await sheet.getByRole("button", { name: "Check my form" }).tap();
  await sheet.getByText("solid lockout.").first().waitFor(); // the feedback, and the same text under Past form checks
  await sheet.getByText("Past form checks").waitFor();
  const [message] = aiRequests.find((b) => b.system.startsWith("You are an expert strength coach")).messages;
  assert.match(message.content, /^Exercise: Bench Press \(Dumbbell\)\./);
  assert.equal(message.images.length, 1);
  assert.ok(Buffer.from(message.images[0], "base64").subarray(0, 2).equals(Buffer.from([0xff, 0xd8]))); // re-encoded as JPEG
  assert.deepEqual(errors, []);
});

const PNG_1PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
