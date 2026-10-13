// engine/world/bandCache.test.js (OB109-B1/B2, arch 38.58): BandBakeJob == ensureBandFor bytes per world_m1 zone; BandCache hit path, LRU, alloc, invalidation.
// Run: node engine/world/bandCache.test.js   (BAKE_BENCH=1 adds wall-clock asserts)
import { World } from './World.js';
import { Terrain } from './Terrain.js';
import { makeOk } from '../test/assert.js';
import { ensureGcChild } from '../test/allocGate.js';
ensureGcChild(); // AUD2-01 (ARCH CHANGES 2026-10-13): heap + slice gates need a fresh --expose-gc child
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
import { BandBakeJob } from './bandBake.js';
import { BandCache } from './bandCache.js';
import { heapGrowth } from '../test/allocGate.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const { assets } = await loadTestAssets();
const def = (() => { const d = { ...assets.world('world_m1') }; delete d.terrainGrid; // WM-05: world_m1 ships terrainGrid; this suite pins the 5 authored zones as terrainBands (== the grid pins)
  d.terrainBands = [{ id: 'east', ch: 3, cw: 5, cx0: 8, cy0: 7 }, { id: 'west', ch: 3, cw: 5, cx0: 6, cy0: 7 }, { id: 'south1', ch: 3, cw: 5, cx0: 8, cy0: 9 }, { id: 'south2', ch: 3, cw: 5, cx0: 8, cy0: 11 }, { id: 'south3', ch: 3, cw: 5, cx0: 8, cy0: 13 }]; return d; })();
const mk = () => World.load(def, assets, { detail: true, physics: 'mesh' });

// independent deep byte-compare (typed arrays by bytes; `version` ignored: set at publish)
function deepEq(a, b, path = '') {
  if (a === b) return null;
  if (ArrayBuffer.isView(a)) return ArrayBuffer.isView(b) && a.constructor === b.constructor && Buffer.compare(Buffer.from(a.buffer, a.byteOffset, a.byteLength), Buffer.from(b.buffer, b.byteOffset, b.byteLength)) === 0 ? null : path + ' (typed array differs)';
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a).filter((k) => k !== 'version'), kb = Object.keys(b).filter((k) => k !== 'version');
    if (ka.length !== kb.length) return path + ' (key count)';
    for (const k of ka) { const r = deepEq(a[k], b[k], path + '.' + k); if (r) return r; }
    return null;
  }
  return Number.isNaN(a) && Number.isNaN(b) ? null : path + ` (${String(a)} != ${String(b)})`;
}
// independent byte total: every distinct typed array reachable from the bundle
function reachBytes(o, seen = new Set()) {
  if (!o || typeof o !== 'object' || seen.has(o)) return 0;
  seen.add(o);
  if (ArrayBuffer.isView(o)) return o.byteLength;
  let n = 0; for (const k of Object.keys(o)) n += reachBytes(o[k], seen);
  return n;
}
const colOf = (w, id) => w.colliders.find((c) => c.id === id) || null;
const centre = (w, z) => [(z.cx0 + z.cw / 2) * w.terrain.chunkSize, (z.cy0 + z.ch / 2) * w.terrain.chunkSize];

