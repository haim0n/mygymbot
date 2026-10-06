import { useState, useMemo } from "react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { CHART, FORECAST_MIN_WEEKLY_GAIN } from "../config.js";
import { formatShortDate, formatVolume, today, weekStart } from "../dates.js";
import { currentBodyweight, exerciseTrend, round1, weeklyVolume, workoutVolume } from "../training.js";
import { sessionsInWeekOf } from "../motivation.js";
import { strengthTrend } from "../schedule.js";
import { Panel, PrimaryButton, SectionTitle, ViewTitle, inputClass } from "./primitives.jsx";
import { MuscleHeatmap } from "./muscles.jsx";
import { ActivityWeek } from "./activities.jsx";

export function Stat({ value, label }) {
  return (
    <div className="rounded-2xl bg-white p-3">
      <div className="gb-display text-3xl font-bold text-zinc-900 leading-none tabular-nums">{value}</div>
      <div className="mt-1 text-xs text-zinc-500">{label}</div>
    </div>
  );
}

export function BodyweightPanel({ log, profile, unit, onLog }) {
  const [draft, setDraft] = useState("");
  const current = currentBodyweight(log, profile);
  const change = log.length > 1 ? round1(log.at(-1).weight - log[0].weight) : 0;
  const data = log.map((entry) => ({ date: formatShortDate(entry.date), weight: entry.weight }));

  function save() {
    const weight = Number(draft);
    if (!(weight > 0)) return;
    onLog(weight);
    setDraft("");
  }

  return (
    <Panel className="space-y-3">
      <SectionTitle>Bodyweight</SectionTitle>
      {log.length > 1 && (
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid stroke={CHART.grid} vertical={false} />
            <XAxis dataKey="date" tick={CHART.tick} tickLine={false} axisLine={false} />
            <YAxis tick={CHART.tick} tickLine={false} axisLine={false} domain={["auto", "auto"]} />
            <Tooltip contentStyle={CHART.tooltip} />
            <Line type="monotone" dataKey="weight" name={`Bodyweight (${unit})`} stroke={CHART.accent} strokeWidth={2.5} dot={{ r: 3, fill: CHART.accent }} />
          </LineChart>
        </ResponsiveContainer>
      )}
      <p className="text-sm text-zinc-500">
        {current ? `Now ${current} ${unit}` : "Log your weight to follow it over time."}
        {log.length > 1 && `, ${change === 0 ? "no change" : `${change > 0 ? "up" : "down"} ${Math.abs(change)} ${unit}`} since ${formatShortDate(log[0].date)}.`}
      </p>
      <div className="flex gap-2">
        <input
          type="number"
          inputMode="decimal"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
          placeholder={`Today's weight (${unit})`}
          aria-label="Today's weight"
          className={inputClass}
        />
        <button onClick={save} disabled={!(Number(draft) > 0)} className="shrink-0 rounded-lg bg-blue-700 px-4 font-semibold text-white disabled:opacity-40">
          Log
        </button>
      </div>
    </Panel>
  );
}

// One line under the 1RM chart: where this lift is heading if the recent pace holds.
export function TrendLine({ workouts, exercise, unit }) {
  const trend = strengthTrend(workouts, exercise);
  let text = "Log this lift over 2+ weeks to see where it's heading.";
  if (trend && trend.perDay * 7 >= FORECAST_MIN_WEEKLY_GAIN) {
    text = `At this pace: about ${round1(trend.todayValue + trend.perDay * 28)} ${unit} in 4 weeks (+${round1(trend.perDay * 7)} ${unit} a week).`;
  } else if (trend) {
    text = "Flat over the last few weeks. Ask your coach how to get it moving.";
  }
  return <p className="mt-2 text-sm text-zinc-600">{text}</p>;
}

