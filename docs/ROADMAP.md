# Roadmap

## Now: dogfooding with friends (claude.ai artifact)

1. **Feedback button.** Note: artifact *shared* storage is visible to every user, so either keep feedback non-sensitive or send people to an external form.
2. Watch AI usage: coach, form checks, check-ins and the daily note count against each friend's own Claude plan; free plans hit limits sooner. Everything else is plain code.

## Next: make the codebase easier to grow

1. Split `src/gymbot.jsx` into modules (`domain/`, `ui/`, `config/`) with a build step that inlines them back into one artifact file, so claude.ai dogfooding keeps working.
2. Make activities editable; convert stored weights when the unit setting changes.
3. Grow the unit tests along with the domain code.

## Later: standalone app (global launch)

- **Backend**: Python (FastAPI) + Postgres; analytics and forecasts in Polars. Anthropic API called server-side with your key; per-user rate limits.
- **Client**: keep React (PWA first; React Native if app-store presence matters). The pure domain functions port over unchanged.
- **Accounts, payments, privacy**: auth; Stripe or app-store billing; privacy policy, consent and data deletion (pain, injuries and bodyweight are health-related data); "not medical advice" notice.
- **Real notifications** for pre-workout motivation and check-ins (push or calendar).
- **Exercise illustrations**: license a commercial library if wanted.

## Monetization notes

- **Freemium**: everything that runs as plain code is free to run (logging, Autopilot, forecasts, timer, muscle maps, import); everything that calls the AI costs money per use (coach chat, form checks, check-ins, food advice, daily note) → subscription tier. A subscription matches a recurring cost better than a one-time price.
- **Trainers (B2B)**: a dashboard of clients' workouts, check-ins and forecasts, priced per client.
- Inside claude.ai the app can be shared for free but not sold.
