---
description: Commit the current changes and push them to GitHub
argument-hint: "[optional note for the commit message]"
allowed-tools: Bash(git *), Bash(npm test), Bash(npm run test*)
---

Haim ran /push: that is his OK to commit and push the current changes. Extra notes for the message: $ARGUMENTS

1. Run `git status` and `git diff` (staged and unstaged) to see what changed. If nothing changed, say so and stop.
2. If any file under `src/`, `server/` or `tests/` changed and `npm run test:all` hasn't passed since the last change, run it. If it fails, stop and report the failure without committing.
3. Don't commit secrets (`.env`, keys, credentials) or anything from `data/`; if one shows up, stop and ask.
4. Commit following CLAUDE.md: one commit per logical step (split the changes if they are unrelated), a short subject line, and a body listing what changed. Add `(Fixes #N)` when the changes complete GitHub issue N. No attribution lines.
5. Push to the current branch's upstream. Redact credentials in any git output with `sed -E 's#://[^@]*@#://<credentials>@#'`.
6. Report the commit hash(es) and subject(s), and whether an issue was closed. Don't deploy.
