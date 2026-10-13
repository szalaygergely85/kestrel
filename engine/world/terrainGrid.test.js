// engine/world/terrainGrid.test.js (MAP-10, arch 38.43): generated band grid - zone math, pick/hysteresis walk, World wiring.
// Run: node --expose-gc engine/world/terrainGrid.test.js
import { makeGrid, zoneAt, zoneId, pick } from './bandGrid.js';
import { World } from './World.js';
import { Terrain } from './Terrain.js';
import { makeOk } from '../test/assert.js';
import paletteMod from '../../design/palette.js';
import detailPassMod from '../../design/detail-pass.js';
import terrainDef from '../../design/levels/overworld_far.js';
import lanternMod from '../../design/models/lantern.js';
import leverMod from '../../design/models/lever.js';
import voxelPropsMod from '../../design/models/voxel_props.js';
import boulderMod from '../../design/models/boulder.js';
import rubbleMod from '../../design/models/rubble.js';
import wreckageMod from '../../design/models/wreckage.js';
import relayMod from '../../design/models/relay.js';
import swordMod from '../../design/models/sword.js';
import m3PropsMod from '../../design/models/m3_props.js';
import farTowerMod from '../../design/models/far_tower.js';
import ferrumLightsMod from '../../design/models/ferrum_lights.js';
import { loadTestAssets } from '../../tools/testing/content-node.mjs';

globalThis.window = globalThis.window || globalThis;
paletteMod; detailPassMod; terrainDef; lanternMod; leverMod; boulderMod; rubbleMod; wreckageMod; relayMod; swordMod; voxelPropsMod; m3PropsMod;
farTowerMod; ferrumLightsMod;
let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const { assets } = await loadTestAssets();
const heapMB = () => { if (globalThis.gc) globalThis.gc(); return process.memoryUsage().heapUsed / 1048576; };
const def0 = (() => { const d = JSON.parse(JSON.stringify(assets.world('world_m1'))); delete d.terrainBand; delete d.terrainBands; return d; })();
const GRID = { cx0: 0, cy0: 0, cx1: 32, cy1: 32, cw: 5, ch: 3, stepX: 2, stepY: 1, ox: 0, oy: 0 };
const A = { id: 'east', cx0: 8, cy0: 7, cw: 5, ch: 3 }, B = { id: 'west', cx0: 6, cy0: 7, cw: 5, ch: 3 };
const mk = (extra, o) => World.load({ ...def0, ...extra }, assets, { detail: true, ...o });
const throws = (extra, re) => { try { mk(extra); return false; } catch (e) { return re.test(e.message); } };
const eq = (a, b) => Buffer.compare(Buffer.from(a.buffer), Buffer.from(b.buffer)) === 0;
const same = (a, b) => a.x0 === b.x0 && a.y0 === b.y0 && a.w === b.w && a.h === b.h && a.minH === b.minH && a.maxH === b.maxH && eq(a.height, b.height) && eq(a.type, b.type) && eq(a.hDraw, b.hDraw);

// --- pure bandGrid ---------------------------------------------------------------
const g = makeGrid(GRID);
const z = {};
ok('zone counts 15 x 30', g.ni === 15 && g.nj === 30, g.ni + 'x' + g.nj);
ok('zone (4,7) == east {8,7}; (3,7) == west {6,7}', zoneAt(g, 4, 7, z).cx0 === 8 && z.cy0 === 7 && z.cw === 5 && z.ch === 3 && zoneAt(g, 3, 7, z).cx0 === 6 && z.cy0 === 7);
ok('last zone clamped inside bounds', zoneAt(g, g.ni - 1, g.nj - 1, z).cx0 + 5 <= 32 && z.cy0 + 3 <= 32 && z.cx0 === 27);
ok('id format', zoneId(4, 7) === 'g4_7');
const bad = (o) => { try { makeGrid({ ...GRID, ...o }); return false; } catch (e) { return true; } };
ok('validation: size, step > size, bounds, switch', bad({ cw: 7 }) && bad({ stepX: 6 }) && bad({ cx1: 3 }) && bad({ ox: -1 }) && bad({ switch: { prefetchX: 100, switchX: 112 } }));

