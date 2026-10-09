---
name: pc-b-5x
description: PC-B on the 5x plan (owner 2026-10-09) - 4 sonnet programmers in clones kestrel-1..4, slot/lane/port map, how the main session starts, gates, commits and pushes an item, and when the optional 5th agent (PO or architect) may run. Use when starting, finishing or assigning any PC-B item.
---

# PC-B on 5x

## Slots (one programmer per clone, never the old `../game_project*` folders)
| Clone | Lane / branch | Focus (hot files it owns) | Ports |
|---|---|---|---|
| `../kestrel-1` | B1 `pc-b` | game hooks: the ONLY slot that edits `game/js/main.js` | 9500-9574 |
| `../kestrel-2` | B1 `pc-b` | GPU spine: `wg/**`, `GpuDeviceWebGPU.js`, `RenderTarget*`, `MeshBuffers.js`, `capture-browser.mjs` | 9575-9649 |
| `../kestrel-3` | B2 `pc-b2` | masked/instanced mesh: `engine/mesh/**`, new `wgsl/*` modules | 9650-9724 |
| `../kestrel-4` | B2 `pc-b2` | other WGSL modules + importer/tools | 9725-9799 |
| `../kestrel` | main session | handoffs, `docs/backlog.md`, merge `pc-b2` -> `pc-b`, no programmer | - |
Lane C (Codex, ports 9800-9999) is unchanged. Each clone: `origin` = GitHub (`github-szalaygergely85` alias), remote `main` = `../kestrel`, local git user szalaygergely85.

## Hot-file rule
One slot per hot file at a time: `main.js` = kestrel-1 only; an item in another slot that needs a `main.js` line writes `NEEDS B1-main:` in its lane file and kestrel-1 does it next. `design/palette.js`, `game/index.html`, `docs/backlog.md` = main session only. Two slots never take items with the same file in `Files:`.

## Start an item (main session)
1. `git -C ../kestrel-N status --short` must be empty (previous item shipped).
2. `git -C ../kestrel-N fetch origin && git -C ../kestrel-N merge --no-edit origin/<lane-branch> origin/master`.
3. Spawn a `programmer` (sonnet, background) with: clone path, item ID + queue/spec lines, owned files, port range, "do it yourself, don't delegate; no commit/stash/reset; run only your `--filter` suites, the full run is the main session's; stop rule ~40 tool calls -> ASK ARCHITECT in the lane file; append one short lane-file entry; short reply".

## Ship (main session, ONE gate at a time per machine)
1. Read `git -C ../kestrel-N diff --stat` and the diff; no logs/captures.
2. In the clone: `node tools/run-tests.mjs`, `node tools/check-deps.mjs`, `node tools/validate-content.mjs`; render/GPU change -> gpucompare `--baseline` (skill `gpucompare`); `main.js` change -> route walk.
3. Commit by file name (`<ID>: <what>` + attribution), `git fetch origin && git merge --no-edit origin/<lane-branch>`, re-run suites if anything came in, `git push origin HEAD:<lane-branch>`. Rejected push -> fetch + merge + push again, never force.
4. B2: the main session merges `origin/pc-b2` into `pc-b` in `../kestrel` after a B2 push and pushes `pc-b` (gates first).
5. Next item from `docs/pc-b-queue.md` for that slot; start it right away so 4 slots stay busy.

## 5th agent (only when blocked or empty)
When a slot has no unblocked item left (deps, `ARCH-NOTE NEEDED`, `ASK ARCHITECT` waiting on PC-A), run ONE extra agent, never two:
- **architect** (`model: opus`): tech note for the next `ARCH-NOTE NEEDED` item (append to the item in `docs/sprints/sprint-8-queue.md` + a short `architecture.md` 38.x subsection), or answer a lane `ASK ARCHITECT`. No `ARCH OK`/`ARCH CHANGES` on PC-B code.
- **product-owner** (sonnet): new story rows + ACs to refill an empty slot queue (in `docs/pc-b-queue.md`). No `PO OK`.
Mark its output `(PC-B 5th agent, PC-A to ratify)` and list it in the next handoff.
