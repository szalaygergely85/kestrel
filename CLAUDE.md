# ASCII Quest – Zelda-like 3D ASCII RPG

A browser game (HTML/CSS/JS, no build step): Zelda-inspired 3D open-world action RPG rendered only with colorful ASCII characters, with dynamic lighting and physics.

## Team (agents in `.claude/agents/`)
| Agent | Model | Role |
|---|---|---|
| `manager` | fable | Big decisions, roadmap, conflict resolution → `docs/decisions.md`, `docs/roadmap.md` |
| `product-owner` | opus | Vision/GDD, backlog, user stories, acceptance, "PO OK" |
| `designer` | opus | ASCII models, animations, palettes, lighting ramps → `design/` + HTML previews |
| `programmer` | sonnet | Implements stories exactly as specified → `game/` |
| `tester` | sonnet | Tests after PO OK → `docs/test-reports/` |

## Workflow (the main session orchestrates; subagents cannot call each other)
1. **product-owner** writes/picks a story in `docs/backlog.md` (status `todo`).
2. If art is needed → **designer** builds assets + preview page (status `design`) → PO checks the preview.
3. **programmer** implements (status `dev` → `po-review`).
4. **product-owner** reviews: `PO OK` → status `testing`, or `PO REJECT` → back to programmer.
5. **tester** tests and writes a report: PASS → `done`, FAIL → back to programmer with bugs.
6. Any "ESCALATE TO MANAGER" / "NEEDS MANAGER DECISION" → ask **manager**, record in `docs/decisions.md`, then continue.

## Layout
- `docs/` – game-design.md, backlog.md, roadmap.md, decisions.md, test-reports/
- `design/` – palette.js, models/*.js, preview/*.html, style-guide.md
- `game/` – index.html, js/{engine,render,physics,world,entities,ui}/
