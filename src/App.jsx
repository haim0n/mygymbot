import { useState, useMemo, useEffect, useLayoutEffect, useRef } from "react";
import { MessageCircle, Dumbbell, Video, TrendingUp, Target, Loader2 } from "lucide-react";
import { DEFAULT_SETTINGS, GLOBAL_CSS, STORAGE_KEYS } from "./config.js";
import { usePersistentState, useSaveProblem } from "./storage.js";
import { today } from "./dates.js";
import { exercisesByFrequency, logBodyweight, personalRecords } from "./training.js";
import { buildAutopilotPlans } from "./autopilot.js";
import { todayFacts } from "./motivation.js";
import { feelResult, nextSet, rateSet, saveRoutine } from "./workout.js";
import { buildCoachContext, isNewAthlete, rememberFacts } from "./coach-context.js";
import { useDailyNote } from "./ui/motivation.jsx";
import { useInjuryAreas, useLearnedMuscles } from "./ui/muscles.jsx";
import { ExerciseContext, ExerciseSheet, useLearnedPhotos } from "./ui/exercises.jsx";
import { CoachView } from "./ui/coach.jsx";
import { LogView } from "./ui/log.jsx";
import { FormCheckView } from "./ui/form-check.jsx";
import { ProgressView } from "./ui/progress.jsx";
import { GoalsView } from "./ui/goals.jsx";
import { RestTimerBar, useRestFun, useRestNote, useRestTimer } from "./ui/rest-timer.jsx";

export const TABS = [
  { id: "coach", label: "Coach", Icon: MessageCircle },
  { id: "log", label: "Log", Icon: Dumbbell },
  { id: "form", label: "Form", Icon: Video },
  { id: "progress", label: "Progress", Icon: TrendingUp },
  { id: "goals", label: "Goals", Icon: Target },
];

export function BottomNav({ tab, onSelect, workoutInProgress }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 h-16 bg-white border-t border-zinc-200">
      <div className="max-w-md mx-auto h-full grid grid-cols-5">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => onSelect(id)}
            aria-current={tab === id ? "page" : undefined}
            className={`relative flex flex-col items-center justify-center gap-0.5 text-xs ${tab === id ? "text-blue-700 font-semibold" : "text-zinc-500"}`}
          >
            <Icon className="w-5 h-5" />
            {label}
            {id === "log" && workoutInProgress && (
              <>
                <span className="absolute top-2 right-1/4 h-2.5 w-2.5 rounded-full bg-blue-700" />
                <span className="sr-only">, workout in progress</span>
              </>
            )}
          </button>
        ))}
      </div>
    </nav>
  );
}

