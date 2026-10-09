---
name: pc-b-sync-verify
description: PC-B main-session routine for picking up, verifying, committing and pushing a kestrel story (sync from origin, run suites + check-deps, one commit per item, push, handoff). Use when starting or finishing a PC-B queue item.
---

# PC-B sync / verify / ship

Since 2026-10-09 (5x): agents run in clones `../kestrel-1..4`, up to 4 programmers; skill `pc-b-5x` overrides the agent count, tree and push steps below. The verify gates stay as listed here.

Branch `pc-b`. Queue: `docs/pc-b-queue.md`, plus the newest `PC-A handoff` block at the top of `docs/backlog.md` (on `origin/pc-a` if PC-A has not merged to master yet: `git show origin/pc-a:docs/backlog.md | sed -n 1,10p`).

## Start an item
1. `git fetch origin && git merge --no-edit origin/master`
2. If PC-A queued items that build on unmerged `pc-a` work, also `git merge --no-edit origin/pc-a` and say so in the handoff.
3. Baseline: `node tools/run-tests.mjs` (expect all PASS; note the count) and `node tools/check-deps.mjs`.
4. Read the item's backlog row (`grep -n "^| <ID> " docs/backlog.md`) and the architecture sections it names.
5. Implementation goes to a `programmer` agent with `model: sonnet` (PC-B runs only sonnet programmers, max 2, disjoint files). The prompt says: do it yourself, don't delegate; no commit/stash/reset; ports 95xx; stop rule (~30 min stuck -> `ASK ARCHITECT`); update only its own backlog row; short reply.

## Verify (main session, before commit)
- `node tools/run-tests.mjs` all PASS, `node tools/check-deps.mjs` OK, `node tools/validate-content.mjs` OK.
- Touched `game/js/main.js` or level/route data -> mesh route walk before pushing.
- Touched render/GPU -> `?gpucompare=1` (D-039: no previously passing row may regress; never widen thresholds).
- Glance at `git diff --stat`; make sure no logs/captures get committed.

## Ship
- One commit per item: code + its backlog row together. Message: `<ID>: <what>`; end with the attribution line(s) from the session's system reminder.
- `git fetch origin && git merge --no-edit origin/master` again, re-run suites if anything came in, then `git push origin pc-b`.
- Engine items end in `arch-review`; content/UI in `po-review` / owner walk-test. Needs from PC-A go at the end of the row as `NEEDS PC-A: ...`.
- End of session: a short `PC-B handoff <date>` block at the top of `docs/backlog.md` (done, for review/owner, next item), batched into the last commit.
