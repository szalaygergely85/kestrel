# DEEPSEEK.md - PC-B trial with DeepSeek (owner 2026-10-06)

You are a DeepSeek model running as a coding agent on **PC-B** (for example through Aider, OpenCode or Cline). Read **`AGENTS.md`** first (git, code rules, checks, reporting): everything there applies to you. This file only adds the trial rules.

## Setup (owner, once)
- API key from platform.deepseek.com (prepaid balance; when it reaches 0 the calls fail, so top up before a session).
- Model: `deepseek` V4 **Pro** for code (Flash only for trivial edits). Run **off-peak**: peak is weekdays 01:00-04:00 and 06:00-10:00 UTC (Hungary CEST 03-06 and 08-12, CET 02-05 and 07-11); everything else and weekends are half price.
- Tool hints: OpenCode reads `AGENTS.md` itself. Aider: `aider --model deepseek/<model> --read AGENTS.md --read DEEPSEEK.md --read docs/pc-b-queue.md`. Cline: add these three files to its rules.

## Trial scope
Done 2026-10-06 (round 1): TOWER-BOULDER-01 (Flash), ED-PLACE-BUG (V4 Pro) - $0.46 total, 0 code retries.

### Afternoon list (round 2, 2026-10-06) - in this order, one item at a time, V4 Pro, off-peak
| # | Item | Size | Spec | Ends in |
|---|---|---|---|---|
| 1 | **UI-XHAIR-01** bigger crosshair, glyph-only (transparent) UI cells in both present paths | ~0.5 d, engine/ui | backlog row UI-XHAIR-01 | arch-review + owner look |
| 2 | **READ-01** readable notes: register `note.read`, apply `ASSETS.levelPatch.towerNotes`, paused read panel from `uiStyle.note`, notes.js script tag (game + editor), update tower/content-smoke/restart tests | ~0.5 d, game/UI | backlog row READ-01, design/models/notes.js, design/preview/notes.html | owner walk-test (screenshot check from AGENTS.md!) |
| 3 | **US-079b0** engine seams for boar death: `voxel.hidden` flag skipped by the voxel renderer + `World.addInteractable` / `removeInteractable` | ~0.3 d, engine | architecture 37.16, backlog row | arch-review |
| 4 | **US-079b** boar HP, hurt flash/flinch, death roll, lootable corpse (no loot yet), respawn on reset | ~0.75 d, game | architecture 37.16, sprint-6.md, design/models/voxel_beast.js (`boarFx`) | arch-review + owner walk-test |
| 5 | Filler if time is left: Quaternius imports that need no alpha cutout (dead trees, rocks, pebbles, rock paths, mushrooms, grass) via `tools/gltf-import.mjs --uv planar --mats`, into `content/meshes/quaternius/`, + THIRD_PARTY_NOTICES.md line (CC0) | ~0.5 d, tools/content | architecture 37.17 "imports now" list | main-session check |

Stop after item 4 if the day is over; log each item in the trial log before starting the next.

**Still not for DeepSeek:** ME-19c/d (renderer core), HANDS-01a (view-model mirror, core render), ALPHA-01b/c, PREC-01a, ME-15g, TREES-LP-b. Codex/Claude keep those.

## Extra rules for the trial
- Small steps: read only the files the item names; run the Node test for the file you touched before the full suite.
- Stop rule: if one bug takes more than ~30 tool calls or 3 failed test runs, stop, write `NEEDS PC-A: <what failed>` at the END of the item's backlog row (never in the ID column), commit the note only, and stop.
- Never `git stash`, `git checkout -- <file>`, `git reset`, force-push or rewrite history. Never edit files outside the item's scope.
- Done = the item's tests + `node tools/run-tests.mjs` all PASS + `node tools/check-deps.mjs` OK. Push to `pc-b`.

## Trial log (fill in after each item, one line each)
Write it in `docs/test-reports/deepseek-trial.md`: date, item, model, peak/off-peak, rounds needed (how many times tests failed before passing), USD spent (from the DeepSeek dashboard), and whether PC-A had to send it back. The owner compares this with Codex/Claude after 2-3 days.
