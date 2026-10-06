import { useState, useEffect, useRef } from "react";
import { Send, Loader2 } from "lucide-react";
import { CHAT_CONTEXT_SIZE, CHAT_HISTORY_SIZE, QUICK_PROMPTS } from "../config.js";
import { COACH_PROMPT } from "../prompts.js";
import { askAI, recentTurns } from "../ai.js";
import { ErrorText, RichText, ViewTitle, inputClass } from "./primitives.jsx";
import { TodayCard } from "./motivation.jsx";

export function CoachView({ chat, setChat, context, briefing, onNavigate, onSaveRoutine }) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef(null);

  const hasMounted = useRef(false);

  // Follow new messages, but open at the top so the Today card is the first thing you see.
  useEffect(() => {
    if (hasMounted.current) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    hasMounted.current = true;
  }, [chat.length, busy]);

  async function send(text) {
    const content = text.trim();
    if (!content || busy) return;
    const conversation = [...chat, { role: "user", content }];
    setChat(conversation);
    setInput("");
    setBusy(true);
    setError("");
    try {
      const reply = await askAI(`${COACH_PROMPT}\n\n${context}`, recentTurns(conversation, CHAT_CONTEXT_SIZE));
      setChat(recentTurns([...conversation, { role: "assistant", content: reply }], CHAT_HISTORY_SIZE));
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
    <div>
      <ViewTitle action={clearButton}>Coach</ViewTitle>
      <TodayCard facts={briefing.facts} note={briefing.note} onNavigate={onNavigate} />
      {chat.length === 0 && (
        <p className="text-zinc-600 mb-4">Ask anything about your training. Your coach sees your goals, profile and recent workouts.</p>
      )}

      <div className="space-y-3 pb-36">
        {chat.map((message, i) =>
          message.role === "user" ? (
            <div key={i} className="flex justify-end">
              <p className="max-w-xs rounded-2xl rounded-br-md bg-blue-700 text-white px-4 py-2.5">{message.content}</p>
            </div>
          ) : (
            <div key={i} className="rounded-2xl rounded-bl-md bg-white px-4 py-3 text-zinc-700">
              <RichText text={message.content} onSaveRoutine={onSaveRoutine} />
            </div>
          )
        )}
        {busy && (
          <div className="flex items-center gap-2 text-sm text-zinc-500">
            <Loader2 className="w-4 h-4 animate-spin" /> Thinking
          </div>
        )}
        <ErrorText message={error} />
        <div ref={bottomRef} />
      </div>

      <div className="fixed inset-x-0 bottom-16 bg-zinc-100 border-t border-zinc-200">
        <div className="max-w-md mx-auto px-4 pt-2 pb-3">
          <div className="flex gap-2 overflow-x-auto pb-2">
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
          </div>
          <div className="flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send(input)}
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
