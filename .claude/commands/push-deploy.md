---
description: Commit and push the current changes, then deploy to Cloud Run
argument-hint: "[optional note for the commit message]"
allowed-tools: Bash(git *), Bash(npm test), Bash(npm run *), Bash(gcloud *), Bash(curl *)
---

Haim ran /push-deploy: that is his OK to commit, push and deploy. Extra notes for the message: $ARGUMENTS

1. Commit and push exactly as in `.claude/commands/push.md` (steps 1 to 5). If there is nothing to commit, carry on with what is already pushed. Stop on any failure.
2. Before deploying, make sure `npm run test:all` has passed on the commit being shipped; run it if not.
3. Find the commit that is live: `gcloud run services describe mygymbot --project=mygymbot --region=me-west1 --format='value(spec.template.spec.containers[0].env)'` (the `GYMBOT_COMMIT` value). If it equals HEAD, say so and don't redeploy. If `src/` changed since that commit but `APP_VERSION` (`src/config.js`) didn't, stop and ask Haim which version to bump to.
4. Deploy with `npm run deploy` from a clean tree (so the commit has no `-dirty`). Pass `--project=mygymbot` literally on every gcloud call; never touch another project.
5. Smoke-check, as in CLAUDE.md: the new revision serves 100% of traffic and has `GYMBOT_COMMIT` equal to HEAD; `curl -sI https://mygymbot-83264737603.me-west1.run.app` redirects (302) to Google sign-in; `gcloud run services logs read mygymbot --project=mygymbot --region=me-west1 --limit=30` shows the new revision started cleanly.
6. Report the commit(s), the revision name, the version, and the smoke-check result. Remind Haim to check the signed-in app and to reload any open tab.
