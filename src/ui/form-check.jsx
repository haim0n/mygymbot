import { useState } from "react";
import { FRAME_COUNT } from "../config.js";
import { FORM_PROMPT } from "../prompts.js";
import { askAI } from "../ai.js";
import { filesToMedia } from "../media.js";
import { formatDate, today } from "../dates.js";
import { normalizeName } from "../training.js";
import { ErrorText, Field, FilePicker, PrimaryButton, RichText, inputClass } from "./primitives.jsx";

// Form check for one exercise, in its details sheet: folded until asked for, with that exercise's past checks.
export function FormCheck({ exercise, profileNotes, formChecks, setFormChecks }) {
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState("");
  const [media, setMedia] = useState(null); // { kind: "video" | "photos", frames: base64[] }
  const [feedback, setFeedback] = useState("");
  const [status, setStatus] = useState("idle"); // idle | reading | analyzing
  const [error, setError] = useState("");
  const past = formChecks.filter((check) => check.exercise === normalizeName(exercise));

  async function handleFiles(files) {
    setStatus("reading");
    setError("");
    setFeedback("");
    setMedia(null);
    try {
      setMedia(await filesToMedia(files));
    } catch (err) {
      setError(err.message);
    } finally {
      setStatus("idle");
    }
  }

  async function analyze() {
    setStatus("analyzing");
    setError("");
    const request = [
      `Exercise: ${exercise}.`,
      media.kind === "video" && `These ${media.frames.length} frames are sampled evenly from one set, in order.`,
      focus.trim() && `The athlete wants you to look at: ${focus.trim()}`,
      profileNotes && `Athlete background: ${profileNotes}`,
    ]
      .filter(Boolean)
      .join("\n");
    try {
      const result = await askAI(FORM_PROMPT, [{ role: "user", content: request, images: media.frames }]);
      setFeedback(result);
      setFormChecks((all) => [{ id: crypto.randomUUID(), date: today(), exercise: normalizeName(exercise), feedback: result }, ...all].slice(0, 30));
    } catch (err) {
      setError(err.message);
    } finally {
      setStatus("idle");
    }
  }

  return (
    <section className="mt-4 space-y-3">
      {open ? (
        <div className="gb-fade space-y-3 rounded-2xl bg-zinc-50 p-3">
          <h3 className="font-semibold text-zinc-900">Check my form</h3>
          <Field label="Anything to focus on? (optional)">
            <input value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="Knees cave on the way up" className={inputClass} />
          </Field>
          <FilePicker
            accept="video/*,image/*"
            busy={status === "reading"}
            title={media ? "Choose a different file" : "Upload a video or photos"}
            hint={`Film from the side with your whole body in frame. Videos stay on your phone; only ${FRAME_COUNT} still frames are sent.`}
            onFiles={handleFiles}
          />
          {media && (
            <div className="grid grid-cols-3 gap-2">
              {media.frames.map((frame, i) => (
                <img key={i} src={`data:image/jpeg;base64,${frame}`} alt={`Frame ${i + 1}`} className="h-28 w-full rounded-lg object-cover" />
              ))}
            </div>
          )}
          <PrimaryButton onClick={analyze} busy={status === "analyzing"} disabled={!media || status !== "idle"}>
            Check my form
          </PrimaryButton>
          <ErrorText message={error} />
          {feedback && (
            <div className="text-zinc-700">
              <RichText text={feedback} />
            </div>
          )}
        </div>
      ) : (
        <button onClick={() => setOpen(true)} className="h-11 w-full rounded-lg border border-zinc-300 font-semibold text-zinc-800">
          Check my form
        </button>
      )}

      {past.length > 0 && (
        <div>
          <h3 className="font-semibold text-zinc-900">Past form checks</h3>
          <div className="divide-y divide-zinc-200">
            {past.map((check) => (
              <details key={check.id} className="py-2">
                <summary className="flex min-h-10 cursor-pointer list-none items-center text-sm text-zinc-600 [&::-webkit-details-marker]:hidden">{formatDate(check.date)}</summary>
                <div className="mt-1 text-sm text-zinc-700">
                  <RichText text={check.feedback} />
                </div>
              </details>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
