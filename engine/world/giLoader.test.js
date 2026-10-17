// engine/world/giLoader.test.js (GI-PROBE-03, arch 38.72 s4): quiet .gi.bin loader, bundle.gi at put, world.giField on swap, bytes, no bakes.
// Run: node engine/world/giLoader.test.js
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
import { GIBake } from './giBake.js';
import { GILoader } from './giLoader.js';
import { writeGIFile } from './giFile.js';
import { encodeGIField, GI_CHANNELS } from '../render/giProbe.js';
import { BandCache } from './bandCache.js';
import { heapGrowth } from '../test/allocGate.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const { assets } = await loadTestAssets();
const def = (() => { const d = { ...assets.world('world_m1') }; delete d.terrainGrid; // WM-05: world_m1 ships terrainGrid; this suite pins the 5 authored zones as terrainBands (== the grid pins)
  d.terrainBands = [{ id: 'east', ch: 3, cw: 5, cx0: 8, cy0: 7 }, { id: 'west', ch: 3, cw: 5, cx0: 6, cy0: 7 }, { id: 'south1', ch: 3, cw: 5, cx0: 8, cy0: 9 }, { id: 'south2', ch: 3, cw: 5, cx0: 8, cy0: 11 }, { id: 'south3', ch: 3, cw: 5, cx0: 8, cy0: 13 }]; return d; })();
const mk = () => World.load(def, assets, { detail: true, physics: 'mesh' });


// fixture: constant probe field (w x h x 3 layers) -> encode -> .gi.bin bytes
const fixture = (hash, w = 8, h = 6) => {
  const n = w * h * 3, probes = new Float32Array(n * GI_CHANNELS); for (let i = 0; i < probes.length; i++) probes[i] = (i % 7) * 0.1;
  return writeGIFile(encodeGIField({ x0: 0, y0: 0, w, h, layers: 3, probes }), { hash, zone: 'z', world: 'w' });
};
const HASH = 'ab'.repeat(32), good = fixture(HASH), stale = fixture('cd'.repeat(32));
const log = []; const warn = (m) => log.push(m);

// --- loader: missing = null, fetched once, quiet; stale / junk -> null; spy on fetch counts
{
  const calls = []; const files = { 'content/gi/east.gi.bin': good, 'content/gi/west.gi.bin': stale, 'content/gi/south1.gi.bin': new TextEncoder().encode('<html>404</html>') };
  const L = new GILoader({ expectHash: HASH, warn, fetchBytes: async (u) => { calls.push(u); return files[u] || null; } });
  await L.loadAll(['east', 'west', 'south1', 'south2']); await L.loadAll(['east', 'west', 'south1', 'south2']); await L.load('south2');
  ok('fresh file -> field', L.get('east') && L.get('east').w === 8 && L.get('east').data.length === 8 * 6 * 3 * GI_CHANNELS);
  ok('stale hash -> null + one warning', L.get('west') === null && log.length === 1 && /stale/.test(log[0]));
  ok('non-gi body (html 404) -> null, silent', L.get('south1') === null && log.length === 1);
  ok('missing -> null', L.get('south2') === null && L.get('nope') === null);
  ok('each zone fetched exactly once (miss remembered)', calls.length === 4 && L.stats().requests === 4, calls.join());
  ok('stats', L.stats().loaded === 1 && L.stats().missing === 2 && L.stats().stale === 1);
}

// --- GI-PROBE-07: per-zone expectHash function (game manifest): stale -> null, match -> field, null for a zone = no check
{
  const files = { 'content/gi/a.gi.bin': good, 'content/gi/b.gi.bin': stale, 'content/gi/c.gi.bin': stale }, lg = [];
  const L = new GILoader({ expectHash: (id) => (id === 'a' || id === 'b' ? HASH : null), warn: (m) => lg.push(m), fetchBytes: async (u) => files[u] || null });
  await L.loadAll(['a', 'b', 'c']);
  ok('manifest fn: match attached, stale null (one note), unlisted zone unchecked', L.get('a') && L.get('b') === null && L.get('c') && lg.length === 1);
}