const cs = 128, sw = g.switch;
// pending bake assumed ready at once: a code-2 pick swaps immediately
function walk(start, pts) {
  const cur = zoneAt(g, start.i, start.j, {}), out = {}; const swaps = [];
  for (let k = 0; k < pts.length; k++) {
    const r = pick(g, cur, pts[k][0], pts[k][1], out);
    if (r === 2) { swaps.push({ k, from: cur.i + ',' + cur.j, to: out.i + ',' + out.j }); cur.i = out.i; cur.j = out.j; }
  }
  return swaps;
}
const line = (x0, y0, x1, y1, n) => { const a = []; for (let k = 0; k <= n; k++) a.push([x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n]); return a; };
{
  const c = zoneAt(g, 5, 8, {});
  const x0 = (c.cx0 + 2.5) * cs, y0 = (c.cy0 + 1.5) * cs;
  const sx = walk({ i: 5, j: 8 }, line(x0, y0, x0 + 3 * 256, y0, 3 * 256 / 2));
  ok('x walk over 3 pitches: 3 swaps, monotone i, same j', sx.length === 3 && sx.every((s, n) => s.from === (5 + n) + ',8' && s.to === (6 + n) + ',8'), JSON.stringify(sx));
  const sy = walk({ i: 5, j: 8 }, line(x0, y0, x0, y0 + 3 * 128, 3 * 128 / 2));
  ok('y walk over 3 pitches: 3 swaps', sy.length === 3 && sy.every((s, n) => s.to === '5,' + (9 + n)), JSON.stringify(sy));
  const sd = walk({ i: 5, j: 8 }, line(x0, y0, x0 + 3 * 256, y0 + 3 * 128, 3 * 256 / 2));
  let thrash = false; for (let n = 2; n < sd.length; n++) if (sd[n].to === sd[n - 2].from && sd[n].k - sd[n - 2].k < 100) thrash = true;
  ok('diagonal walk over a 3x3 block: 3..6 swaps, no ping-pong', sd.length >= 3 && sd.length <= 6 && !thrash, sd.length + ' ' + JSON.stringify(sd.map((s) => s.to)));
  const back = walk({ i: 8, j: 11 }, line(x0 + 3 * 256, y0 + 3 * 128, x0, y0, 3 * 256 / 2));
  ok('walking back diagonally: <= 6 swaps', back.length <= 6, back.length);
  // corner circle: pose where the current zone sits exactly on both switch thresholds
  const cz = zoneAt(g, 10, 10, {});
  const cx = (cz.cx0 + 5) * cs - sw.switchX, cy = (cz.cy0 + 3) * cs - sw.switchY;
  const pts = []; for (let k = 0; k < 2000; k++) { const a = k * 2 * Math.PI / 400; pts.push([cx + 40 * Math.cos(a), cy + 40 * Math.sin(a)]); }
  const sc = walk({ i: 10, j: 10 }, pts);
  ok('corner circle r40 x 2000 steps: <= 2 swaps total', sc.length <= 2, sc.length + ' ' + JSON.stringify(sc));
  const o = {}, cur0 = zoneAt(g, 0, 0, {});
  ok('world corner: nothing better, keep', pick(g, cur0, 10, 10, o) === 0 && o.i === 0 && o.j === 0);
  ok('zone centre: keep', pick(g, c, x0, y0, o) === 0);
  const cur1 = zoneAt(g, 5, 8, {});
  for (let k = 0; k < 500; k++) pick(g, cur1, x0, y0, o);
  const h0 = heapMB();
  for (let k = 0; k < 10000; k++) pick(g, cur1, x0 + (k & 7), y0, o);
  const d = heapMB() - h0;
  if (globalThis.gc) ok('pick: 10k idle calls < 0.2 MB', d < 0.2, d.toFixed(3) + ' MB' + (globalThis.gc ? '' : ' (no --expose-gc)'));
}

