// ENV-03c fix: atmosRuntime glue. Run: node game/js/look/atmosRuntime.test.js
import assert from 'node:assert/strict';
import palette from '../../../design/palette.js';
import biomeLookMod from '../../../design/look/biomeLook.js';
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
// (2) snap at creation (first step is at the target) and on a > 50 m teleport
{
  const P = fresh(), sec = { v: null };
  const rt = createAtmosRuntime(BL, P, mkWorld(sec));
  rt.step({ x: 0, y: 0 }, 12, 0.016);
  ok('snapped at creation', rt.state.on && rt.state.fogFull > 0 && rt.state.fogFull < 1500);
  const w = rt.state.fogFull;
  rt.step({ x: 200, y: 0 }, 12, 0.016);
  ok('teleport > 50 m does not throw / stays valid', Number.isFinite(rt.state.fogFull) && rt.state.fogFull > 0 && w > 0 && rt.state.fogFull === w);
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
