# DEEPSEEK.md - PC-B trial with DeepSeek (owner 2026-10-06)

You are a DeepSeek model running as a coding agent on **PC-B** (for example through Aider, OpenCode or Cline). Read **`AGENTS.md`** first (git, code rules, checks, reporting): everything there applies to you. This file only adds the trial rules.

## Setup (owner, once)
- API key from platform.deepseek.com (prepaid balance; when it reaches 0 the calls fail, so top up before a session).
- Model: `deepseek` V4 **Pro** for code (Flash only for trivial edits). Run **off-peak**: peak is weekdays 01:00-04:00 and 06:00-10:00 UTC (Hungary CEST 03-06 and 08-12, CET 02-05 and 07-11); everything else and weekends are half price.
- Tool hints: OpenCode reads `AGENTS.md` itself. Aider: `aider --model deepseek/<model> --read AGENTS.md --read DEEPSEEK.md --read docs/pc-b-queue.md`. Cline: add these three files to its rules.

## Trial scope - only these items
Pick from `docs/pc-b-queue.md`, in this order, one item per session:
1. **TOWER-BOULDER-01** - remove the tower boulder (content + tests + route-walk leg).
2. **ED-PLACE-BUG** - editor: an armed Assets model must place on the next viewport click.
3. **UI-XHAIR-01** - bigger crosshair with a transparent background (touches `engine/ui`, ends in arch-review).
4. Quaternius imports that need no alpha cutout (dead trees, rocks, pebbles, rock paths, mushrooms, grass) via `tools/gltf-import.mjs` - see `docs/architecture.md` 37.17.

**Do not take** engine render/physics stories (ME-19*, ALPHA-01*, TREES-LP-b, PREC-01a, HANDS-01a, ME-15f) or Sprint 6 stories during the trial. Those stay with the main PC-B setup.

## Extra rules for the trial
- Small steps: read only the files the item names; run the Node test for the file you touched before the full suite.
- Stop rule: if one bug takes more than ~30 tool calls or 3 failed test runs, stop, write `NEEDS PC-A: <what failed>` at the END of the item's backlog row (never in the ID column), commit the note only, and stop.
- Never `git stash`, `git checkout -- <file>`, `git reset`, force-push or rewrite history. Never edit files outside the item's scope.
- Done = the item's tests + `node tools/run-tests.mjs` all PASS + `node tools/check-deps.mjs` OK. Push to `pc-b`.

## Trial log (fill in after each item, one line each)
Write it in `docs/test-reports/deepseek-trial.md`: date, item, model, peak/off-peak, rounds needed (how many times tests failed before passing), USD spent (from the DeepSeek dashboard), and whether PC-A had to send it back. The owner compares this with Codex/Claude after 2-3 days.
