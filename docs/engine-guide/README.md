# Engine guide

The engine is a small 3D renderer that draws a world as colored text cells on a canvas. It has lighting, shadows, physics and an asset registry. It is plain ES modules: no build step.

## Start here

1. Run the sample (below).
2. Read [getting-started.md](getting-started.md) to build the same thing step by step.
3. Read [content-formats.md](content-formats.md) when you want your own models, meshes or levels.

## Run the sample

From the repo root, start any static server and open the page:

```
python tools/serve.py 9000        # or: python -m http.server 8000
# open http://localhost:9000/docs/engine-guide/samples/hello-world/index.html
```

You see a flat floor, a brass block and a lantern light. Walk with **WASD**, look with the **arrow keys**. It needs a browser with WebGPU (current Chrome or Edge).

Headless check: `node tools/verify-engine-sample.mjs <port>` (ports 9000-9999, not 8000).

## Folder map

| Folder | What it is |
|---|---|
| `engine/` | The library. `engine/index.js` is the only public entry. |
| `engine/api-1.0.json` | Every public name with its `area` and `tier`. |
| `design/` | Shipped content: palette, models, levels (classic scripts that fill `window.ASSETS`). |
| `content/` | Content as JSON (worlds, meshes, packs). |
| `game/` | The game built on the engine. A good source of larger examples. |
| `tools/` | Dev tools, test runner, editor. |
| `docs/engine-guide/samples/` | Small runnable samples. |

## The API

Import only from `engine/index.js`:

```js
import { createEngine, renderWorld } from '../engine/index.js';
```

Each name in [`engine/api-1.0.json`](../../engine/api-1.0.json) has a tier:

- `stable`: frozen for 1.x. Never renamed or removed. Signatures only grow by optional trailing arguments.
- `experimental`: exported, may change in a minor release.
- `deprecated`: still works for one release. Use the `replacedBy` name.

The guide and the samples use stable names only. Areas: core, content, world, render, physics, nav, anim, ui, sim, fx, editor. The rules behind the tiers are in [docs/architecture.md section 38.74](../architecture.md) and [engine/README.md](../../engine/README.md).

Two tests keep this honest: `node engine/api.test.js` (index.js and the manifest match) and `node tools/engine-guide.test.mjs` (the sample and the guide's code blocks use stable names only).
