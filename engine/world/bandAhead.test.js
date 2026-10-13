// engine/world/bandAhead.test.js (WM-02 / OB109-B4, arch 38.58 + 38.59): ring priority, overlap source, pins, idle slice budget, 12-zone walk.
// Run: node --expose-gc engine/world/bandAhead.test.js
import { makeGrid, zoneAt, zoneId, pick } from './bandGrid.js';
import { World } from './World.js';
import { aheadOrder, bestOverlap } from './bandAhead.js';
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
const def0 = (() => { const d = JSON.parse(JSON.stringify(assets.world('world_m1'))); delete d.terrainBand; delete d.terrainBands; return d; })();
const GRID = { cx0: 0, cy0: 0, cx1: 32, cy1: 32, cw: 5, ch: 3, stepX: 2, stepY: 1, ox: 0, oy: 0 };
const mk = (extra, o) => World.load({ ...def0, ...extra }, assets, { detail: true, ...o });
const throws = (extra, re) => { try { mk(extra); return false; } catch (e) { return re.test(e.message); } };

const eq = (a, b) => Buffer.compare(Buffer.from(a.buffer), Buffer.from(b.buffer)) === 0;
const same = (a, b) => a.x0 === b.x0 && a.y0 === b.y0 && a.w === b.w && a.h === b.h && a.minH === b.minH && a.maxH === b.maxH && eq(a.height, b.height) && eq(a.type, b.type) && eq(a.hDraw, b.hDraw);

// --- pure: priority table ---------------------------------------------------------
const g = makeGrid(GRID);
const ids = (ord) => ord.map((e) => `${e.i - 5},${e.j - 10}`);
const ord = [];
let o = ids(aheadOrder(g, 5, 10, 1, 0, 0, 0, ord));
ok('heading east: E first, then NE/SE, then N/S, W last', o[0] === '1,0' && o.slice(1, 3).sort().join() === '1,-1,1,1' && o[7] === '-1,0' && o.length === 8, o.join(' '));
o = ids(aheadOrder(g, 5, 10, 0, -1, 0, 0, ord));
ok('heading north: N first, S last', o[0] === '0,-1' && o[7] === '0,1', o.join(' '));
o = ids(aheadOrder(g, 5, 10, -1, -1, 0, 0, ord));
ok('heading NW: NW first, SE last', o[0] === '-1,-1' && o[7] === '1,1', o.join(' '));
o = aheadOrder(g, 0, 0, 1, 1, 0, 0, ord).map((e) => `${e.i},${e.j}`);
ok('corner zone (0,0): only 3 ring zones, SE first', o.length === 3 && o[0] === '1,1', o.join(' '));
o = ids(aheadOrder(g, 5, 10, 0, 0, 10 * 128 + 5, 10 * 128 + 64, ord));
ok('no heading: nearest zone centre first (pose at west side -> W)', o[0] === '-1,0' || o[0] === '-1,-1' || o[0] === '-1,1', o.join(' '));
const r1 = ids(aheadOrder(g, 5, 10, 0.3, -0.2, 0, 0, ord)).join(), r2 = ids(aheadOrder(g, 5, 10, 0.3, -0.2, 0, 0, ord)).join();
ok('deterministic', r1 === r2);
ok('bestOverlap: largest area wins, none = -1', bestOverlap(new Float64Array([0, 0, 10, 10, 5, 5, 20, 20, 100, 100, 110, 110]), 3, 4, 4, 18, 18) === 1 && bestOverlap(new Float64Array([0, 0, 1, 1]), 1, 5, 5, 6, 6) === -1);
ok('pin validation', (() => { try { makeGrid({ ...GRID, pin: [[99, 0]] }); return false; } catch (e) { return /pin/.test(e.message); } })() && makeGrid({ ...GRID, pin: [[4, 7]] }).pin.length === 1 && makeGrid(GRID).pin.length === 0);

