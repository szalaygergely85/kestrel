# Kestrel

A first-person fantasy adventure drawn entirely with colored ASCII characters, with steampunk machines, dynamic light and physics, and a GPU renderer. It runs in the browser, with no install and no build step.

> *Someone beyond the Wall is calling for help, and you are the one who went.*

You grew up in the walled city of **Ferrum**. When an SOS signal starts blinking on the horizon, you steal the patrol balloon *Kestrel*, get shot down, and wake in a ruined tower with no memory. All you have is a map in your own handwriting. The full story is in [`docs/story.md`](docs/story.md).

**Status:** early development (Milestone 1, "The Awakening"). You can walk, run and jump around the tower world. Lighting, props and puzzles are in progress.

## Quick start

You need:
- a modern desktop browser with **WebGL2** (Chrome or Edge recommended; Firefox works too);
- any static file server. The examples below use Python 3.

From the repository root:

```bash
python -m http.server 8000
```

Then open **http://localhost:8000/game/index.html**. Click into the game to capture the mouse, and press **Esc** to release it.

> Open the page through the server. Opening `index.html` straight from disk (`file://`) doesn't work, because the game uses ES modules.
>
> Browsers cache these files aggressively. If a change doesn't show up, do a hard reload (**Ctrl+Shift+R**) or start the server on a new port, for example `python -m http.server 8123`.

## Controls

| Key | Action |
|---|---|
| Mouse | Look (after clicking into the game) |
| W A S D | Move |
| Shift | Run |
| Space | Jump |
| Arrow keys | Turn and look (keyboard alternative to the mouse) |
| E | Interact (coming with the puzzle stories) |
| F3 | Toggle the debug overlay |
| Esc | Release the mouse (then click to resume) |

## Useful URL options

Add these to the address, for example `index.html?debug=1&grid=240x90`.

| Option | What it does |
|---|---|
| `?debug=1` | Shows the debug overlay (fps, frame and GPU times, position). Its **copy** button copies everything, which is handy for bug reports. |
| `?grid=WxH` | Grid size, from `160x60` to `320x120`. The default on the GPU path is `320x120`. |
| `?level=test_room` | Loads the small test room instead of the tower world |
| `?detail=0` | Uses the old, simpler shading |
| `?force2d=1` | CPU renderer with a Canvas2D fallback (for machines without WebGL2) |
| `?gpu=0` | WebGL present, but CPU shading |
| `?gpucompare=1` | Checks the GPU image against the JavaScript reference, cell by cell |
| `?shadetest=1` | Shader self-test |
| `?bench=1` | Screen-drawing benchmark |

## Tests and tools (Node 20+)

```bash
node tools/check-deps.mjs                       # engine must not import game/ or design/
node engine/physics/physics.test.js             # collision
node engine/physics/jump.test.js                # jumping
node --expose-gc tools/bench-cast.mjs --gc      # renderer benchmark + image checksums
node tools/compare-detail-export.mjs            # detail shader vs. the designer's reference
```

Every `*.test.js` file under `engine/` and `game/` runs directly with `node <file>`.

## Project layout

| Path | Contents |
|---|---|
| `engine/` | The reusable ASCII 3D engine: render (CPU + WebGL2 GPU pipeline), world, physics, entities, UI. `engine/index.js` is the only public entry point. |
| `game/` | The game itself: `index.html`, `js/main.js` (bootstrap) and `js/quest/` (game behaviours) |
| `design/` | The content pack: palette, materials, ASCII models, levels, world data, and HTML preview pages (`design/preview/*.html`) |
| `docs/` | Game design, story, backlog, roadmap, decisions, architecture and test reports |
| `tools/` | Dev tools: benchmarks, dependency checker, and later the editor |

## How it's built

The game is developed by a small team of AI agents (manager, architect, product owner, designer, writer, programmers and tester) coordinated through Claude Code. See [`CLAUDE.md`](CLAUDE.md) for the workflow, [`docs/decisions.md`](docs/decisions.md) for the key decisions and [`docs/roadmap.md`](docs/roadmap.md) for what's next.
