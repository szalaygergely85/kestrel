// S8-B1-11 (docs/sprints/sprint-8-queue.md, docs/architecture.md 38.8a(17)): the 1000-frame zero-allocation gate for the WG
// frame loop. Drives WgCellPipeline exactly like RenderTargetWebGPU.present() would (frame() then the cell-pass hook) on the
// Node mock device, with sprites/overlay wired (WG-3f) so raster+shadow+resolve+deriv+light+shade+edge+sprites+overlay all run
// every frame, then asserts: after warm-up (A) the mock device creates no new resources (liveCount/createCount flat) and (B)
// the V8 heap does not grow (--expose-gc --max-semi-space-size=64; this file re-spawns itself with the flags like the repo's other zero-alloc gates, see
// engine/mesh/DrawList.test.js / instances.test.js for the same 1000-frame / 64 KB convention).
// Run: node engine/render/gpu/wg/WgCellPipeline.frameAlloc.test.js
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeMockGpuDevice } from '../../../test/assert.js';
import { WgCellPipeline } from './WgCellPipeline.js';
import { bindShading, bindLevel } from '../../MaterialTable.js';
import { loadLevel } from '../../../world/Level.js';
import { loadTestAssets } from '../../../../tools/testing/content-node.mjs';
import { MAX_SPRITES, SPR_STRIDE } from '../../sprites.js';
import paletteModule from '../../../../design/palette.js';
import detailPassModule from '../../../../design/detail-pass.js';

