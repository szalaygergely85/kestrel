# AGENTS.md - instructions for Codex (and any non-Claude coding agent)

This repo is **ASCII Quest / Kestrel**: a browser game (plain HTML/CSS/JS, ES modules, no build step) on our own ASCII 3D engine.
The full project rules are in **`CLAUDE.md`**; read it first. The rules below are the parts you must never break.

## Your role
- You are the **programmer on PC-B**, working on branch `pc-b`. Reviews (architect, PO), design assets and story text come from PC-A. You never do those yourself.
- Your work list is the **newest `PC-B QUEUE` block at the top of `docs/backlog.md`**. Do its items in order. Each item names the files to touch, the spec (usually a `docs/architecture.md` section) and the checks.
- If an item needs a decision you can't find in the spec, don't guess. Write `NEEDS PC-A: <question>` in that story's row in `docs/backlog.md`, push it, and go on to the next item.
- Stop rule: if you're stuck on one bug for about 30 minutes or 40 tool calls, stop and write `ASK ARCHITECT: <what you tried, what fails>` in the story's row.

## Git
- Before starting an item and before pushing: `git fetch origin && git merge origin/master` into `pc-b`. Also check `git log origin/pc-a` so you never redo PC-A work.
- **One commit per finished item** (code + tests + its `docs/backlog.md` row update together), then immediately push to `origin/pc-b` before starting the next item. Do not batch finished items or wait for the owner to remind you to push. Commit messages start with the story id, e.g. `US-078d: ...`.
- Never `git stash`, `git reset`, `git checkout -- <file>`, force-push or rewrite pushed history. Never commit to `master`: PC-A merges `pc-b` into `master`.
- Never commit third-party assets unless they're listed as allowed in `THIRD_PARTY_NOTICES.md`.

## Code rules
- `engine/` never imports from `game/` or `design/`. `engine/index.js` is the only public entry. Keep `engine/physics/` standalone.
- No new runtime libraries, no TypeScript source, no build step. JSDoc types only.
- Engine render code has a JS twin and a GPU (GLSL) path. Change both together, with the same expression order.
- Hot paths must not allocate per frame. Existing tests check zero allocation, so keep them passing.
- Match the surrounding code style and comment density.
- Shared hot files: `game/js/main.js`, `design/palette.js`, `design/detail-pass.js`, `docs/backlog.md`, `game/index.html`, `docs/decisions.md`. Keep those edits small and local: append rows/lines, never reflow tables or rewrite paragraphs.

## Checks before every commit
- `node tools/run-tests.mjs`: every suite must PASS (`--filter <name>` for a quick subset while working).
- `node tools/check-deps.mjs`: must print `check-deps OK` (warnings are fine).
- Any change to `game/js/main.js`: also run `node tools/route-walk-browser.mjs` on both renderers (dda + mesh). Both must reach the end trigger.
- Engine render changes: `?gpucompare=1&renderer=mesh` must show no new FAIL rows. Headless: `node tools/capture-browser.mjs --mode gpucompare --variant mesh --port <95xx> --timeout-ms 300000`. Delete the capture JSON/PNG it writes.
- Browser checks: serve with `python tools/serve.py <port>` (no-cache headers), on a port in **9500-9999**. Never use 8000 (the owner's server). Stop only the server you started.

## Reporting
- When an item is done, update its row in `docs/backlog.md`:
  - status: `arch-review` for engine code, `NEEDS PC-A: PO review` for owner-visible game/content, otherwise as the queue says;
  - the files changed;
  - the test counts;
  - any deviation from the spec, with the reason.
- At the end of a session, write a short `PC-B handoff <date>` block at the top of `docs/backlog.md`: done items, blockers, and open questions for PC-A.
