import { useState } from "react";
import { Camera, X } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, ReferenceLine, ResponsiveContainer, CartesianGrid } from "recharts";
import { CHART, FOOD_CHART_DAYS } from "../config.js";
import { FOOD_PROMPT } from "../prompts.js";
import { askAIForJson } from "../ai.js";
import { imageToFrame } from "../media.js";
import { parseDate, today } from "../dates.js";
import { dailyProtein, dayTotals, itemTotals, mealTotals, mealsOn, parseFoodDraft, proteinTarget, usualMeals } from "../food.js";
import { DeleteButton, ErrorText, FilePicker, Panel, PrimaryButton, SectionTitle, ViewTitle, inputClass } from "./primitives.jsx";

const nowTime = () => new Date().toTimeString().slice(0, 5);
const grams = (n) => `${Math.round(n)} g`;
const sortMeals = (meals) => [...meals].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));

// Asks the AI for a meal's items from a photo, a description or both.
async function draftMeal({ photo, text }) {
  const content = [photo ? "A photo of the meal." : "", text ? `The athlete says: ${text}` : ""].filter(Boolean).join("\n");
  const draft = parseFoodDraft(await askAIForJson(FOOD_PROMPT, content, photo ? [photo] : []));
  if (!draft.items.length) throw new Error(photo ? "No food found in that photo. Try another, or type what you ate." : "Couldn't tell what that was. Try naming the foods.");
  return draft;
}

function ProteinToday({ totals, target }) {
  const share = target ? Math.min(1, totals.protein / target.low) : 0;
  return (
    <Panel className="space-y-2">
      <div className="flex items-baseline gap-2">
        <span className="gb-display text-5xl font-bold leading-none tabular-nums text-zinc-900">{Math.round(totals.protein)}</span>
        <span className="text-zinc-600">{target ? `of ${target.low} g protein today` : "g protein today"}</span>
      </div>
      {target && (
        <div className="h-2 overflow-hidden rounded-full bg-zinc-200">
          <div className="h-full origin-left rounded-full bg-blue-700 transition-transform duration-300" style={{ transform: `scaleX(${share})` }} />
        </div>
      )}
      <p className="text-sm text-zinc-500">
        {totals.kcal > 0 ? `About ${Math.round(totals.kcal)} kcal, ${grams(totals.carbs)} carbs, ${grams(totals.fat)} fat.` : "Nothing logged yet today."}
        {target ? ` Up to ${target.high} g protein is useful.` : " Log your bodyweight on the Workout done screen for a protein target."}
      </p>
    </Panel>
  );
}

