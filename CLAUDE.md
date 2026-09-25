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
| `writer` | opus | Story, lore, names, scrawl and hint text → `docs/story.md` (text only, canon in game-design.md section 3) |
| `janitor` | haiku | Mechanical chores only: run suites + summarise, report dead code/unused exports, tidy docs formatting. Never edits engine/game/design/tools |

## Workflow (the main session orchestrates; subagents cannot call each other)
1. **product-owner** writes/picks a story in `docs/backlog.md` (status `todo`).
2. If art is needed → **designer** builds assets + preview page (status `design`) → PO checks the preview.
3. **Engine stories** (anything in engine render/world/physics/core/entities/ui): **architect** writes tech notes first.
4. **programmer** implements (status `dev`).
5. **Engine stories**: **architect** reviews the code → `ARCH OK` (→ `po-review`) or `ARCH CHANGES` (→ back to programmer). Content/UI-only stories skip this and go straight to `po-review`.
6. **product-owner** reviews: `PO OK` → status `testing`, or `PO REJECT` → back to programmer.
7. **tester** tests and writes a report: PASS → `done`, FAIL → back to programmer with bugs.
8. "ASK ARCHITECT: ..." → route to **architect**. "ESCALATE TO MANAGER" / "NEEDS MANAGER DECISION" → ask **manager**, record in `docs/decisions.md`, then continue.

## Sprints (owner, 2026-09-24)
- Work in sprints of **5-6 stories** with a one-line sprint goal (aim: "what makes the game playable / look right").
- **Planning:** manager + PO pick the stories and the goal → `docs/sprints/sprint-N.md` (goal, stories, owner).
- **During:** the normal workflow above.
- **Review:** PO writes a short summary in the sprint file (done / not done / bugs found) plus a **"missing to be playable"** gap list, and asks for an **owner walk-test**. Manager reads it, plans the next sprint, and records decisions in `docs/decisions.md`.

## Layout
- `docs/` – game-design.md, backlog.md, roadmap.md, decisions.md, architecture.md, test-reports/
- `design/` – content pack: palette.js, models/*.js, levels/*.js, preview/*.html, style-guide.md, README.md
- `engine/` – reusable engine library: core, render, world, physics, entities, ui; `engine/index.js` is the only public entry; never imports from `game/` or `design/`
- `game/` – the product: index.html, world-test.html, physics-test.html, js/main.js (bootstrap, builds the AssetRegistry), js/dev/ (page harnesses), js/quest/ (game-specific behaviours)
- `tools/` – dev tools (check-deps.mjs), future editor
- Dependency check: `node tools/check-deps.mjs` (fixture test: `node tools/check-deps.test.mjs`). Physics/entities tests: `node engine/physics/physics.test.js`, `node engine/physics/jump.test.js`, `node engine/entities/eyeFeel.test.js`, `node engine/core/playerLook.test.js`. Bench: `node --expose-gc tools/bench-cast.mjs --gc`.
- Git: the main session commits (branches: see "Two PCs"). Local server: `python -m http.server 8000` from the repo root (launch config `ascii-quest-http`).

## Two PCs (owner, 2026-09-25)
Two main sessions on two computers share the GitHub repo `origin` (github.com/szalaygergely85/kestrel). Each PC has its own clone.
- **PC-A** (engine/render: engine/render, world, physics, core, gpu shaders, US-018-type perf) works on branch `pc-a`; **PC-B** (content, sound, tools, level data: design/, game/js/quest/, tools/, audio) works on branch `pc-b`. Every story row in `docs/backlog.md` carries a `PC-A`/`PC-B` tag (PO sets it at sprint planning, with the main files it touches); a session only works on its own PC's stories. Untagged or cross-track work -> ask the owner first.
- **Shared hot files:** `docs/backlog.md`, `game/js/main.js`, `design/palette.js`, `design/detail-pass.js`, `game/index.html`, `docs/decisions.md`. Keep edits small and local (append rows/lines, don't reflow tables or rewrite paragraphs), commit right after.
- **Sync:** before starting a story and before pushing, `git fetch origin && git merge origin/master` into your branch; run all Node suites + `node tools/check-deps.mjs`; push your branch when a story (or a clean step) is done.
- **Merge to master:** PC-A's main session merges `origin/pc-b` and `pc-a` into `master` (tests + check-deps + `?gpucompare=1` after the merge), pushes `master`. The architect (opus) reviews a merge only when both sides touched engine code or tests fail after the merge. Never force-push, never rewrite pushed history.
- **Handoffs:** each PC writes its own handoff block at the top of `docs/backlog.md`, headed `PC-A handoff` / `PC-B handoff`.
- **PC-B agents (owner, 2026-09-25):** PC-B runs **only `programmer` agents (sonnet), up to 2 at the same time**, each on a different story with no shared files (both share one working tree: never both editing `game/js/main.js`, `design/palette.js` or `docs/backlog.md` at once - the PC-B main session makes those shared edits itself). PC-B does not spawn PO, architect, designer, writer, manager, tester or janitor. That work for PC-B stories is done on **PC-A**, ahead of time: PO acceptance criteria, architect tech notes and reviews, designer assets, writer text are committed to `master` before PC-B picks the story up. When a PC-B story needs one of those roles (e.g. PO OK, an ASK ARCHITECT, art), PC-B writes it in the story row as `NEEDS PC-A: <what>` and pushes; PC-A answers and pushes back. The PC-B main session verifies itself (Node suites, check-deps, preview/gpucompare checks).
- **Ports:** PC-A agents use 9000-9499, PC-B agents 9500-9999; 8000 is the owner's server on each PC. The `../game_project_test` worktree is per PC.

## Token budget rules (main session)
- **architect**: use fable only for first reviews of core engine code (render/physics/world) and big tech notes. Re-reviews, questions and small stories use `model: opus`. For a re-review, spawn a fresh opus architect with only the diff + the prior verdict (resuming a long-context agent re-sends its whole transcript and cost ~200k for a 4-tool re-review). Resume only agents with short histories.
- Every architect/PO prompt names the diff/commits and the exact doc sections to read, says "run probes only if something looks wrong", and asks for a short reply (verdict + required changes).
- **product-owner**: sonnet for routine re-reviews / ASK PO answers, opus for new stories and first reviews.
- Agents testing in a browser start their own server on a fresh port and stop **only that process**. Never kill all python processes: the owner's `ascii-quest-http` server on port 8000 must stay up.
- Agents never run `git stash`, `git checkout -- <file>` or `git reset` in the main repo: several agents share the working tree. For baseline comparisons, use the clean worktree `../game_project_test` (the main session moves it to the right commit) or `git show <commit>:<path>`.
- **Weekly limit (2026-09-24):** one agent at a time by default; programmers work in small steps with Node tests and ONE browser pass at the end; the main session runs `?gpucompare=1` / preview checks itself; tester only for owner-visible stories (small bugs are verified by the main session); skip PO for pure engine bugs; start a fresh main session per day/sprint (handoff at the top of docs/backlog.md).
- Subagents do their task themselves and **never spawn or delegate to other agents** (nested agents can't be tracked or stopped by the main session). Every agent prompt says "do it yourself, don't delegate".
