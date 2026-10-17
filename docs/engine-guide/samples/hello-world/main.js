// Hello-world sample: a flat floor, one voxel block, one light, WASD to walk, arrow keys to look.
// Imports only stable names from engine/index.js (checked by docs/engine-guide/guide.test.js).
import { AssetRegistry, createRenderer, createEngine, createFrameRenderer, buildMeshFromTris, DEG2RAD } from '../../../../engine/index.js';

const status = document.querySelector('#status');
const COLS = 240, ROWS = 90;

// 1. Content: the shipped palette + one inline voxel model (a 6x6x6 brass cube, 0.1 m per voxel).
const block = {
  name: 'hello.block',
  voxel: {
    version: 1, cellM: 0.1, size: [6, 6, 6], anchor: [3, 3, 0], mats: { B: 'brass_light' },
    layers: Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => 'BBBBBB')),
    parts: { body: { box: [0, 0, 0, 6, 6, 6], pivot: [3, 3, 0] } }, animations: { idle: { durations: [1000], loop: true, frames: [{}] } },
  },
};
const assets = AssetRegistry.fromGlobals(globalThis.ASSETS);
assets.add('model', block.name, block);

// 2. Flat floor: two triangles (a 40 m square at z = 0) as a mesh, drawn with a palette material.
const S = 20, up = [0, 0, 1];
const tri = (p0, p1, p2) => ({ p0, p1, p2, normal: up, matName: 'floor' });
const floor = buildMeshFromTris(
  [tri([-S, -S, 0], [S, -S, 0], [S, S, 0]), tri([-S, -S, 0], [S, S, 0], [-S, S, 0])],
  [{ part: 'floor', triStart: 0, triCount: 2 }], 'hello.floor');
floor.mats = { floor: 'stone' };

// 3. Renderer + engine (WebGPU cell pipeline; falls back to a canvas back end when there is no GPU).
const canvas = document.querySelector('#screen');
const built = await createRenderer({ canvas, backend: 'webgpu', cols: COLS, rows: ROWS,
  cpuGrid: { cols: COLS, rows: ROWS }, rays: 1, terrainEnabled: false, shadows: { sun: 'off' } });
const { rt, pipeline } = built;
const engine = createEngine({ canvas, assets, renderTarget: rt, renderPipeline: pipeline,
  cols: COLS, rows: ROWS, physics: { mode: 'mesh' }, shadows: { sun: 'off' } });
const frameRenderer = createFrameRenderer({ engine, rt, pipeline, assets }); // binds the GPU pass and runs the per-frame order
const resize = () => { rt.resize(window.innerWidth, window.innerHeight); frameRenderer.resize(rt.cols, rt.rows); };
resize(); addEventListener('resize', resize);
await frameRenderer.ready; // wait for the shaders to compile

// 4. World: floor mesh, the block, and one warm light beside it. (x east, y north, z up, metres.)
const world = engine.loadWorld({ name: 'hello', structures: [], entities: [], state: {} }, { physics: 'mesh' });
world.placeMesh(floor, { x: 0, y: 0, z: 0 }, 'hello.floor');
world.spawn('prop', { x: 0, y: 4, z: 0, yawDeg: 0, scale: 1 }, { voxel: { model: block.name, anim: 'idle', loop: true } }, 'hello.block');
world.spawn('prop', { x: 1, y: 3, z: 1.2, yawDeg: 0, scale: 1 }, { light: { preset: 'lantern', on: true } }, 'hello.lamp');

// 5. Input: plain DOM key events. The camera is a plain object {x, y, z, yawDeg, pitchDeg}.
const keys = new Set();
addEventListener('keydown', (e) => keys.add(e.code));
addEventListener('keyup', (e) => keys.delete(e.code));
const cam = { x: 0, y: 0, z: 1.7, yawDeg: 0, pitchDeg: 5 }; // yaw 0 looks along +y (north)
const SPEED = 3, TURN = 90; // m/s, deg/s

// 6. Loop: move the camera, then let the frame renderer draw (it also syncs entity lights and presents).
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  const down = (c) => (keys.has(c) ? 1 : 0);
  cam.yawDeg += (down('ArrowRight') - down('ArrowLeft')) * TURN * dt;
  cam.pitchDeg = Math.max(-60, Math.min(60, cam.pitchDeg + (down('ArrowUp') - down('ArrowDown')) * TURN * dt));
  const fwd = down('KeyW') - down('KeyS'), strafe = down('KeyD') - down('KeyA');
  const yaw = cam.yawDeg * DEG2RAD, sin = Math.sin(yaw), cos = Math.cos(yaw);
  cam.x += (sin * fwd + cos * strafe) * SPEED * dt; // forward = (sin, cos), right = (cos, -sin)
  cam.y += (cos * fwd - sin * strafe) * SPEED * dt;
  frameRenderer.step(world, cam, { animate: true, dt });
  requestAnimationFrame(frame);
}
status.textContent = `${built.info.label} | WASD walk, arrows look`;
globalThis.__helloEngine = { rt, world, cam, ready: true };
requestAnimationFrame(frame);
