import { useEffect, useRef, useState } from "react";
import { TOUR_STEPS } from "../config.js";
import { reducedMotion, useBackToClose } from "./primitives.jsx";

// The first-time tour: the app dims except one tab, and a card above that tab says what it's for. The tab behind is the
// step's (App switches it), so the screen shows what the card describes. Android's Back skips it, like Skip.
export function Tour({ step, onNext, onClose }) {
  const [leaving, setLeaving] = useState(false);
  const nextRef = useRef(null);
  const { title, text } = TOUR_STEPS[step];
  const last = step === TOUR_STEPS.length - 1;
  const leave = () => {
    if (leaving) return; // a second tap while it fades would land on the app behind
    reducedMotion() ? onClose() : setLeaving(true);
  };
  useBackToClose(leave);
  useEffect(() => {
    nextRef.current.focus({ preventScroll: true });
  }, [step]);
  const dim = "bg-black/60";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="tour-title"
      onAnimationEnd={(event) => leaving && event.target === event.currentTarget && onClose()}
      className={`fixed inset-0 z-40 flex flex-col ${leaving ? "gb-fade-out" : "gb-fade"}`}
    >
      <div className={`relative flex-1 ${dim}`}>
        <div className="absolute inset-x-0 bottom-3 mx-auto max-w-md px-4">
          <div key={step} className="gb-rise relative rounded-2xl bg-white p-4 shadow-xl">
            <h2 id="tour-title" className="gb-display text-2xl font-bold text-zinc-900">{title}</h2>
            <p className="mt-1 text-zinc-700">{text}</p>
            <div className="mt-3 flex items-center gap-3">
              <span className="text-sm tabular-nums text-zinc-500">
                {step + 1} of {TOUR_STEPS.length}
              </span>
              {!last && (
                <button onClick={leave} className="gb-tap ml-auto text-sm font-semibold text-zinc-500">
                  Skip
                </button>
              )}
              <button ref={nextRef} onClick={last ? leave : onNext} className={`h-10 rounded-lg bg-blue-700 px-5 font-semibold text-white ${last ? "ml-auto" : ""}`}>
                {last ? "Get started" : "Next"}
              </button>
            </div>
          </div>
          {/* points down at the step's tab: the row is as wide as the tab bar, each tab a fifth */}
          <span
            aria-hidden="true"
            className="absolute -bottom-2 h-4 w-4 -translate-x-1/2 rotate-45 bg-white"
            style={{ left: `${((step + 0.5) / TOUR_STEPS.length) * 100}%` }}
          />
        </div>
      </div>
      {/* the tab bar's row: dim every tab but the step's */}
      <div className="flex h-16">
        <div className={`flex-1 ${dim}`} />
        <div className="grid w-full max-w-md grid-cols-5">
          {TOUR_STEPS.map((s, i) => (
            <div key={s.tab} className={i === step ? "rounded-t-lg ring-2 ring-inset ring-white/80" : dim} />
          ))}
        </div>
        <div className={`flex-1 ${dim}`} />
      </div>
    </div>
  );
}

// The first-workout tour: a card on one part of the live workout (`target`, a CSS selector), the rest dimmed. Next goes through
// the steps of this moment; Skip (or Android's Back) ends the whole tour. It measures the target every 300 ms, because the rest
// bar grows when the coach's note comes, and the set feel row scrolls into view.
export function SpotTour({ steps, onClose, onSkip }) {
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState(null);
  const [leaving, setLeaving] = useState(null); // what to do once the card has faded out
  const step = steps[index];
  const last = index === steps.length - 1;
  const leave = (then) => {
    if (leaving) return; // a second tap while it fades would land on the workout behind
    reducedMotion() ? then() : setLeaving(() => then);
  };
  useBackToClose(() => leave(onSkip));
  useEffect(() => {
    const sameBox = (a, b) => a?.top === b?.top && a?.left === b?.left && a?.width === b?.width && a?.height === b?.height;
    const measure = () => {
      const target = document.querySelector(step.target)?.getBoundingClientRect() ?? null;
      setBox((old) => (sameBox(old, target) ? old : target)); // no new render while nothing moved
    };
    const timer = setInterval(measure, 300);
    return () => clearInterval(timer);
  }, [index]);
  if (!box) return null;
  const pad = box.width >= innerWidth ? 0 : 6; // a full-width target (the rest bar) leaves no band undimmed
  const below = box.top + box.height / 2 < innerHeight / 2;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="spot-title"
      onAnimationEnd={(event) => leaving && event.target === event.currentTarget && leaving()}
      className={`fixed inset-0 z-30 ${leaving ? "gb-fade-out" : "gb-fade"}`}
    >
      <div
        className="absolute rounded-2xl ring-2 ring-white/80"
        style={{ left: box.left - pad, top: box.top - pad, width: box.width + 2 * pad, height: box.height + 2 * pad, boxShadow: "0 0 0 9999px rgba(0,0,0,0.6)" }}
      />
      <div className="absolute inset-x-0 mx-auto max-w-md px-4" style={below ? { top: box.bottom + pad + 12 } : { bottom: innerHeight - box.top + pad + 12 }}>
        <div key={index} className="gb-rise rounded-2xl bg-white p-4 shadow-xl">
          <h2 id="spot-title" className="gb-display text-2xl font-bold text-zinc-900">{step.title}</h2>
          <p className="mt-1 text-zinc-700">{step.text}</p>
          <div className="mt-3 flex items-center gap-3">
            {steps.length > 1 && (
              <span className="text-sm tabular-nums text-zinc-500">
                {index + 1} of {steps.length}
              </span>
            )}
            {!last && (
              <button onClick={() => leave(onSkip)} className="gb-tap ml-auto text-sm font-semibold text-zinc-500">
                Skip
              </button>
            )}
            <button onClick={last ? () => leave(onClose) : () => setIndex(index + 1)} className={`h-10 rounded-lg bg-blue-700 px-5 font-semibold text-white ${last ? "ml-auto" : ""}`}>
              {last ? "Got it" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
