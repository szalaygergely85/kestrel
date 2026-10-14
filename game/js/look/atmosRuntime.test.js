// ENV-03c fix: atmosRuntime glue. Run: node game/js/look/atmosRuntime.test.js
import assert from 'node:assert/strict';
import palette from '../../../design/palette.js';
import biomeLookMod from '../../../design/look/biomeLook.js';
import { buildAtmosConfig } from './atmosConfig.js';
import { createAtmosRuntime } from './atmosRuntime.js';
globalThis.window = globalThis.window || globalThis;
biomeLookMod;
const BL = globalThis.BIOME_LOOK;
const fresh = () => ({ ...palette, rgb: { ...palette.rgb }, hue: { ...palette.hue }, fog: { ...palette.fog } });
const mkWorld = (sector) => ({ terrain: { util: { biomeBlend: (x, y, o) => { o.a = 0; o.b = 0; o.w = 0; } } }, sectorAt: () => sector.v });
let n = 0; const ok = (m, c) => { assert.ok(c, m); n++; };

// (1) reset on creation / disabled / no terrain: a stale biome fog from a previous world is removed
{
  const P = fresh(), sec = { v: null };
  const rt = createAtmosRuntime(BL, P, mkWorld(sec));
  ok('runtime created', !!rt);
  rt.step({ x: 5, y: 5 }, 12, 0.016);
  ok('fog live after step', P.fog.far !== P.fog.farBase);
  ok('disabled -> null + palette reset', createAtmosRuntime(BL, P, mkWorld(sec), true) === null && P.fog.far === P.fog.farBase);
  rt.step({ x: 5, y: 5 }, 12, 0.016);
  rt.step({ x: 5, y: 5 }, 13, 0.016); // may or may not bump; force live again
  createAtmosRuntime(BL, P, { terrain: null });
  ok('no terrain -> palette reset', P.fog.far === P.fog.farBase);
  const rt2 = createAtmosRuntime(BL, P, mkWorld(sec)); rt2.step({ x: 5, y: 5 }, 12, 0.016);
  rt2.dispose(); ok('dispose resets', P.fog.far === P.fog.farBase && P.atmosLive === null);
}
// (2) snap at creation and on a > 50 m jump: the mock biome depends on x (x > 100 -> another biome), so the target weights differ
{
  const cfg = buildAtmosConfig(BL); let idA = -1, idB = -1;
  for (let i = 0; i < cfg.biomeToEntry.length; i++) { const e = cfg.biomeToEntry[i]; if (e < 0) continue; if (idA < 0) idA = i; else if (e !== cfg.biomeToEntry[idA]) { idB = i; break; } }
  ok('two biome ids map to distinct atmos entries', idA >= 0 && idB >= 0);
  const sig = (st) => JSON.stringify(st, (k, v) => (k === 'version' || k === '_lut' ? undefined : v));
  const mk = (sec) => ({ terrain: { util: { biomeBlend: (x, y, o) => { o.a = x > 100 ? idB : idA; o.b = o.a; o.w = 0; } } }, sectorAt: () => sec.v });
  const run = (x) => { const P = fresh(), r = createAtmosRuntime(BL, P, mk({ v: null })); r.step({ x, y: 0 }, 12, 0.016); return r.state; };
  const sA = run(0), sB = run(200);
  ok('snapped at creation', sA.on && sA.fogFull > 0 && sA.fogFull < 1500);
  const differs = sA.fogFull !== sB.fogFull || sA.fogNear !== sB.fogNear || sA.hazeA !== sB.hazeA;
  const P = fresh(), rt = createAtmosRuntime(BL, P, mk({ v: null }));
  rt.step({ x: 0, y: 0 }, 12, 0.016);
  const before = sig(rt.state);
  rt.step({ x: 200, y: 0 }, 12, 0.016); // ONE step after a 200 m jump
  ok('mock biomes yield different atmosphere states', sig(sA) !== sig(sB));
  ok('200 m jump: state is at the new target after 1 step (no fade)', sig(rt.state) === sig(sB) && sig(rt.state) !== before);
  void differs;
}
// (3) outdoor flag follows world.sectorAt
{
  const P = fresh(), sec = { v: null };
  const rt = createAtmosRuntime(BL, P, mkWorld(sec));
  rt.step({ x: 0, y: 0 }, 12, 0.016);
  const out = rt.state.fogFull;
  sec.v = { id: 'tower' };
  for (let i = 0; i < 400; i++) rt.step({ x: 0, y: 0 }, 12, 0.016);
  ok('indoors: atmosphere fades to none (state differs)', rt.state.fogFull !== out);
  sec.v = null;
  for (let i = 0; i < 400; i++) rt.step({ x: 0, y: 0 }, 12, 0.016);
  ok('outdoors again: atmosphere back', rt.state.on && Math.abs(rt.state.fogFull - out) < 1e-6);
}
console.log('atmosRuntime.test.js: ' + n + ' checks OK');
