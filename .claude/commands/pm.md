---
description: Run a product round: the product-manager agent proposes features and look-and-feel changes, then Haim decides
argument-hint: "[optional focus for this round, e.g. 'the live workout screen']"
---

Haim ran /pm. Focus for this round (empty: the PM chooses): $ARGUMENTS

1. Run the `product-manager` agent in this repo (not in a worktree, so the proposals file lands here). Give it today's date and the focus.
2. Read the proposals file it wrote. Show Haim each proposal in a few lines, with the screenshot paths. Send him the key screenshots (SendUserFile) if he follows from another device.
3. Ask him about every proposal with AskUserQuestion (approve, change, reject), and relay the PM's open questions.
4. Write his answers into the file's Decisions section, with the date: what was decided, and why if he said.
5. For each approved proposal, `gh issue create` with the problem, the smallest version and the success measure, and add it to `docs/ROADMAP.md`. His approval of that proposal is the OK for that issue; create nothing else.
6. Remove the mockup worktree and branch of each rejected proposal (`git worktree remove ../mygymbot-mockup-<slug>`, `git branch -D mockup/<slug>`). Keep approved ones until they are built.
7. Report: the decisions, the issue numbers, and a rough cost of the round (agent tokens and Gemini calls). Don't commit; Haim says /push.