// --- B1: job bytes == ensureBandFor bytes, every zone -------------------------------------
const w = mk(), zs = w.terrainBands;
ok('world_m1 has 5 zones, start band cached', zs.length === 5 && w.bandCache.stats().entries === 1);
let mbTotal = 0;
const fresh = [];
const ref = mk(); // reference: ensureBandFor with an empty cache = today's sliced bake path
for (let k = 0; k < zs.length; k++) {
  ref.ensureBandFor(...centre(ref, ref.terrainBands[(k + 1) % zs.length]));
  ref.bandCache.clear();
  ref.ensureBandFor(...centre(ref, ref.terrainBands[k]));
  const z = zs[k];
  const job = BandBakeJob.create(w, z.cx0, z.cy0, z.cw, z.ch, null); job.step(Infinity);
  const b = job.bundle(); fresh.push(b);
  const e1 = deepEq(b.near, ref.terrain.near), e2 = deepEq(b.scatter, ref.scatter), e3 = deepEq(b.detail, ref.detail);
  const e4 = deepEq(b.trunks, colOf(ref, 'scatter:trunks')), e5 = deepEq(b.detailCol, colOf(ref, 'scatter:detail'));
  ok(`job bytes == ensureBandFor: ${z.id}`, !e1 && !e2 && !e3 && !e4 && !e5, `near ${e1}, scatter ${e2}, detail ${e3}, trunks ${e4}, detailCol ${e5}`);
  if (k === 1) { const job2 = BandBakeJob.create(w, z.cx0, z.cy0, z.cw, z.ch, w.terrain.near); job2.step(Infinity); // overlap copy from the live near
    ok(`job with overlap copy == full bake: ${z.id}`, !deepEq(job2.bundle().near, b.near)); }
  mbTotal += reachBytes({ n: b.near, s: b.scatter, d: b.detail, t: b.trunks, c: b.detailCol }) / 1048576;
}
ok('the live band was never touched by the jobs', w.bandId === 'east' && !w.terrain.nearBandPending);
console.log(`byte identity OK for 5 zones; bundles total ${mbTotal.toFixed(2)} MB`);

// --- B2: cache hit path -------------------------------------------------------------------
let bakes = 0; const realBake = w.terrain.util.bake;
w.terrain.util.bake = (...a) => { bakes++; return realBake.apply(w.terrain.util, a); };
let begins = 0; const realBegin = w.terrain.beginNearBand.bind(w.terrain);
w.terrain.beginNearBand = (...a) => { begins++; return realBegin(...a); };
const pts = zs.map((z) => centre(w, z));
for (let k = 1; k < 5; k++) w.ensureBandFor(...pts[k]); // first visit: misses (sliced path), each put
w.ensureBandFor(...pts[0]);
const st = w.bandCache.stats();
ok('first round: 5 entries, all pinned', st.entries === 5 && [...w.bandCache.map.values()].every((b) => b.pinned), JSON.stringify(st));
ok('first round baked terrain rows', bakes > 0 && begins === 4, `bakes ${bakes} begins ${begins}`);
const hitsBefore = st.hits, bakes0 = bakes, begins0 = begins, putBakes = st.bakes;
const seq = [1, 0, 2, 0, 3, 4, 3, 0, 1, 2];
let hitOk = true, swapMax = 0, swapSum = 0;
for (const k of seq) {
  w.ensureBandFor(...pts[k]);
  const bd = w.bandCache.map.get(w._bandKey(k));
  if (w.bandId !== zs[k].id || w.terrain.near !== bd.near || w.scatter !== bd.scatter || w.detail !== bd.detail) hitOk = false;
  swapMax = Math.max(swapMax, w.lastSwapMs); swapSum += w.lastSwapMs;
}
ok('second visit: 0 util.bake / beginNearBand calls, 0 new bakes', bakes === bakes0 && begins === begins0 && w.bandCache.stats().bakes === putBakes, `bakes ${bakes - bakes0}`);
ok('second visit: every swap was a cache hit publishing the cached objects', hitOk && w.bandCache.stats().hits - hitsBefore >= seq.length);
ok('near version bumps on republish', w.terrain.near.version > 3);
console.log(`swap on a hit (JS): avg ${(swapSum / seq.length).toFixed(3)} ms, max ${swapMax.toFixed(3)} ms; cache ${(w.bandCache.stats().bytes / 1048576).toFixed(2)} MB`);
if (process.env.BAKE_BENCH) ok('swap on hit <= 4 ms', swapMax <= 4, swapMax.toFixed(3));
{
  let all = true, sum = 0, why = '';
  for (let k = 0; k < 5; k++) {
    const bd = w.bandCache.map.get(w._bandKey(k)), z = zs[k];
    const f = fresh[k];
    const e = deepEq({ n: bd.near, s: bd.scatter, d: bd.detail, t: bd.trunks, c: bd.detailCol }, { n: f.near, s: f.scatter, d: f.detail, t: f.trunks, c: f.detailCol });
    if (e) { all = false; why = z.id + e; }
    sum += reachBytes({ n: bd.near, s: bd.scatter, d: bd.detail, t: bd.trunks, c: bd.detailCol });
  }
  ok('cached bundles byte-identical to a fresh bake', all, why);
  ok('stats().bytes == summed byteLength', w.bandCache.stats().bytes === sum, `${w.bandCache.stats().bytes} vs ${sum}`);
}
{
  w.ensureBandFor(...pts[0]);
  const run = () => { for (let i = 0; i < 100; i++) w.ensureBandFor(...pts[i & 1]); };
  const g = heapGrowth(run);
  ok('100 east<->west cache-hit swaps: heap growth < 64 KB', g < 65536, `${g} B`);
}

