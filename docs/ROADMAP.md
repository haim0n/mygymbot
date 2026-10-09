# Roadmap

## Now: production grade (dogfooding with friends on Cloud Run, IAP allowlist)

Safe data and safe costs first, then the checks that protect every later change.

1. Saves are never lost when the connection drops (#13).
2. A daily AI limit per user, request size limits, and a usage log with token counts (#14).
3. GCP budget alert (#19, Haim).
4. Tests in GitHub Actions on every push (#15). App errors reported to the server log (#16).
5. Feedback button (#17). "Not medical advice" notice (#18).

## Next: make the codebase easier to grow

1. Make activities editable; convert stored weights when the unit setting changes.
2. Grow the unit tests along with the domain code.

## Then: open the door to strangers

1. Self-serve sign-up instead of the IAP access list (#20).
2. Privacy policy, consent and account deletion; pain, injuries and bodyweight are health data (#21).
3. A test copy of the service and an uptime check (#28).

## Then: charge

1. Free and paid tiers, priced from the measured cost per user (#23).
2. Payments: a merchant of record or Stripe; needs a registered business (#24).
3. Play Store listing as a Trusted Web Activity (#25); decide billing rules before the payment provider.

## Then: keep people

- The coach as the main feature: it sets things up, talks, and changes plans itself (#12, #6).
- Workout reminders as web push, with a service worker that doesn't cache the app's files (#26).
- Health Connect import, after a native or TWA shell exists (#27).
- Full offline use: unsaved changes kept on the phone, not only in memory (after #13).

## Later

- **Storage** that scales past one instance: Firestore or Postgres, when users approach that limit (#22). Analytics and forecasts in Polars.
- **Client**: keep React (PWA first; React Native if app-store presence needs more than a TWA). The pure domain functions port over unchanged.
- **Exercise illustrations**: the photos are public domain with busy gym backgrounds; license a commercial illustration library for a cleaner look if wanted.

## Monetization notes

- **Freemium**: everything that runs as plain code is free to run (logging, Autopilot, forecasts, timer, muscle maps, import); everything that calls the AI costs money per use (coach chat, form checks, check-ins, food advice, daily note) → subscription tier. A subscription matches a recurring cost better than a one-time price.
- **Trainers (B2B)**: a dashboard of clients' workouts, check-ins and forecasts, priced per client.