export default function GymBot() {
  const [tab, setTab] = useState("coach");
  const restTimer = useRestTimer();
  const [detailsFor, setDetailsFor] = useState(null); // exercise shown in the details sheet
  const [showImport, setShowImport] = useState(false); // Import history open in Log; the coach can open it
  const [workouts, setWorkouts, workoutsLoaded] = usePersistentState(STORAGE_KEYS.workouts, []);
  const [settings, setSettings, settingsLoaded] = usePersistentState(STORAGE_KEYS.settings, DEFAULT_SETTINGS);
  const [chat, setChat, chatLoaded] = usePersistentState(STORAGE_KEYS.chat, []);
  const [formChecks, setFormChecks, formChecksLoaded] = usePersistentState(STORAGE_KEYS.formChecks, []);
  const [session, setSession, sessionLoaded] = usePersistentState(STORAGE_KEYS.session, null); // workout in progress
  const [bodyweightLog, setBodyweightLog, bodyweightLoaded] = usePersistentState(STORAGE_KEYS.bodyweight, []);

  const records = useMemo(() => personalRecords(workouts), [workouts]);
  const exerciseNames = useMemo(() => exercisesByFrequency(workouts), [workouts]);

  const setRepRange = (name, range) => setSettings((s) => ({ ...s, repRanges: { ...s.repRanges, [name]: range } }));
  const storeRoutine = (routine) => setSettings((s) => ({ ...s, routines: saveRoutine(s.routines ?? [], routine) }));
  const storeProfile = (fields) => setSettings((s) => ({ ...s, profile: { ...s.profile, ...fields } }));
  const remember = (reply) =>
    setSettings((s) => {
      const facts = s.coachMemory ?? [];
      const updated = rememberFacts(facts, reply, today());
      return updated === facts ? s : { ...s, coachMemory: updated };
    });
  const openImport = () => {
    setShowImport(true);
    setTab("log");
  };
  const deleteRoutine = (name) => setSettings((s) => ({ ...s, routines: (s.routines ?? []).filter((r) => r.name !== name) }));

  const saveProblem = useSaveProblem();
  const loaded = workoutsLoaded && settingsLoaded && chatLoaded && formChecksLoaded && sessionLoaded && bodyweightLoaded;
  // Exercises in saved plans and the workout in progress count too: a new user's first plan has no history yet.
  const namesInUse = useMemo(
    () => [...new Set([...exerciseNames, ...(settings.routines ?? []).flatMap((r) => r.exercises), ...(session?.exercises ?? []).map((e) => e.name)])],
    [exerciseNames, settings.routines, session]
  );
  const learnedMuscles = useLearnedMuscles({ enabled: loaded, exerciseNames: namesInUse });
  const learnedPhotos = useLearnedPhotos({ enabled: loaded, exerciseNames: namesInUse });
  useInjuryAreas({ enabled: loaded, settings, setSettings });
  const plans = useMemo(() => buildAutopilotPlans(workouts, settings, learnedMuscles), [workouts, settings, learnedMuscles]);
  const exerciseContext = useMemo(() => ({ learnedMuscles, learnedPhotos, showDetails: setDetailsFor }), [learnedMuscles, learnedPhotos]);
  const coachContext = useMemo(
    () => buildCoachContext(settings, workouts, plans, learnedMuscles, session, bodyweightLog),
    [settings, workouts, plans, learnedMuscles, session, bodyweightLog]
  );
  const facts = useMemo(() => todayFacts({ workouts, settings, records, plans }), [workouts, settings, records, plans]);
  const coachStyle = settings.profile.coachStyle ?? DEFAULT_SETTINGS.profile.coachStyle;
  const dailyNote = useDailyNote({ enabled: loaded && workouts.length > 0, facts, context: coachContext, style: coachStyle });
  const { unit, daysPerWeek, notes } = settings.profile;
  const restNote = useRestNote({ rest: restTimer.rest, session, setSession, context: coachContext, chat });
  const rest = restTimer.rest;
  const restFun = useRestFun({ rest, session, setSession, settings });
  const restExercise = rest && session?.exercises.find((e) => e.id === rest.exerciseId);
  const ratedSet = restExercise?.sets.find((set) => set.id === rest.setId && set.done);
  const [restBarHeight, setRestBarHeight] = useState(112);
  const feelPrompt = ratedSet && {
    setId: ratedSet.id,
    result: feelResult(restExercise, ratedSet, unit),
    onRate: (feel) => setSession((s) => s && rateSet(s, rest.exerciseId, rest.setId, feel, unit)),
    barHeight: restBarHeight, // when the coach's note makes the bar taller, the row checks it is still in sight
  };
  // The page starts below the rest bar. When the bar comes, goes or grows, the page scrolls by as much, so the set you just
  // ticked stays under your finger instead of jumping. Near the top there is no room to scroll back when the bar goes, so
  // the page eases up with the bar instead. The scroll position is read before the padding changes, as the browser clamps it.
  const mainPaddingTop = rest ? restBarHeight + 24 : 24;
  const previousPaddingTop = useRef(mainPaddingTop);
  const scrollBefore = useRef(0);
  const easePadding = useRef(false); // kept until the next change, so a render mid-way doesn't cut the easing short
  const paddingChange = mainPaddingTop - previousPaddingTop.current;
  if (paddingChange) {
    scrollBefore.current = window.scrollY;
    easePadding.current = paddingChange < 0 && scrollBefore.current < -paddingChange;
  }
  const [openedAt] = useState(Date.now());
  const restoredRest = rest && rest.startedAt < openedAt; // after a reload nobody's finger is on a set: the page just starts below the bar
  useLayoutEffect(() => {
    const change = mainPaddingTop - previousPaddingTop.current;
    previousPaddingTop.current = mainPaddingTop;
    if (change && !easePadding.current && !restoredRest) window.scrollTo(0, scrollBefore.current + change);
  }, [mainPaddingTop]);
  // A rest after a set ends with its workout (finished or discarded), also when that happened before a reload.
  useEffect(() => {
    if (sessionLoaded && !session && rest?.exerciseId) restTimer.stop();
  }, [sessionLoaded, session, rest]);
  // Scrolling to a card (scrollIntoView) keeps it clear of the rest bar on top and the tab bar below.
  useEffect(() => {
    document.documentElement.style.scrollPaddingTop = rest ? `${restBarHeight + 8}px` : "";
    document.documentElement.style.scrollPaddingBottom = "64px";
    document.documentElement.style.overflowAnchor = "none"; // the page is kept still by hand (above); the browser's anchoring fought it
  }, [Boolean(rest), restBarHeight]);
  // Opening the app mid-workout goes straight to it.
  useEffect(() => {
    if (sessionLoaded && session) setTab("log");
  }, [sessionLoaded]);
  // Replying puts the note in the coach chat, so the conversation carries on from it.
  const replyToRestNote = () => {
    setChat((messages) => [...messages, { role: "assistant", content: restNote }]);
    setTab("coach");
  };

  const bodyweight = { log: bodyweightLog, profile: settings.profile, onLog: (weight) => setBodyweightLog((log) => logBodyweight(log, today(), weight)) };
  const views = {
    coach: <CoachView chat={chat} setChat={setChat} context={coachContext} briefing={{ facts, note: dailyNote }} newAthlete={isNewAthlete(settings, workouts)} onNavigate={setTab} onSaveRoutine={storeRoutine} onSaveProfile={storeProfile} onOpenImport={openImport} onRemember={remember} />,
    log: (
      <LogView workouts={workouts} setWorkouts={setWorkouts} session={session} setSession={setSession} settings={settings} coachContext={coachContext} plans={plans} yourExercises={namesInUse} learnedMuscles={learnedMuscles} onRangeChange={setRepRange} onStartRest={restTimer.start} feelPrompt={feelPrompt} onSaveRoutine={storeRoutine} onDeleteRoutine={deleteRoutine} showImport={showImport} setShowImport={setShowImport} bodyweight={bodyweight} unit={unit} />
    ),
    form: <FormCheckView profileNotes={notes} formChecks={formChecks} setFormChecks={setFormChecks} />,
    progress: <ProgressView workouts={workouts} records={records} exerciseNames={exerciseNames} learnedMuscles={learnedMuscles} unit={unit} daysPerWeek={daysPerWeek} onNavigate={setTab}
        bodyweight={bodyweight} />,
    goals: <GoalsView settings={settings} setSettings={setSettings} records={records} workouts={workouts} />,
  };

  return (
    <ExerciseContext.Provider value={exerciseContext}>
      <div className="gb-root min-h-dvh bg-zinc-100 text-zinc-800">
        <style>{GLOBAL_CSS}</style>
        <datalist id="exercise-names">
          {exerciseNames.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>

        {loaded ? (
          <>
            <RestTimerBar
              timer={restTimer}
              next={rest && session ? nextSet(session, rest.exerciseId) : null}
              unit={unit}
              note={restNote}
              fun={restFun}
              onReply={replyToRestNote}
              onQuiet={() => setSession((s) => s && { ...s, coachQuiet: true })}
              onHeight={setRestBarHeight}
            />
            <main className={`max-w-md mx-auto px-4 ${tab === "coach" ? "h-dvh flex flex-col pb-16" : "pb-24"} ${easePadding.current ? "gb-ease-padding" : ""}`} style={{ paddingTop: mainPaddingTop }}>
              {views[tab]}
            </main>
            {saveProblem && (
              <p role="status" className="fixed inset-x-0 top-2 z-50 mx-auto w-fit rounded-full bg-amber-100 px-3 py-1 text-sm text-amber-900 shadow">
                {saveProblem === "refused" ? "Not saved. Reload the app." : "Not saved yet, trying again. Keep the app open."}
              </p>
            )}
            <BottomNav tab={tab} onSelect={setTab} workoutInProgress={Boolean(session)} />
            {detailsFor && <ExerciseSheet name={detailsFor} onClose={() => setDetailsFor(null)} />}
          </>
        ) : (
          <div className="min-h-screen flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
          </div>
        )}
      </div>
    </ExerciseContext.Provider>
  );
}
