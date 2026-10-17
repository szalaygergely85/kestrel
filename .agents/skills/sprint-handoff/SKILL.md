---
name: sprint-handoff
description: Write kestrel's end-of-session handoff (PC-A/PC-B block at the top of docs/backlog.md), the owner to-do list, and batch the doc commits. Use at the end of a session/sprint or before pushing.
---

# Handoff (AGENTS.md "Two PCs" + "Fewer commits")

1. Sync first: `git fetch origin && git merge origin/pc-b` (PC-A) / `origin/master` (PC-B); run `node tools/run-tests.mjs` + `node tools/check-deps.mjs`. Known timing flakes on a loaded machine: terrainStroke (150 ms bar), run-tests.test.mjs; a real regression is anything else.
2. Block at the top of `docs/backlog.md` headed `PC-A handoff <date>` (or `PC-B ...`; replace your own previous block, move old ones to `docs/backlog-archive.md`): done, for review/owner, queue order for the other PC, open ASK ARCHITECT / NEEDS PC-A, freeze rules (e.g. no new GLSL, D-044).
3. **Owner to-dos list at the end** (also in the block): walk-tests with 2-line steps, owner looks, pending decisions (e.g. pushing parked branches). Always end replies with it.
4. One "docs" commit for all status changes (attribution line from the session reminder), then `git push origin <branch>` (never force; never push big/unlicensed assets without asking; PC-A updates master via `git push origin pc-a:master` only after merge checks, no checkout in the shared tree while agents run).
5. Don't re-send long context in prompts: name rows/sections; point agents to skills (`gpucompare`, `mesh-import`, `wgsl-port`, `pc-b-sync-verify`, `arch-batch-review`).