// --- B3: prebakeBands -------------------------------------------------------------------
{
  const pw = mk(), pz = pw.terrainBands, now = () => performance.now();
  ok('prebake: only the start band cached before', pw.bandCache.stats().entries === 1);
  let calls = 0, worst = 0, r = pw.prebakeBands(0);
  // one slice = the longest unit a zero-budget step does (collider builds are indivisible)
  let slice = 0; for (const z of pz) { const j = BandBakeJob.create(pw, z.cx0, z.cy0, z.cw, z.ch, pw.terrain.near); let g = 0, d = false; while (!d && g++ < 5000) { const a = now(); d = j.step(0); slice = Math.max(slice, now() - a); } }
  const t0 = now();
  while (!r.done && calls < 2000) { const a = now(); r = pw.prebakeBands(12); worst = Math.max(worst, now() - a); calls++; }
  ok('prebake done: all 5 zones cached + pinned', r.done && r.cached === pz.length && pw.bandCache.stats().entries === pz.length && [...pw.bandCache.map.values()].every((b) => b.pinned), JSON.stringify(r));
  ok('prebake: each call within budget + one slice', worst <= 12 + slice * 1.5 + 8, `slice ${slice.toFixed(1)} ms, worst ${worst.toFixed(1)} ms, ${calls} calls, total ${(now() - t0).toFixed(0)} ms`);
  ok('prebake: live band untouched', pw.bandId === 'east' && !pw.terrain.nearBandPending && pw.prebakeBands(12).done);
  ok('prebake: cache ~10 MB', pw.bandCache.bytes > 5e6 && pw.bandCache.bytes < 16 * 1048576, String(pw.bandCache.bytes));
  // byte-identical to a fresh sync bake of the same zone
  const ref2 = mk(); const k = 1, zz = pz[k];
  ref2.ensureBandFor(...centre(ref2, ref2.terrainBands[k]));
  ok('prebaked west == ensureBandFor bytes', deepEq(pw.bandCache.get(pw._bandKey(k)).near, ref2.terrain.near) === null && deepEq(pw.bandCache.get(pw._bandKey(k)).scatter, ref2.scatter) === null);
  // walk the route legs: 0 bakes, 0 band:late
  let late = 0, bakes0 = pw.bandCache.stats().bakes; const pub = pw._publishBand.bind(pw); pw._publishBand = (to, l) => { if (l) late++; return pub(to, l); };
  const legs = [4, 1, 2, 3, 0, 1, 2, 3].map((i) => centre(pw, pz[i % pz.length]));
  let swaps = 0;
  for (const [x, y] of legs) { pw.ensureBandFor(x, y); swaps++; for (let f = 0; f < 5; f++) pw.streamBand(x, y, 2); }
  ok('walk legs after prebake: 0 bakes, 0 band:late, all hits', pw.bandCache.stats().bakes === bakes0 && late === 0, `bakes ${pw.bandCache.stats().bakes - bakes0} late ${late} misses ${pw.bandCache.stats().misses}`);
}