// --- World wiring -------------------------------------------------------------------
ok('terrainGrid + terrainBands -> error', throws({ terrainGrid: GRID, terrainBands: [A] }, /mutually exclusive/));
ok('terrainGrid + terrainBand -> error', throws({ terrainGrid: GRID, terrainBand: A }, /mutually exclusive/));
ok('bad terrainGrid -> error', throws({ terrainGrid: { ...GRID, cw: 9 } }, /terrainGrid/));
const wE = mk({ terrainBands: [A, B] }, { spawn: { x: 1344, y: 1088 } }), wW = mk({ terrainBands: [A, B] }, { spawn: { x: 1088, y: 1088 } });
const gE = mk({ terrainGrid: GRID }, { spawn: { x: 1344, y: 1088 } }), gW = mk({ terrainGrid: GRID }, { spawn: { x: 1088, y: 1088 } });
ok('grid spawn east -> g4_7, bytes == terrainBands east', gE.bandId === 'g4_7' && same(gE.terrain.near, wE.terrain.near), gE.bandId);
ok('grid spawn west -> g3_7, bytes == terrainBands west', gW.bandId === 'g3_7' && same(gW.terrain.near, wW.terrain.near), gW.bandId);
ok('grid world scatter count == terrainBands world', (gE.scatter ? gE.scatter.count : 0) === (wE.scatter ? wE.scatter.count : 0));
ok('grid world: 2 slot zones only', gE.terrainBands.length === 2);

{ // walk east across one crossing, then north
  const w = mk({ terrainGrid: GRID }, { spawn: { x: 1344, y: 1088 } }), T = w.terrain;
  const ev = []; w.events = { emit: (n, p) => ev.push(n + (p && p.to ? ':' + p.to : '')) };
  let swaps = 0, maxStep = 0, live = 0, x = 1344;
  const y = 1088;
  for (let n = 0; n < 4000 && x < 1650; n++) {
    const t = performance.now(); const r = w.streamBand(x, y, 2); maxStep = Math.max(maxStep, performance.now() - t);
    if (r === 2) swaps++;
    live = Math.max(live, 1 + (T.nearBandPending ? 1 : 0));
    x += 2;
  }
  ok('east walk 1344->1650: 1 swap (g4_7 -> g5_7), no band:late', swaps === 1 && w.bandId === 'g5_7' && !ev.includes('band:late'), `${swaps} ${w.bandId} ${ev.join(',')}`);
  ok('max 2 bands live', live <= 2);
  console.log(`  swap frame ${w.lastSwapMs.toFixed(2)} ms, worst streamBand call ${maxStep.toFixed(2)} ms`);
  const cz = w.terrainBands[w._bandCur];
  ok('near band origin == zone origin', T.near.x0 === cz.cx0 * 128 && T.near.y0 === cz.cy0 * 128);
  let y2 = 1088; swaps = 0;
  for (let n = 0; n < 4000 && y2 > 700; n++) { if (w.streamBand(x, y2, 2) === 2) swaps++; y2 -= 2; }
  ok('north walk 1088->700: 1..3 swaps, still column 5', swaps >= 1 && swaps <= 3 && w.bandId.startsWith('g5_'), `${swaps} ${w.bandId}`);
  const fresh = new Terrain(T.recipe); const z2 = w.terrainBands[w._bandCur]; fresh.bakeNearBand(z2.cx0, z2.cy0, z2.cw, z2.ch);
  ok('after walking: near band bytes == fresh bake of that zone', same(T.near, fresh.near));
  ok('ensureBandFor far west: swaps, same pose again false', w.ensureBandFor(900, 1000) === true && w.ensureBandFor(900, 1000) === false);
  const wi = mk({ terrainGrid: GRID }, { spawn: { x: 1344, y: 1088 } });
  for (let n = 0; n < 200; n++) wi.streamBand(1344, 1088, 2);
  const h0 = heapMB();
  for (let n = 0; n < 10000; n++) wi.streamBand(1344 + (n & 7), 1088, 2);
  const d = heapMB() - h0;
  if (globalThis.gc) ok('idle streamBand (grid): 10k calls < 0.2 MB', d < 0.2, d.toFixed(3) + ' MB' + (globalThis.gc ? '' : ' (no --expose-gc)'));
}

console.log(`terrainGrid: ${pass} passed, ${fail} failed`);
if (fail) { console.log(failures.join('\n')); process.exit(1); }
