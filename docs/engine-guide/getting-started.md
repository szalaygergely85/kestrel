# Getting started

We build the [hello-world sample](samples/hello-world/main.js) in six steps. Every engine name below is `stable`. Coordinates: x east, y north, z up, in metres. Yaw 0 looks along +y.

## 1. Page and content

Content packs are classic scripts that fill `window.ASSETS`. Load them before your module:

```html
<canvas id="screen"></canvas>
<script src="../../../../design/palette.js"></script>
<script src="../../../../design/detail-pass.js"></script>
<script type="module" src="main.js"></script>
```

```js
import { AssetRegistry } from '../../../../engine/index.js';
const assets = AssetRegistry.fromGlobals(globalThis.ASSETS);
```

`assets.add('model', key, def)` adds your own content. A voxel model is `{ name, voxel: { version: 1, cellM, size, anchor, mats, layers, parts, animations } }` (see [content-formats.md](content-formats.md)). Materials (`brass_light`, `stone`) are keys from the palette.

## 2. Renderer and engine

```js
import { createRenderer, createEngine, createFrameRenderer } from '../../../../engine/index.js';
const built = await createRenderer({ canvas, backend: 'webgpu', cols: 240, rows: 90,
  cpuGrid: { cols: 240, rows: 90 }, rays: 1, terrainEnabled: false, shadows: { sun: 'off' } });
const { rt, pipeline } = built;
const engine = createEngine({ canvas, assets, renderTarget: rt, renderPipeline: pipeline,
  cols: 240, rows: 90, physics: { mode: 'mesh' }, shadows: { sun: 'off' } });
const frameRenderer = createFrameRenderer({ engine, rt, pipeline, assets });
rt.resize(window.innerWidth, window.innerHeight);
frameRenderer.resize(rt.cols, rt.rows);
await frameRenderer.ready; // shaders compiled
```

`cols x rows` is the glyph grid. `rt` draws it to the canvas. `createFrameRenderer` binds the GPU pass and owns the per-frame order (lights, render, present); call `frameRenderer.resize(cols, rows)` after every `rt.resize`.

## 3. Load a world

```js
const world = engine.loadWorld({ name: 'hello', structures: [], entities: [], state: {} }, { physics: 'mesh' });
```

An empty world is fine. You fill it with `world.placeMesh(...)` (static geometry) and `world.spawn(type, transform, components, id)` (things with a model or a light).

## 4. Add a floor, a model and a light

```js
import { buildMeshFromTris } from '../../../../engine/index.js';
const floor = buildMeshFromTris(tris, [{ part: 'floor', triStart: 0, triCount: 2 }], 'hello.floor');
floor.mats = { floor: 'stone' };
world.placeMesh(floor, { x: 0, y: 0, z: 0 }, 'hello.floor');
world.spawn('prop', { x: 0, y: 4, z: 0, yawDeg: 0, scale: 1 }, { voxel: { model: 'hello.block', anim: 'idle', loop: true } }, 'hello.block');
world.spawn('prop', { x: 1, y: 3, z: 1.2, yawDeg: 0, scale: 1 }, { light: { preset: 'lantern', on: true } }, 'hello.lamp');
```

A light is a component with a palette preset name (`lantern`, `torch`, ...).

## 5. Camera and input

The camera is a plain object. Input is plain DOM events:

```js
const cam = { x: 0, y: 0, z: 1.7, yawDeg: 0, pitchDeg: 5 };
const keys = new Set();
addEventListener('keydown', (e) => keys.add(e.code));
addEventListener('keyup', (e) => keys.delete(e.code));
```

Each frame, turn `yawDeg`, then move: forward is `(sin(yaw), cos(yaw))`, right is `(cos(yaw), -sin(yaw))`. Use `DEG2RAD` for the conversion.

## 6. Render loop

```js
function frame() {
  // ...move `cam` from the keys...
  frameRenderer.step(world, cam, { animate: true, dt });
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```

`step` syncs the lights, fills the cell buffers, shades them on the GPU and presents the canvas.

## Next

- Real walking with collision: `moveCapsule`, `PHYSICS_DEFAULTS` (area `physics`). The sample moves the camera freely.
- Pathfinding: `NavGrid`, `findPath` (area `nav`). Dialogue and panels: `createUiLayer`, `createDialogueRunner` (area `ui`).
- Bigger examples: `game/world-test.html` and `game/js/dev/`.
