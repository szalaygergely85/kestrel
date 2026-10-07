# AGENTS.md - instructions for Codex (and any non-Claude coding agent)

This repo is **ASCII Quest / Kestrel**: a browser game (plain HTML/CSS/JS, ES modules, no build step) on our own ASCII 3D engine.
The full project rules are in **`CLAUDE.md`**; read it first. The rules below are the parts you must never break.

## Your role
- You are **lane C** (content and tools), working in your own clone on branch `pc-c` (owner 2026-10-07; see skill `.claude/skills/parallel-lanes/SKILL.md` for ownership, ports, merge order). PC-B's two Claude lanes own the WebGPU work; do not touch `engine/render/**` or `game/js/main.js`. Reviews (architect, PO), design assets and story text come from PC-A. You never do those yourself.
- Your work list is **`docs/lanes/pc-c.md`** (it replaces `docs/pc-b-queue.md` for you; the QUEUE blocks in `docs/backlog.md` are history). Log your status in that file, never in `docs/backlog.md`. Re-read it after every `git fetch` - PC-A reorders it when the owner changes priorities. Do its items in order. Each item names the files to touch, the spec (usually a `docs/architecture.md` section) and the checks.
- If an item needs a decision you can't find in the spec, don't guess. Write `NEEDS PC-A: <question>` at the END of that story's row in `docs/backlog.md` (never in the ID column), push it, and go on to the next item. **Always add your recommended answer and the alternative** ("recommend A because ...; B would ..."), so PC-A can reply with one word.
- **Decide small things yourself** (owner 2026-10-06): under D-039 a NEW gpucompare pose that fails only on JS/GPU precision (raster ties, f32 vs f64, look-hash colour outliers, AO seams) is NOT a stop - record its exact metrics as a known-FAIL baseline in the row and report, check no previously passing row regressed, and carry on. Stop only for a real twin bug (missing/wrong geometry, crash), a spec contradiction, or an owner-visible look decision.
- Stop rule: if you're stuck on one bug for about 30 minutes or 40 tool calls, stop and write `ASK ARCHITECT: <what you tried, what fails>` in the story's row.

## Git
- Before starting an item and before pushing: `git fetch origin && git merge origin/master` into `pc-c`. Also merge `origin/pc-a` and check `git log origin/pc-a` so you never redo PC-A work.
- **One commit per finished item** (code + tests + its entry in `docs/lanes/pc-c.md` together), then immediately push to `origin/pc-c` before starting the next item. Do not batch finished items or wait for the owner to remind you to push. Commit messages start with the story id, e.g. `US-078d: ...`.
- Never `git stash`, `git reset`, `git checkout -- <file>`, force-push or rewrite pushed history. Never commit to `master`: PC-A merges `pc-c` and `pc-b` into `master`.
- Never commit third-party assets unless they're listed as allowed in `THIRD_PARTY_NOTICES.md`.

## Code rules
- `engine/` never imports from `game/` or `design/`. `engine/index.js` is the only public entry. Keep `engine/physics/` standalone.
- No new runtime libraries, no TypeScript source, no build step. JSDoc types only.
- Engine render code has a JS twin and a GPU (GLSL) path. Change both together, with the same expression order.
- Hot paths must not allocate per frame. Existing tests check zero allocation, so keep them passing.
- Match the surrounding code style and comment density.
- Shared hot files: `game/js/main.js`, `design/palette.js`, `design/detail-pass.js`, `docs/backlog.md`, `game/index.html`, `docs/decisions.md`. Keep those edits small and local: append rows/lines, never reflow tables or rewrite paragraphs.

## Owner-visible check (owner 2026-10-06)
- Tests prove the code works; they don't prove the owner can **see** it. For any change the owner will look at (content, colours, UI, effects, props, text), take one real-GPU screenshot at 400x150 from where the player normally stands and look at it: is it visible, readable, does it stand out from what's behind it, is it the right size? Write one line about it in the report ("visible: yes - chalk text on dark stone, readable from 2 m"). If it is not clearly visible, say so in the row as `LOOK RISK: ...` instead of reporting done. (Lesson: DECAL-01 passed every test while drawing wall-coloured text that the owner could not see.)

## Checks before every commit
- `node tools/run-tests.mjs`: every suite must PASS (`--filter <name>` for a quick subset while working).
- `node tools/check-deps.mjs`: must print `check-deps OK` (warnings are fine).
- Any change to `game/js/main.js`: also run `node tools/route-walk-browser.mjs --port <95xx>` (mesh, the default). It must reach the end trigger.
- **The old `dda` renderer is frozen (D-037, owner 2026-10-04):** never run dda checks, never add dda support to new features, never fix dda-only bugs. Only `?renderer=dda` must still boot. It gets deleted in ME-19.
- Engine render changes: `?gpucompare=1` must show no new FAIL rows. Headless: `node tools/capture-browser.mjs --mode gpucompare --port <95xx> --timeout-ms 300000`. Delete the capture JSON/PNG it writes.
- Browser checks: serve with `python tools/serve.py <port>` (no-cache headers), on a port in **9500-9999**. Never use 8000 (the owner's server). Stop only the server you started.

## Reporting
- When an item is done, update its row in `docs/backlog.md`:
  - status: `arch-review` for engine code, `NEEDS PC-A: PO review` for owner-visible game/content, otherwise as the queue says;
  - the files changed;
  - the test counts;
  - any deviation from the spec, with the reason.
- At the end of a session, write a short `PC-B handoff <date>` block at the top of `docs/backlog.md`. **Write it for a human** (the owner reads it): normal spaces and sentences, max ~5 short lines - 1) what the owner can now see or play, 2) what is done for review, 3) blockers with your recommended answer, 4) what's next. Put the long numbers (suite counts, GPU rows, p95) in the test report, not the handoff.
- **Publish promptly:** don't keep finished or half-finished local work unpublished for more than a day. Either finish and push it, or commit it to a `wip/pc-b-<topic>` branch and push that, and note the branch in the row. Long-lived local edits make every later merge risky.