// S8-B1-11 verdict: the per-frame-garbage check reads heapUsed BEFORE any gc, so the semi-space must be big enough that no
// scavenge runs inside the 1000 frames (otherwise garbage is silently collected); the post-gc check stays as the leak check.
const SELF = fileURLToPath(import.meta.url);
const FLAGS = ['--expose-gc', '--max-semi-space-size=64', '--no-concurrent-recompilation']; // sync tier-up: deterministic (a late concurrent compile left some runs at 123 vs 395 B/frame)
const MUTATE = process.env.FRAMEALLOC_MUTATE === '1'; // self-test child: allocates every frame, MUST fail
if (typeof global.gc !== 'function' || !process.execArgv.includes(FLAGS[1])) {
  const res = spawnSync(process.execPath, [...FLAGS, SELF], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++; else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}

// Mock device, with its own record-keeping calls (draw/bind/beginPass/writeTexture/writeBuffer each allocate a small
// bookkeeping object per call in engine/test/assert.js, by design for other tests that inspect `_lastDraw` etc.) replaced by
// plain counters: this test measures the PIPELINE's allocations, not the test harness's.
const mock = makeMockGpuDevice();
const { device, liveCount } = mock;
device.backend = 'webgpu';
let drawCount = 0, bindCount = 0, dispatchCount = 0, writeTexCount = 0, writeBufCount = 0;
device.draw = () => { drawCount++; };
device.bind = () => { bindCount++; };
device.beginPass = () => {};
device.endPass = () => {};
device.dispatch = () => { dispatchCount++; };
device.drawIndirect = () => {};
device.writeTexture = (tex) => { tex._texWrites = (tex._texWrites || 0) + 1; writeTexCount++; };
device.writeBuffer = (handle) => { handle._writes = (handle._writes || 0) + 1; writeBufCount++; };

let hook = null;
const fgTex = device.createTexture({ format: 'rgba8', width: 160, height: 60 });
const bgTex = device.createTexture({ format: 'rgba8', width: 160, height: 60 });
const rt = {
  device, cols: 160, rows: 60, fgTex, bgTex,
  setCellPass(f) { hook = f; },
  setPresentCells() {},
};

const p = new WgCellPipeline(rt, { rays: 1 });
assert.strictEqual(p.ready, true, 'pipeline ready on the mock device');
assert.strictEqual(typeof hook, 'function', 'cell-pass hook installed');

// Real content (same loader every other wg test uses) so shade actually has a material table to pack/bind once.
const palette = paletteModule.default || paletteModule, detailPass = detailPassModule.default || detailPassModule;
const { bundle } = await loadTestAssets();
const table = bindShading(palette, detailPass, 16 / 9);
bindLevel(table, loadLevel(bundle.levels.test_room));
p.bind(table, palette);

// WG-3f: wire sprites + overlay so the full ported pass list (raster, shadow, resolve, deriv, light, shade, edge, sprites,
// overlay) runs every frame, not just the WG-3a/b/c subset - an idle pool/overlay (0 sprites, no dirty rows) like the "idle"
// case WgCellPipeline.test.js already covers.
const pool = { count: 0, spr: new Float32Array(MAX_SPRITES * SPR_STRIDE) };
const atlas = { width: 4, height: 2, data: new Uint8Array(32), pal: new Float32Array(8) };
const overlay = { cols: rt.cols, rows: rt.rows, ovl: new Uint8Array(rt.cols * rt.rows * 4), ovlZ: new Float32Array(rt.cols * rt.rows), stats: { cells: 0 }, minRow: 0, maxRow: -1, prevMinRow: 0, prevMaxRow: -1 };
assert.strictEqual(p.bindSprites({ pool, atlas, palette, particleLayer: null, overlay }), true, 'sprites + overlay wired');
assert.deepStrictEqual(p.portedPasses.slice(-2), ['sprites', 'overlay']);

// A static world/light (same object identity every frame: dirty-checks key on identity/version, not value, so this is the
// "nothing changed" steady state a real game hits most frames) but a camera that actually moves, so the test does not
// accidentally pass just because every input is frozen.
const world = Object.freeze({ structures: Object.freeze([]), structVersion: 1 });
const light = Object.freeze([0.1, 0.2, 0.3]); // ambient only, no sun: keeps the shadow pass a cheap no-op (no caster list)
const cam = { x: 10, y: 20, z: 1.6, yawDeg: 0, pitchDeg: 0 };
const fb = { timeSec: 0 };

let _sink = null;
function stepFrame(i) {
  cam.yawDeg = (i * 7) % 360;
  cam.x = 10 + Math.sin(i * 0.1) * 3;
  cam.y = 20 + Math.cos(i * 0.1) * 3;
  fb.timeSec = i * (1 / 60);
  if (MUTATE) _sink = new Array(128).fill(i); // mutation: ~1 KB (on-heap; typed arrays would be off-heap) of garbage per frame (self-test only)
  p.frame(fb, light, cam, world);
  hook();
}

// Warm-up: the first frame(s) build the material/sky/world-atlas textures (tableUploads, skyBakes, world atlas) - those
// uploads and any one-time lazy allocation must happen here, not in steady state. A short warm-up (tried first: ~60 frames)
// measures mostly V8 JIT noise, not the pipeline: megamorphic call sites across the many pass objects, hidden-class
// transitions and inline-cache tiering take thousands of calls to settle, and until they do `heapUsed` drifts by tens of
// bytes/frame with no real per-frame allocation behind it (confirmed by hand: the same loop measured after a 20k-frame
// warm-up settles to ~0-2 B/frame, noise-sized, both signs). 4000 frames is enough for this pipeline's call sites to tier up.
for (let i = 0; i < 20000; i++) stepFrame(i);
assert.ok(p._cellsShaded, 'warm-up: shade actually ran (table bound, camera+world present)');
assert.ok(drawCount > 0, 'warm-up: passes actually drew');

const liveAfterWarmup = liveCount();
const createAfterWarmup = mock.createCount;

global.gc();
const h0 = process.memoryUsage().heapUsed;
const drawBefore = drawCount, writeTexBefore = writeTexCount, writeBufBefore = writeBufCount, bindBefore = bindCount, dispatchBefore = dispatchCount;

const FRAMES = 1000;
// Verdict target is 16 KB. S8-B1-11b: measured now ~36 B/frame (was ~400): 32 B of it is the two performance.now() HeapNumbers in
// passSprites.run (uploadMs stat); the rest ~4 B. Sprites uploadMs timing is gated off (S8-B1-11c); budget 16 KB.
const GARBAGE_BUDGET = 16 * 1024;
for (let i = 20000; i < 20000 + FRAMES; i++) stepFrame(i);

const h1 = process.memoryUsage().heapUsed; // BEFORE gc: sees per-frame garbage (no scavenge with the 64 MB semi-space)
const garbage = h1 - h0;
global.gc();
const grew = process.memoryUsage().heapUsed - h0; // retained growth (leak check)

ok('WgCellPipeline frame loop: 0 new device resources over 1000 frames (mock liveCount flat)', liveCount() === liveAfterWarmup, `live ${liveAfterWarmup} -> ${liveCount()}`);
ok('WgCellPipeline frame loop: 0 new device resources over 1000 frames (mock createCount flat)', mock.createCount === createAfterWarmup, `createCount ${createAfterWarmup} -> ${mock.createCount}`);
ok('WgCellPipeline frame loop: steady state does not upload textures (no texture/material/world change)', writeTexCount === writeTexBefore, `writeTexCount ${writeTexBefore} -> ${writeTexCount}`);
ok('WgCellPipeline frame loop: steady state writes no buffers (no instanced/cull work queued)', writeBufCount === writeBufBefore, `writeBufCount ${writeBufBefore} -> ${writeBufCount}`);
ok('WgCellPipeline frame loop: passes keep drawing every frame (not silently idling)', drawCount > drawBefore, `draws ${drawBefore} -> ${drawCount}`);
ok('WgCellPipeline frame loop: per-frame garbage < budget over 1000 frames (heapUsed read before gc; target 16 KB)', garbage < GARBAGE_BUDGET, `${garbage} bytes over ${FRAMES} frames (${(garbage / FRAMES).toFixed(1)} B/frame)`);
ok('WgCellPipeline frame loop: no significant retained heap growth over 1000 frames (--expose-gc)', grew < 64 * 1024, `grew by ${grew} bytes over ${FRAMES} frames (${(grew / FRAMES).toFixed(1)} B/frame)`);

p.dispose();

// Self-test (mutation): the same file with a per-frame allocation must FAIL the garbage check.
if (!MUTATE) {
  const r = spawnSync(process.execPath, [...FLAGS, SELF], { env: { ...process.env, FRAMEALLOC_MUTATE: '1' }, encoding: 'utf8' });
  ok('self-test: per-frame allocation mutation is caught', r.status !== 0 && /per-frame garbage/.test(r.stderr || ''), `status ${r.status}`);
}

if (fail > 0) {
  console.error(`FAIL: ${fail} check(s) failed:`);
  for (const f of failures) console.error(' -', f);
  process.exitCode = 1;
} else {
  console.log(`WgCellPipeline.frameAlloc.test.js: all ${pass} checks passed.`);
}
