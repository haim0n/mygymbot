import { useState, useLayoutEffect, useRef } from "react";
import { Send, Loader2 } from "lucide-react";
import { CHAT_CONTEXT_SIZE, CHAT_HISTORY_SIZE, QUICK_PROMPTS } from "../config.js";
import { COACH_PROMPT, ONBOARDING_GREETING } from "../prompts.js";
import { askAI, recentTurns } from "../ai.js";
import { ErrorText, RichText, ViewTitle, inputClass } from "./primitives.jsx";
import { TodayCard } from "./motivation.jsx";

export function CoachView({ chat, setChat, context, briefing, newAthlete, onNavigate, onSaveRoutine, onSaveProfile, onOpenImport, onRemember }) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [todayOpen, setTodayOpen] = useState(false);
  const paneRef = useRef(null);
  const followNew = useRef(true); // false while the athlete has scrolled back to read
  // A new athlete's chat opens with the coach's first question, kept in the chat once they answer.
  const shown = newAthlete && chat.length === 0 ? [{ role: "assistant", content: ONBOARDING_GREETING }] : chat;

  // Like a messaging app: open at the latest message and follow new ones, unless the athlete scrolled back.
  // Watching sizes, not messages, also catches fonts loading, the Today card opening and the rest bar.
  // A layout effect, so the first paint already shows the bottom.
  useLayoutEffect(() => {
    const pane = paneRef.current;
    const observer = new ResizeObserver(() => {
      if (followNew.current) pane.scrollTop = pane.scrollHeight;
    });
    observer.observe(pane);
    observer.observe(pane.firstElementChild);
    return () => observer.disconnect();
  }, []);

  function onScroll() {
    const pane = paneRef.current;
    followNew.current = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 40;
  }

  async function send(text) {
    const content = text.trim();
    if (!content || busy) return;
    const conversation = [...shown, { role: "user", content }];
    followNew.current = true;
    setChat(conversation);
    setInput("");
    setBusy(true);
    setError("");
    try {
      const reply = await askAI(`${COACH_PROMPT}\n\n${context}`, recentTurns(conversation, CHAT_CONTEXT_SIZE));
      setChat([...conversation, { role: "assistant", content: reply }].slice(-CHAT_HISTORY_SIZE)); // may start with the coach; requests trim to a user turn
      onRemember(reply);
    } catch (err) {
      setChat(chat); // roll back the unanswered question…
      setInput(content); // …so it can be sent again
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const clearButton = chat.length > 0 && (
    <button onClick={() => setChat([])} className="text-sm text-zinc-500">
      Clear chat
    </button>
  );

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <ViewTitle action={clearButton}>Coach</ViewTitle>
      <TodayCard facts={briefing.facts} note={briefing.note} open={todayOpen} onToggle={() => setTodayOpen((o) => !o)} onNavigate={onNavigate} />
      {shown.length === 0 && (
        <p className="text-zinc-600 mb-4">Ask anything about your training. Your coach sees your goals, profile and recent workouts.</p>
      )}

      <div ref={paneRef} onScroll={onScroll} className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
        <div className="space-y-3 pb-3">
          {shown.map((message, i) =>
            message.role === "user" ? (
              <div key={i} className="flex justify-end">
                <p className="max-w-xs rounded-2xl rounded-br-md bg-blue-700 text-white px-4 py-2.5">{message.content}</p>
              </div>
            ) : (
              <div key={i} className="rounded-2xl rounded-bl-md bg-white px-4 py-3 text-zinc-700">
                <RichText text={message.content} onSaveRoutine={onSaveRoutine} onSaveProfile={onSaveProfile} onOpenImport={onOpenImport} />
              </div>
            )
          )}
          {busy && (
            <div className="flex items-center gap-2 text-sm text-zinc-500">
              <Loader2 className="w-4 h-4 animate-spin" /> Thinking
            </div>
          )}
          <ErrorText message={error} />
        </div>
      </div>

      <div className="-mx-4 border-t border-zinc-200">
        <div className="px-4 pt-2 pb-3">
          {!newAthlete && <div className="flex gap-2 overflow-x-auto pb-2">
            {QUICK_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                onClick={() => send(prompt)}
                disabled={busy}
                className="shrink-0 rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-700 disabled:opacity-40"
              >
                {prompt}
              </button>
            ))}
          </div>}
          <div className="flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send(input)}
              onFocus={() => setTodayOpen(false)} // the keyboard needs the room
              placeholder="Message your coach"
              className={inputClass}
            />
            <button
              onClick={() => send(input)}
              disabled={busy || !input.trim()}
              aria-label="Send"
              className="rounded-lg bg-blue-700 text-white px-3 disabled:opacity-40"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
