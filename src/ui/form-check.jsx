import { useState } from "react";
import { FRAME_COUNT } from "../config.js";
import { FORM_PROMPT } from "../prompts.js";
import { askAI } from "../ai.js";
import { filesToMedia } from "../media.js";
import { formatDate, today } from "../dates.js";
import { normalizeName, guideFor } from "../training.js";
import { ErrorText, Field, FilePicker, Panel, PrimaryButton, RichText, SectionTitle, ViewTitle, inputClass } from "./primitives.jsx";
import { VideoGuides } from "./videos.jsx";

export function FormCheckView({ profileNotes, formChecks, setFormChecks }) {
  const [exercise, setExercise] = useState("");
  const [focus, setFocus] = useState("");
  const [media, setMedia] = useState(null); // { kind: "video" | "photos", frames: base64[] }
  const [feedback, setFeedback] = useState("");
  const [status, setStatus] = useState("idle"); // idle | reading | analyzing
  const [error, setError] = useState("");

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
      `Exercise: ${exercise.trim() || "not specified, identify it"}.`,
      media.kind === "video" && `These ${media.frames.length} frames are sampled evenly from one set, in order.`,
      focus.trim() && `The athlete wants you to look at: ${focus.trim()}`,
      profileNotes && `Athlete background: ${profileNotes}`,
    ]
      .filter(Boolean)
      .join("\n");
    try {
      const result = await askAI(FORM_PROMPT, [{ role: "user", content: request, images: media.frames }]);
      setFeedback(result);
      const check = { id: crypto.randomUUID(), date: today(), exercise: normalizeName(exercise) || "Unnamed lift", feedback: result };
      setFormChecks((all) => [check, ...all].slice(0, 30));
    } catch (err) {
      setError(err.message);
    } finally {
      setStatus("idle");
    }
  }

  return (
    <div className="space-y-4">
      <ViewTitle>Form check</ViewTitle>

      <Panel className="space-y-4">
        <Field label="Exercise">
          <input list="exercise-names" value={exercise} onChange={(e) => setExercise(e.target.value)} placeholder="Back Squat" className={inputClass} />
        </Field>
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
              <img key={i} src={`data:image/jpeg;base64,${frame}`} alt={`Frame ${i + 1}`} className="w-full h-28 object-cover rounded-lg" />
            ))}
          </div>
        )}

        <PrimaryButton onClick={analyze} busy={status === "analyzing"} disabled={!media || status !== "idle"}>
          Check my form
        </PrimaryButton>
        <ErrorText message={error} />
      </Panel>

      {feedback && (
        <Panel className="text-zinc-700">
          <RichText text={feedback} />
        </Panel>
      )}
      {feedback && exercise.trim() && guideFor(exercise) && <VideoGuides guide={guideFor(exercise)} />}

      {formChecks.length > 0 && (
        <Panel>
          <SectionTitle>Past checks</SectionTitle>
          <div className="divide-y divide-zinc-200">
            {formChecks.map((check) => (
              <details key={check.id} className="py-3">
                <summary className="flex justify-between cursor-pointer list-none">
                  <span className="font-semibold text-zinc-900">{check.exercise}</span>
                  <span className="text-sm text-zinc-500">{formatDate(check.date)}</span>
                </summary>
                <div className="mt-2 text-sm text-zinc-700">
                  <RichText text={check.feedback} />
                </div>
              </details>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}