// --- LRU unit -----------------------------------------------------------------------------
{
  const mkB = (key, n, pinned = false) => ({ key, zone: 0, near: { x0: 0, y0: 0, w: 1, h: 1, cell: 1, height: new Uint8Array(n) }, scatter: null, detail: null, trunks: null, detailCol: null, classMap: null, bytes: 0, pinned, lastUse: 0 });
  const c = new BandCache({ maxBytes: 250 });
  c.put(mkB('a', 100, true)); c.put(mkB('b', 100)); c.get('b'); c.put(mkB('c', 100));
  ok('LRU: over the cap evicts the unpinned LRU entry, pinned stays', !c.has('b') && c.has('a') && c.has('c') && c.stats().evictions === 1 && c.stats().bytes === 200, JSON.stringify(c.stats()));
  c.put(mkB('d', 100), 'c'); c.put(mkB('e', 100), 'd');
  ok('LRU: protected keys and pinned entries are never evicted', c.has('a') && c.has('e') && c.has('d') && !c.has('c'));
  c.put(mkB('f', 400, true));
  ok('LRU: pinned never evicted even over the cap', c.has('f') && c.has('a'));
}

// --- WM-CACHE-01: farthest-first eviction -------------------------------------------------
{
  const mkF = (key, cx, n, pinned = false) => ({ key, zone: 0, near: { x0: cx - 5, y0: -5, w: 10, h: 10, cell: 1, height: new Uint8Array(n) }, scatter: null, detail: null, trunks: null, detailCol: null, classMap: null, bytes: 0, pinned, lastUse: 0 });
  const c = new BandCache({ maxBytes: 350 });
  c.setFocus(0, 0);
  c.put(mkF('far', 1000, 100)); c.put(mkF('mid', 100, 100)); c.get('far'); // 'far' is MRU: LRU would keep it
  c.put(mkF('near', 10, 100)); c.put(mkF('new', 500, 100));
  ok('farthest evicted first (not LRU)', !c.has('far') && c.has('mid') && c.has('near') && c.has('new') && c.stats().evictions === 1, JSON.stringify(c.stats()));
  const d = new BandCache({ maxBytes: 150 }); d.setFocus(0, 0);
  d.put(mkF('pin', 9000, 100, true)); d.put(mkF('cur', 8000, 100), 'cur'); d.put(mkF('pend', 7000, 100), 'cur', 'pend'); d.put(mkF('n', 1, 100), 'cur', 'pend');
  ok('pinned / current / pending / newest never evicted though farthest', d.has('pin') && d.has('cur') && d.has('pend') && d.has('n'));
  const e = new BandCache({ maxBytes: 250 }); e.setFocus(0, 0);
  e.put(mkF('a', 900, 100)); e.put(mkF('b', 50, 100));
  e.map.get('b').near.height = new Uint8Array(100); e.map.get('b').near.nav = new Uint8Array(100); // simulated nav fill growth
  e.regrow(e.map.get('b'), 'b');
  ok('regrow trims under the cap, farthest first', e.bytes <= 250 && !e.has('a') && e.has('b'), JSON.stringify(e.stats()));
}

// --- editor invalidation -----------------------------------------------------------------
{
  const n0 = w.bandCache.stats().entries, near = w.terrain.near;
  const mx = near.x0 + (near.w * near.cell) / 2, my = near.y0 + (near.h * near.cell) / 2;
  w.terrain.rebakeRect(mx - 2, my - 2, mx + 2, my + 2);
  const n1 = w.bandCache.stats().entries;
  ok('terrain edit drops every overlapping cached band (incl. the current one)', n1 < n0 && !w.bandCache.has(w._bandKey(w._bandCur)), `${n0} -> ${n1}`);
  w.refreshTerrainScatter();
  ok('refreshTerrainScatter re-caches the edited live band', w.bandCache.has(w._bandKey(w._bandCur)) && w.bandCache.map.get(w._bandKey(w._bandCur)).near === w.terrain.near);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f2) => console.error('FAIL:', f2)); process.exit(1); }
console.log('ALL PASS');
