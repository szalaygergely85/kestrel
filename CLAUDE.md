# ASCII Quest – Zelda-like 3D ASCII RPG

A browser game (HTML/CSS/JS, no build step): Zelda-inspired 3D open-world action RPG rendered only with colorful ASCII characters, with dynamic lighting and physics. Built on a **reusable, data-driven ASCII 3D engine** (D-006) that can later get its own editor/tool UI; open world via a hybrid sector + terrain renderer (D-007).

## Team (agents in `.claude/agents/`)
| Agent | Model | Role |
|---|---|---|
| `manager` | opus | Big decisions, roadmap, conflict resolution → `docs/decisions.md`, `docs/roadmap.md` |
| `architect` | fable (opus for re-reviews, Q&A, small tech notes; set per call) | Engine tech notes before dev, technical code review before PO, answers "ASK ARCHITECT" → `docs/architecture.md` |
| `product-owner` | opus (sonnet for routine re-reviews / ASK PO answers, set per call) | Vision/GDD, backlog, user stories, acceptance, "PO OK" |
| `designer` | opus | ASCII models, animations, palettes, lighting ramps, level/terrain data → `design/` + HTML previews |
| `programmer` | sonnet | Implements stories exactly as specified (up to 2 in parallel on separate tracks) |
| `tester` | sonnet | Tests after PO OK → `docs/test-reports/` |

## Workflow (the main session orchestrates; subagents cannot call each other)
1. **product-owner** writes/picks a story in `docs/backlog.md` (status `todo`).
2. If art is needed → **designer** builds assets + preview page (status `design`) → PO checks the preview.
3. **Engine stories** (anything in engine render/world/physics/core/entities/ui): **architect** writes tech notes first.
4. **programmer** implements (status `dev`).
5. **Engine stories**: **architect** reviews the code → `ARCH OK` (→ `po-review`) or `ARCH CHANGES` (→ back to programmer). Content/UI-only stories skip this and go straight to `po-review`.
6. **product-owner** reviews: `PO OK` → status `testing`, or `PO REJECT` → back to programmer.
7. **tester** tests and writes a report: PASS → `done`, FAIL → back to programmer with bugs.
8. "ASK ARCHITECT: ..." → route to **architect**. "ESCALATE TO MANAGER" / "NEEDS MANAGER DECISION" → ask **manager**, record in `docs/decisions.md`, then continue.

## Layout
- `docs/` – game-design.md, backlog.md, roadmap.md, decisions.md, architecture.md, test-reports/
- `design/` – content pack: palette.js, models/*.js, levels/*.js, preview/*.html, style-guide.md, README.md
- `engine/` – reusable engine library (after US-024): core, render, world, physics, entities, ui; `engine/index.js` is the only public entry; never imports from `game/` or `design/`
- `game/` – the product: index.html, js/main.js (bootstrap, builds the AssetRegistry), js/quest/ (game-specific behaviours)
- `tools/` – dev tools (check-deps.mjs), future editor
- Until US-024 lands, engine code still lives under `game/js/{engine,render,physics,world,entities,ui}/`.
- Git: work on `master`; the main session commits. Local server: `python -m http.server 8000` from the repo root (launch config `ascii-quest-http`).

## Token budget rules (main session)
- **architect**: use fable only for first reviews of core engine code (render/physics/world) and big tech notes. Re-reviews, questions and small stories use `model: opus`. Continue the same architect agent via SendMessage for a re-review instead of spawning a new one.
- Every architect/PO prompt names the diff/commits and the exact doc sections to read, says "run probes only if something looks wrong", and asks for a short reply (verdict + required changes).
- **product-owner**: sonnet for routine re-reviews / ASK PO answers, opus for new stories and first reviews.