// --- World: 12-zone walk at 6 m/s ---------------------------------------------------
const j0 = 22, x0 = 1344, y0 = j0 * 128 + 64;
const w = World.load({ ...def0, terrainGrid: { ...GRID, pin: [[4, j0]] } }, assets, { detail: true, spawn: { x: x0, y: y0 } });
const cache = w.bandCache;
ok('grid cache cap 32 MB', cache.maxBytes === 32 * 1048576);
const ev = []; w.events = { emit: (n) => ev.push(n) };
const dt = 1 / 60, now = () => performance.now();
const act = [], mk0 = [];
let x = x0, y = y0, swaps = 0, worstIdle = 0, idleN = 0, idleSum = 0, maxBytes = 0, calls = 0;
const frame = (vy) => {
  y += vy * dt;
  const pend = w.bandPending >= 0, ph = w._ahead ? w._ahead.job.phase + (w._ahead.job.st.ready ? 'r' : 't') : 'x';
  const t = now(), r = w.streamBand(x, y, 2), d = now() - t;
  if (r === 2) swaps++;
  if (r === 0 && !pend) { calls++; idleSum += d; idleN++; if (d > worstIdle) worstIdle = d; if (ph !== 'x') act.push(d); else mk0.push(d); }
  if (cache.bytes > maxBytes) maxBytes = cache.bytes;
  return r;
};
for (let n = 0; n < 600; n++) frame(0); // 10 s idle settle (no heading): the ring starts filling
const z0 = w.bandId;
const startBakes = cache.stats().bakes;
let frames = 0;
while (y > y0 - 12 * 128 && frames < 40000) { frame(-6); frames++; }
const st = cache.stats();
ok('walked 12 zone rows north', y <= y0 - 12 * 128 + 1, `y=${y.toFixed(0)} frames=${frames}`);
ok('swaps >= 11, all cache hits (0 sync/sliced bakes in play)', swaps >= 11 && w.bandMisses === 0, `swaps=${swaps} misses=${w.bandMisses}`);
ok('0 band:late', !ev.includes('band:late'));
ok('bake-ahead did the work: bakes > 11', st.bakes - startBakes > 11, String(st.bakes - startBakes));
ok('cache <= maxBytes during the walk', maxBytes <= cache.maxBytes, (maxBytes / 1048576).toFixed(1) + ' MB');
console.log(`  zones ${z0} -> ${w.bandId}; swaps ${swaps}; cache ${(cache.bytes / 1048576).toFixed(1)} MB, ${st.entries} entries, ${st.evictions} evictions; idle streamBand avg ${(idleSum / idleN).toFixed(2)} ms, worst ${worstIdle.toFixed(2)} ms`);
const pc = (a, q) => { a.sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(a.length * q))]; };
const aMax = Math.max(...act), mMax = Math.max(...mk0);
console.log(`  bake-active calls ${act.length}: p50 ${pc(act, .5).toFixed(2)} p95 ${pc(act, .95).toFixed(2)} p99 ${pc(act, .99).toFixed(2)} max ${aMax.toFixed(2)} ms; job-start calls ${mk0.length} max ${mMax.toFixed(2)} ms`);
ok('bake-active call p95 <= 2.3 ms (2 ms budget + one 32-cell slice)', pc(act, .95) <= 2.3, pc(act, .95).toFixed(2));
ok('bake-active call p99 <= 3.5 ms', pc(act, .99) <= 3.5, pc(act, .99).toFixed(2));
ok('job-start call (key + overlap copy, once per zone) <= 8 ms', mMax <= 8, mMax.toFixed(2));
ok('idle slice avg <= 2 ms', idleSum / idleN <= 2, (idleSum / idleN).toFixed(2));
// pins never evicted: shrink the cap hard
const nEnt = st.entries, nEv = st.evictions, pinKey = w._zoneKey(4, j0);
ok('pinned zone cached', cache.has(pinKey) && cache.map.get(pinKey).pinned);
cache.maxBytes = 3 * 1048576; cache.evict(w._bandKey(w._bandCur), null, null);
ok('pin survives eviction, unpinned dropped', cache.has(pinKey) && cache.stats().evictions > nEv && cache.map.size < nEnt, `${cache.map.size} of ${nEnt}`);
cache.maxBytes = 32 * 1048576;
// cached bundle == fresh bake
{
  let pick = null; for (const b of cache.map.values()) if (!b.pinned && b.zone >= 0 && b.key !== w._bandKey(w._bandCur)) { pick = b; break; }
  const gi = Math.floor(pick.zone / g.nj), gj = pick.zone % g.nj, z = zoneAt(g, gi, gj, {});
  const fresh = new Terrain(w.terrain.recipe); fresh.bakeNearBand(z.cx0, z.cy0, z.cw, z.ch);
  const fw = World.load({ ...def0, terrainGrid: GRID }, assets, { detail: true, spawn: { x: (z.cx0 + z.cw / 2) * 128, y: (z.cy0 + z.ch / 2) * 128 } });
  ok('cached bake-ahead bundle == fresh Terrain bake', same(pick.near, fresh.near), `${gi},${gj}`);
  ok('cached bundle scatter/detail == fresh World zone', (pick.scatter ? pick.scatter.count : 0) === (fw.scatter ? fw.scatter.count : 0) && (pick.detail ? pick.detail.count : 0) === (fw.detail ? fw.detail.count : 0), `${fw.bandId}`);
}
console.log(`bandAhead: ${pass} passed, ${fail} failed`);
if (fail) { console.log(failures.join('\n')); process.exit(1); }