// A meal's items, to correct before saving: the AI's grams are a first guess, usually on the low side.
function MealEditor({ meal, onSave, onCancel, onDelete }) {
  const [draft, setDraft] = useState(meal);
  const [more, setMore] = useState("");
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const totals = mealTotals(draft);
  const setItem = (index, change) => setDraft((d) => ({ ...d, items: d.items.map((item, i) => (i === index ? { ...item, ...change } : item)) }));

  function answer(option) {
    setDraft((d) => ({ ...d, question: null, items: option.add ? [...d.items, option.add] : d.items }));
  }

  async function addMore() {
    setStatus("asking");
    setError("");
    try {
      const added = await draftMeal({ text: more.trim() });
      setDraft((d) => ({ ...d, items: [...d.items, ...added.items] }));
      setMore("");
    } catch (err) {
      setError(err.message);
    } finally {
      setStatus("idle");
    }
  }

  return (
    <Panel className="gb-rise space-y-3">
      <div className="flex items-center gap-2">
        <input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} aria-label="Meal name" placeholder="Meal" className={`${inputClass} font-semibold`} />
        {onDelete && <DeleteButton onConfirm={onDelete} label="Delete this meal" />}
      </div>
      <p className="text-sm text-zinc-600">
        <span className="font-semibold text-zinc-900">{grams(totals.protein)} protein</span>, about {Math.round(totals.kcal)} kcal. Check the grams: photos tend to look smaller than they are.
      </p>

      {draft.question && (
        <div className="gb-fade rounded-xl bg-blue-50 p-3">
          <p className="text-sm font-medium text-blue-900">{draft.question.text}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {draft.question.options.map((option) => (
              <button key={option.label} onClick={() => answer(option)} className="h-10 rounded-full bg-white px-4 text-sm font-semibold text-blue-800">
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <ul className="divide-y divide-zinc-100">
        {draft.items.map((item, i) => (
          <li key={i} className="flex items-center gap-2 py-1.5">
            <span className="min-w-0 flex-1 text-zinc-800">{item.name}</span>
            <input
              type="number"
              inputMode="numeric"
              value={item.grams}
              onChange={(e) => setItem(i, { grams: e.target.value })}
              aria-label={`${item.name} grams`}
              className="h-10 w-20 rounded-lg border border-zinc-300 px-2 text-right tabular-nums focus:border-blue-700 focus:outline-none"
            />
            <span className="w-4 text-sm text-zinc-500">g</span>
            <span className="w-14 text-right text-sm tabular-nums text-zinc-600">{grams(itemTotals(item).protein)}</span>
            <button
              onClick={() => setDraft((d) => ({ ...d, items: d.items.filter((_, j) => j !== i) }))}
              aria-label={`Remove ${item.name}`}
              className="flex h-10 w-8 shrink-0 items-center justify-center text-zinc-400"
            >
              <X className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>

      <div className="flex gap-2">
        <input value={more} onChange={(e) => setMore(e.target.value)} onKeyDown={(e) => e.key === "Enter" && more.trim() && addMore()} placeholder="Add something: a glass of milk" aria-label="Add something" className={inputClass} />
        <button onClick={addMore} disabled={!more.trim() || status !== "idle"} className="shrink-0 rounded-lg bg-zinc-100 px-4 font-semibold text-zinc-800 disabled:opacity-40">
          {status === "asking" ? "Adding" : "Add"}
        </button>
      </div>
      <ErrorText message={error} />

      <PrimaryButton onClick={() => onSave(draft)} disabled={!draft.items.length}>
        Save meal
      </PrimaryButton>
      <button onClick={onCancel} className="gb-tap w-full text-sm font-semibold text-zinc-500">
        Cancel
      </button>
    </Panel>
  );
}

function ProteinWeek({ food, target }) {
  const days = dailyProtein(food, today(), FOOD_CHART_DAYS).map((day) => ({
    day: parseDate(day.date).toLocaleDateString(undefined, { weekday: "short" }),
    protein: Math.round(day.protein),
  }));
  if (days.filter((day) => day.protein > 0).length < 2) return null;
  const top = Math.ceil(Math.max(target?.low ?? 0, ...days.map((day) => day.protein)) / 50) * 50; // round ticks, and the target line in sight
  return (
    <Panel>
      <SectionTitle>Protein this week</SectionTitle>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={days} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid stroke={CHART.grid} vertical={false} />
          <XAxis dataKey="day" tick={CHART.tick} tickLine={false} axisLine={false} />
          <YAxis tick={CHART.tick} tickLine={false} axisLine={false} domain={[0, top]} tickCount={top / 50 + 1} />
          {target && <ReferenceLine y={target.low} stroke={CHART.accent} strokeDasharray="4 4" />}
          <Bar dataKey="protein" name="Protein (g)" fill={CHART.accent} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </Panel>
  );
}

export function FoodView({ food, setFood, bodyweight, unit }) {
  const [editing, setEditing] = useState(null); // the meal in the editor: a new draft or a saved meal
  const [text, setText] = useState("");
  const [status, setStatus] = useState("idle"); // idle | reading
  const [error, setError] = useState("");
  const date = today();
  const target = proteinTarget(bodyweight, unit);
  const meals = sortMeals(mealsOn(food, date));
  const usual = usualMeals(food);

  async function start(input) {
    setStatus("reading");
    setError("");
    try {
      const draft = await draftMeal(input);
      setEditing({ id: crypto.randomUUID(), date, time: nowTime(), ...draft });
      setText("");
    } catch (err) {
      setError(err.message);
    } finally {
      setStatus("idle");
    }
  }

  async function snap(files) {
    setStatus("reading");
    try {
      await start({ photo: await imageToFrame(files[0]), text: text.trim() });
    } catch (err) {
      setError(err.message);
      setStatus("idle");
    }
  }

  function choose(event) {
    const [file] = event.target.files ?? [];
    event.target.value = ""; // allow choosing the same photo again
    if (file) snap([file]);
  }

  function save({ question, ...meal }) {
    const items = meal.items.map((item) => ({ ...item, grams: Math.max(0, Number(item.grams) || 0) }));
    setFood((all) => sortMeals([...all.filter((m) => m.id !== meal.id), { ...meal, items, name: meal.name.trim() || "Meal" }]));
    setEditing(null);
  }

  function remove() {
    setFood((all) => all.filter((m) => m.id !== editing.id));
    setEditing(null);
  }

  const relog = (meal) => setFood((all) => sortMeals([...all, { ...meal, id: crypto.randomUUID(), date, time: nowTime() }]));

  return (
    <div className="space-y-4">
      <ViewTitle>Food</ViewTitle>
      <ProteinToday totals={dayTotals(food, date)} target={target} />

      {editing ? (
        <MealEditor
          key={editing.id}
          meal={editing}
          onSave={save}
          onCancel={() => setEditing(null)}
          onDelete={food.some((m) => m.id === editing.id) ? remove : null}
        />
      ) : (
        <Panel className="space-y-3">
          <FilePicker Icon={Camera} accept="image/*" capture="environment" busy={status === "reading"} title={status === "reading" ? "Looking at your meal" : "Snap a meal"} hint="You check the grams before saving." onFiles={snap} />
          {status === "idle" && (
            // the real input sits over the link: a label forwarding the tap fails in in-app browsers
            <div className="relative mx-auto flex h-10 w-fit items-center px-3">
              <span className="text-sm font-semibold text-blue-700">Or choose a photo</span>
              <input type="file" accept="image/*" onChange={choose} aria-label="Or choose a photo" className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
            </div>
          )}
          <div className="flex gap-2">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && text.trim() && status === "idle" && start({ text: text.trim() })}
              placeholder="Or type it: 2 eggs, toast, coffee"
              aria-label="What did you eat?"
              className={inputClass}
            />
            <button onClick={() => start({ text: text.trim() })} disabled={!text.trim() || status !== "idle"} className="shrink-0 rounded-lg bg-blue-700 px-4 font-semibold text-white disabled:opacity-40">
              Add
            </button>
          </div>
          <ErrorText message={error} />
          {usual.length > 0 && (
            <div>
              <p className="mb-2 text-sm text-zinc-500">Your usual meals, one tap to log:</p>
              <div className="flex flex-wrap gap-2">
                {usual.map((meal) => (
                  <button key={meal.id} onClick={() => relog(meal)} className="h-10 rounded-full bg-zinc-100 px-4 text-sm font-semibold text-zinc-700">
                    {meal.name}, {grams(mealTotals(meal).protein)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </Panel>
      )}

      {meals.length > 0 && (
        <Panel>
          <SectionTitle>Today</SectionTitle>
          <ul className="divide-y divide-zinc-100">
            {meals.map((meal) => (
              <li key={meal.id}>
                <button onClick={() => setEditing(meal)} className="flex min-h-12 w-full items-center gap-3 py-2 text-left">
                  <span className="w-12 shrink-0 text-sm tabular-nums text-zinc-500">{meal.time}</span>
                  <span className="min-w-0 flex-1 truncate font-medium text-zinc-900">{meal.name}</span>
                  <span className="shrink-0 text-sm tabular-nums text-zinc-600">{grams(mealTotals(meal).protein)}</span>
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <ProteinWeek food={food} target={target} />
    </div>
  );
}
