// engine/render/waterComposite.alloc.test.js (WATER-ALLOC-01): the JS-twin water composite allocates ~0 B per call after warm-up
// (was ~17 KB/call: double args / returns of non-inlined calls boxed HeapNumbers per cell). Measured on the V8 young generation with a
// large semi-space so no scavenge runs mid-measure (same re-spawn flags as lighting.alloc.test.js). Tolerance 1 KB per call.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import v8 from 'node:v8';
const SELF = fileURLToPath(import.meta.url);
const FLAGS = ['--expose-gc', '--max-semi-space-size=64', '--min-semi-space-size=64', '--no-concurrent-recompilation'];
if (typeof global.gc !== 'function' || !process.execArgv.includes(FLAGS[1])) {
  const res = spawnSync(process.execPath, [...FLAGS, SELF], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}
const newUsed = () => { const s = v8.getHeapSpaceStatistics(); for (let i = 0; i < s.length; i++) if (s[i].space_name === 'new_space') return s[i].space_used_size; return 0; };
const { World } = await import('../world/World.js');
const { CellBuffer } = await import('./CellBuffer.js');
const { DepthBuffer } = await import('./DepthBuffer.js');
const { GBuffer } = await import('./GBuffer.js');
const { bindShading, bindLevel } = await import('./MaterialTable.js');
const { renderWorld } = await import('./compositor.js');
const { makeLightBuffer } = await import('./lighting.js');
const { waterCompositeJS } = await import('./waterComposite.js');
const { resolveWaterLooks } = await import('./waterLook.js');
const { createPitchedTerms, pitchedTermsInto, projTerms } = await import('./projection.js');
const { default: paletteMod } = await import('../../design/palette.js');
const { default: detailPassMod } = await import('../../design/detail-pass.js');
const { loadTestAssets } = await import('../../tools/testing/content-node.mjs');
globalThis.window = globalThis.window || globalThis; paletteMod; detailPassMod;
const { assets } = await loadTestAssets();

const W = 240, H = 90, CALLS = 600, WARM = 100, LIMIT = 1024;
const def = { terrain: null, structures: [{ id: 'test_room', level: 'test_room', origin: { x: 0, y: 0, z: 0 }, yawSteps: 0 }], entities: [], water: [{ id: 'pool', shape: 'rect', rect: [2, 2, 9, 9], z: 0.4 }] };
const world = World.load(def, assets, {});
const matTable = bindShading(assets.palette, assets.detailPass, 1); bindLevel(matTable, world.structures[0].level);
const fb = { rt: new CellBuffer(W, H), depth: new DepthBuffer(W, H), palette: assets.palette, gbuf: new GBuffer(W, H), matTable, light: makeLightBuffer(W, H), timeSec: 0, loop: { stats: {} }, renderer: 'mesh' };
fb.waterLooks = resolveWaterLooks({ water: { opaqueAt: 3, seeThrough: 0.6, causticK: 0.4, reflScreenK: 0.7 } }); // finish keys on: the heaviest path
const grid = { cols: W, rows: H, pxCellW: 1, pxCellH: 1 };
let fail = 0;
for (const pose of [{ x: 5.5, y: 5.5, z: 1.6, yawDeg: 40, pitchDeg: -25, projection: 'shear' }, { x: 1.2, y: 5.5, z: 1.3, yawDeg: 90, pitchDeg: -8, projection: 'pitched' }]) {
  renderWorld(fb, world, pose); renderWorld(fb, world, pose);
  const terms = projTerms(pose, grid, {}), pt = createPitchedTerms(), pitched = pose.projection === 'pitched';
  if (pitched) pitchedTermsInto(pt, pose, grid, {});
  const run = (n, t0) => { for (let i = 0; i < n; i++) { fb.timeSec = t0 + i * 0.016; waterCompositeJS(fb, world, terms, pt, pitched, false); waterCompositeJS(fb, world, terms, pt, pitched, true); } };
  run(WARM, 0); global.gc();
  const b0 = newUsed(); run(CALLS, 2);
  const per = (newUsed() - b0) / (2 * CALLS); // bytes per composite call (surface + sky)
  const okk = per <= LIMIT; if (!okk) fail++;
  console.log(`${okk ? 'ok  ' : 'FAIL'} ${pose.projection}: ${per.toFixed(0)} B/call over ${2 * CALLS} calls (limit ${LIMIT})`);
}
console.log(`\nwaterComposite.alloc.test: ${fail ? 'FAILED' : 'passed'}`);
process.exit(fail ? 1 : 0);
