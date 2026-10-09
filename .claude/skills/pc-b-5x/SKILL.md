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
3. Spawn a `programmer` (sonnet, background) with: clone path, item ID, the EXACT spec lines to read (file + line range, e.g. `sprint-8-queue.md:61-68`, `architecture.md` 38.10a) and the files to edit, port range, and the token rules below verbatim. Group related small items (same files/topic, e.g. ALPHA-01f host b+c+d) into ONE run.

## Token rules for every agent prompt (owner 2026-10-09)
- **Hard cap 40 tool calls.** At the cap: stop, write what is left + ASK ARCHITECT in the lane file, reply. Never keep digging.
- **Node only. No browser, no capture, no gpucompare.** A story that needs a browser check WRITES/extends a `tools/verify-*.mjs` script taking `<port> [backend]` (or `--port`), checks it with `node --check`, and names the exact command line (with `{port}`) in its lane entry. The main session runs it in the batch.
- **No new dependencies (owner 2026-10-09):** never add or import a package that is not already in package.json (no Playwright, Puppeteer, etc.). Browser scripts use the CDP helpers exported by `tools/capture-browser.mjs`, same shape as `tools/verify-chest-hook.mjs`.
- **Read narrowly:** only the given line ranges + the files you edit. No grepping/reading whole lane logs, backlog or architecture.md; no full `run-tests.mjs` (only `--filter a,b` (comma list or repeated; 0 matches exits 1)).
- **Models:** sonnet programmers; haiku for one-line fixes, doc nits, lane-log archiving; architect notes sonnet unless the note is a real design call (opus).
- Do it yourself, don't delegate; no commit/stash/reset; append ONE lane entry (<= 6 lines); reply in <= 10 lines.

## Ship (main session, ONE gate at a time per machine)
1. Read `git -C ../kestrel-N diff --stat` and the diff; no logs/captures.
2. Commit each finished item locally in its clone (`<ID>: <what>` + attribution, files by name).
3. Gate in batches, not per item: fetch the clones' committed branches into `../kestrel` (B1) or the B2 integration tree (`../kestrel-base`, branch `b2int`), merge, then ONE `node tools/run-tests.mjs` + `check-deps` + `validate-content`, then ONE background browser batch: `node tools/browser-batch.mjs ["<each item's verify command with {port}>" ...]` (always runs gpucompare webgpu vs `docs/test-reports/gpucompare-baseline-webgpu-intel.json` + the browser route walk; one PASS/FAIL line per check, logs in %TEMP%/kestrel-browser-batch). On a FAIL, resume only that item's agent with the failure lines.
4. Known load flakes on this laptop: `engine/world/terrainStroke.test.js` (150 ms budget) and `tools/run-tests.test.mjs` - re-run alone; terrainStroke also fails on the pre-change commit under load (checked 2026-10-09).
5. Push `pc-b` / `pc-b2` (`git push`, retry on the flaky SSH `kex_exchange_identification` error; check the exit code, not `tail`). After a B2 push, merge `origin/pc-b2` into `pc-b` in `../kestrel`, gate, push.
6. Next item from `docs/pc-b-queue.md` for that slot. Fresh main session after ~3 batches (handoff first): a long main session re-sends its whole context every turn.

## 5th agent (only when blocked or empty)
When a slot has no unblocked item left (deps, `ARCH-NOTE NEEDED`, `ASK ARCHITECT` waiting on PC-A), run ONE extra agent, never two. **First** `git fetch origin` and check `origin/master` for the note/story: PC-A may already have written it (2026-10-09: a PC-B architect duplicated PC-A's 38.13-38.16 eleven minutes after they landed on master). Use PC-A's if it exists.
- **architect** (`model: opus`): tech note for the next `ARCH-NOTE NEEDED` item (append to the item in `docs/sprints/sprint-8-queue.md` + a short `architecture.md` 38.x subsection), or answer a lane `ASK ARCHITECT`. No `ARCH OK`/`ARCH CHANGES` on PC-B code.
- **product-owner** (sonnet): new story rows + ACs to refill an empty slot queue (in `docs/pc-b-queue.md`). No `PO OK`.
Mark its output `(PC-B 5th agent, PC-A to ratify)` and list it in the next handoff.