export function ProgressView({ workouts, records, exerciseNames, learnedMuscles, unit, daysPerWeek, bodyweight, onNavigate }) {
  const [selected, setSelected] = useState(exerciseNames[0] ?? "");
  const trend = useMemo(() => exerciseTrend(workouts, selected), [workouts, selected]);
  const volume = useMemo(() => weeklyVolume(workouts), [workouts]);

  if (!workouts.length) {
    return (
      <div>
        <ViewTitle>Progress</ViewTitle>
        <Panel className="space-y-3">
          <p className="text-zinc-600">Your charts appear here once you log a workout.</p>
          <PrimaryButton onClick={() => onNavigate("log")}>Log a workout</PrimaryButton>
        </Panel>
        <div className="mt-4">
          <BodyweightPanel {...bodyweight} unit={unit} />
        </div>
      </div>
    );
  }

  const thisWeek = workouts.filter((w) => weekStart(w.date) === weekStart(today()));
  const thisWeekVolume = thisWeek.reduce((sum, w) => sum + workoutVolume(w), 0);
  const bestLifts = Object.entries(records).sort(([, a], [, b]) => b.e1rm - a.e1rm);

  return (
    <div className="space-y-4">
      <ViewTitle>Progress</ViewTitle>

      <div className="grid grid-cols-3 gap-2">
        <Stat value={workouts.length} label="sessions logged" />
        <Stat value={`${sessionsInWeekOf(workouts, today())}/${daysPerWeek}`} label="training days this week" />
        <Stat value={formatVolume(thisWeekVolume)} label={`${unit} lifted this week`} />
      </div>

      <ActivityWeek workouts={workouts} />
      <BodyweightPanel {...bodyweight} unit={unit} />
      <MuscleHeatmap workouts={workouts} learned={learnedMuscles} />

      {exerciseNames.length > 0 && (
      <Panel>
        <div className="flex items-center justify-between gap-3 mb-3">
          <h2 className="gb-display text-2xl font-bold text-zinc-900">Estimated 1RM</h2>
          <select value={selected} onChange={(e) => setSelected(e.target.value)} className="w-40 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm">
            {exerciseNames.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </div>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={trend} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid stroke={CHART.grid} vertical={false} />
            <XAxis dataKey="date" tick={CHART.tick} tickLine={false} axisLine={false} />
            <YAxis tick={CHART.tick} tickLine={false} axisLine={false} domain={["auto", "auto"]} />
            <Tooltip contentStyle={CHART.tooltip} />
            <Line type="monotone" dataKey="e1rm" name={`Est. 1RM (${unit})`} stroke={CHART.accent} strokeWidth={2.5} dot={{ r: 3, fill: CHART.accent }} />
          </LineChart>
        </ResponsiveContainer>
        <TrendLine workouts={workouts} exercise={selected} unit={unit} />
      </Panel>
      )}

      <Panel>
        <SectionTitle>Weekly volume</SectionTitle>
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={volume} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
            <CartesianGrid stroke={CHART.grid} vertical={false} />
            <XAxis dataKey="week" tick={CHART.tick} tickLine={false} axisLine={false} interval={1} />
            <YAxis tick={CHART.tick} tickLine={false} axisLine={false} tickFormatter={formatVolume} />
            <Tooltip contentStyle={CHART.tooltip} formatter={(v) => [`${v} ${unit}`, "Volume"]} />
            <Bar dataKey="volume" fill={CHART.accent} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Panel>

      {bestLifts.length > 0 && (
      <Panel>
        <SectionTitle>Best lifts</SectionTitle>
        <ul className="divide-y divide-zinc-200">
          {bestLifts.map(([name, record]) => (
            <li key={name} className="flex items-center justify-between gap-3 py-2">
              <span className="text-zinc-800">{name}</span>
              <span className="text-right">
                <span className="font-semibold text-zinc-900 tabular-nums">{record.e1rm ? `${record.e1rm} ${unit}` : `${record.set.reps} reps`}</span>
                <span className="block text-xs text-zinc-500">
                  {record.set.weight || "BW"}×{record.set.reps} on {formatShortDate(record.date)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </Panel>
      )}
    </div>
  );
}