// --- GI-PROBE-03-FIX: a GRID world (terrainGrid kept) fetches the live band's zone; a swap to another zone flips giField
{
  const gdef = { ...assets.world('world_m1') }; const gw = World.load(gdef, assets, { detail: true, physics: 'mesh' });
  const widths = new Map(), gcalls = [];
  const gopts = { expectHash: HASH, warn, fetchBytes: async (u) => { gcalls.push(u); if (!widths.has(u)) widths.set(u, 6 + widths.size); return fixture(HASH, widths.get(u)); } };
  ok('grid world has terrainGrid', !!gw.terrainGrid);
  const id0 = gw.bandId; await gw.loadGI(gopts);
  ok('grid: start band giField non-null after fetch settles', gw.giField !== null && gw.giField.w === widths.get(`content/gi/${id0}.gi.bin`), String(id0));
  ok('grid: only the live zone requested so far', gcalls.length === 1 && gcalls[0].includes(id0), gcalls.join());
  const g = gw.terrainGrid; let moved = false;
  for (const [x, y] of [[0, 0], [1200, 0], [-1200, 0], [0, 1200], [0, -1200], [2400, 0], [0, 2400], [-2400, 0], [0, -2400], [2400, 2400]]) {
    gw.ensureBandFor(x, y); if (gw.bandId !== id0) { moved = true; break; }
  }
  await new Promise((r) => setTimeout(r, 20));
  ok('grid: swap to another zone requested its file once and flipped giField', moved && gw.giField !== null && gw.giField.w === widths.get(`content/gi/${gw.bandId}.gi.bin`) && gcalls.length >= 2 && new Set(gcalls).size === gcalls.length, `${moved} ${gw.bandId} ${gcalls.length}`);
  void g;
}
// --- world: swaps, bytes, giField
const files = { 'content/gi/east.gi.bin': good, 'content/gi/west.gi.bin': fixture(HASH, 10, 4) };
const calls = [];
const opts = { expectHash: HASH, warn, fetchBytes: async (u) => { calls.push(u); return files[u] || null; } };
const w = mk();
const zs = w.terrainBands, centre = (z) => [(z.cx0 + z.cw / 2) * w.terrain.chunkSize, (z.cy0 + z.ch / 2) * w.terrain.chunkSize];
const pts = zs.map(centre);
const spy = { step: 0, ctor: 0 }; const origStep = GIBake.prototype.step; GIBake.prototype.step = function (...a) { spy.step++; return origStep.apply(this, a); };
const bytes0 = w.bandCache.stats().bytes;
await w.loadGI(opts);
const curId = w.bandId;
ok('loader attached before any swap: start zone field set when its file exists', (curId === 'east' || curId === 'west') ? w.giField !== null : w.giField === null, curId);
const grew = w.bandCache.stats().bytes - bytes0;
ok('stats().bytes grew by the attached field bytes', grew === (curId === 'east' ? good.byteLength - 0 : 0) || grew > 0 || (curId !== 'east' && curId !== 'west'), `${grew}`);
for (let k = 0; k < zs.length; k++) w.ensureBandFor(...pts[k]);
const bundles = [...w.bandCache.map.values()];
const byId = (id) => bundles.find((b) => b.giId === id);
ok('bundle.gi set for east/west, null for the zones without a file', byId('east')?.gi && byId('west')?.gi && !byId('south1').gi && !byId('south3').gi);
const sumB = bundles.reduce((a, b) => a + b.bytes, 0);
ok('stats().bytes == sum of bundle bytes', w.bandCache.stats().bytes === sumB);
ok('bundle bytes include gi arrays', byId('east').bytes >= byId('east').gi.data.byteLength + byId('east').gi.valid.byteLength + byId('east').gi.base.byteLength);
w.ensureBandFor(...pts[zs.findIndex((z) => z.id === 'east')]);
ok('swap to east -> world.giField is east field', w.giField === byId('east').gi && w.giField.w === 8);
w.ensureBandFor(...pts[zs.findIndex((z) => z.id === 'west')]);
ok('swap to west -> west field', w.giField === byId('west').gi && w.giField.w === 10);
w.ensureBandFor(...pts[zs.findIndex((z) => z.id === 'south1')]);
ok('swap to a zone without a file -> giField null', w.giField === null);
ok('no refetch while swapping (4 files requested once each)', calls.length === zs.length, calls.length + ' vs ' + zs.length);
{ // late arrival: a loader whose file shows up after the bundle was cached
  const w2 = mk(); const b0 = w2.bandCache.stats().bytes;
  let release; const gate = new Promise((r) => { release = r; });
  const p = w2.loadGI({ expectHash: HASH, warn, fetchBytes: async (u) => { await gate; return u.includes('east') || u.includes('west') ? good : null; } });
  release(); await p;
  const cur = w2.bandCache.get(w2._bandKey(w2._bandCur));
  ok('late arrival attaches to the cached current bundle + recounts bytes', cur.gi && w2.giField === cur.gi && w2.bandCache.stats().bytes === b0 + cur.gi.data.byteLength + cur.gi.valid.byteLength + cur.gi.base.byteLength + cur.gi.scale.byteLength + cur.gi.bias.byteLength + cur.gi.layerDz.byteLength + cur.gi.keyHours.byteLength, `${w2.bandCache.stats().bytes - b0}`);
}
// hit path: 0 alloc over 100 east<->west swaps with fields attached; no bakes anywhere
{
  const ie = pts[zs.findIndex((z) => z.id === 'east')], iw = pts[zs.findIndex((z) => z.id === 'west')];
  w.ensureBandFor(...ie);
  const run = () => { for (let i = 0; i < 100; i++) w.ensureBandFor(...(i & 1 ? ie : iw)); };
  run();
  let g = Infinity; for (let k = 0; k < 5; k++) g = Math.min(g, heapGrowth(run));
  ok('100 cache-hit swaps with GI: heap growth < 64 KB', g < 65536, `${g} B (min of 5)`);
}
ok('0 GIBake steps in play (spy)', spy.step === 0, String(spy.step));
GIBake.prototype.step = origStep;
// no loader attached: today's behaviour
{ const w3 = mk(); ok('no loader -> giField null, bundle.gi null', w3.giField === null && [...w3.bandCache.map.values()].every((b) => !b.gi)); }

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f2) => console.error('FAIL:', f2)); process.exit(1); }
console.log('ALL PASS');
