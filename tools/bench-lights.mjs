// tools/bench-lights.mjs - RF17-09: per-frame light CPU cost (selectPlaced + update) with world_m1-like load.
//   node --expose-gc tools/bench-lights.mjs
import { LightSet } from '../engine/render/lighting.js';
const NO = { hzMin: 1, hzMax: 2, amount: 0.15, jitter: 0.05 };
const defs = [];
for (let i = 0; i < 28; i++) defs.push({ x: i * 9, y: (i % 3) * 2, z: 1, hue: [1, 0.7, 0.4], intensity: 1, radius: 6, key: 'P' + i, on: true, flicker: NO });
const ls = new LightSet();
ls.setPool(defs);
// stub world: no structures (vis grids are cached after the first frame, as in play)
const world = { structVersion: 1, structureAt: () => null };
const cam = { x: 0, y: 0, z: 1 };
const FR = 20000;
function run(label, fn) {
  for (let i = 0; i < 2000; i++) fn(i);
  global.gc && global.gc();
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < FR; i++) fn(i);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / FR;
  console.log(label.padEnd(34), (ms * 1000).toFixed(2), 'us/frame');
  return ms;
}
// camera walks 4 m/s at 60 Hz; 3 runtime lights added (player torch, 2 spells)
for (let k = 0; k < 3; k++) ls.add({ x: 5 + k, y: 0, z: 1, hue: [1, 1, 1], intensity: 1, radius: 5, key: 'R' + k, on: true, flicker: NO });
ls.timeBuf[0] = 0;
const total = run('selectPlaced+update (walking)', (i) => {
  cam.x = (i * 0.0667) % 250; ls.selectPlaced(cam);
  ls.timeBuf[0] = i / 60; ls.updateBuffered(world);
});
run('selectPlaced only (walking)', (i) => { cam.x = (i * 0.0667) % 250; ls.selectPlaced(cam); });
run('update only (standing)', (i) => { ls.timeBuf[0] = i / 60; ls.updateBuffered(world); });
console.log('count', ls.count, 'swaps', ls.poolStats.swaps, total < 0.05 ? '=> < 0.05 ms: do NOT optimise' : '=> consider caching');
