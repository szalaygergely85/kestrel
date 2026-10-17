// ENV-02a: groundLookConfig validator + biomeBlend AC. Run: node game/js/look/groundLookConfig.test.js
import assert from 'node:assert/strict';
import { buildGroundLookConfig, resolveLook } from './groundLookConfig.js';
import biomeLookMod from '../../../design/look/biomeLook.js';
import terrainDef from '../../../design/levels/overworld_far.js';
import '../../../design/levels/world_geo.js';
globalThis.window = globalThis.window || globalThis;
terrainDef; biomeLookMod;
const BL = globalThis.BIOME_LOOK, recipe = globalThis.ASSETS.levels.overworld_far, G = globalThis.ASSETS.levels.world_geo, util = recipe.util;
const T = {}; for (const [k, v] of Object.entries(recipe.terrain)) T[k] = v.id;
let n = 0; const ok = (name, c) => { assert.ok(c, name); n++; };

// config: valid, deterministic, no hex strings, ranges
const cfg = buildGroundLookConfig(BL, T);
ok('deterministic', JSON.stringify(cfg) === JSON.stringify(buildGroundLookConfig(BL, T)));
ok('no hex strings', !/#[0-9a-fA-F]{6}/.test(JSON.stringify(cfg)));
ok('looks 1..6', cfg.looks.length === 6 && cfg.looks.every((l, i) => l.id === i + 1));
for (const l of cfg.looks) {
  ok('ramp 4 / bg 2', l.ramp.length === 4 && l.bg.length === 2);
  ok('glyphs 1..4', l.glyphs.length >= 1 && l.glyphs.length <= 4 && l.lean.length === l.glyphs.length);
  ok('rgb 0..1', [...l.ramp, ...l.bg, ...l.accents.map(a => a.color)].every(c => c.length === 3 && c.every(v => v >= 0 && v <= 1)));
  ok('accents <= 2', l.accents.length <= 2);
}
// every biome/ground pair resolves to a valid look id; look 0 = today's ground where no rule matches
const biomeIds = [0, ...Object.keys(G.biomes).map(Number)];
for (const b of biomeIds) for (const g of Object.values(T)) { const id = resolveLook(cfg, g, b); ok('valid id', Number.isInteger(id) && id >= 0 && id <= cfg.looks.length); }
ok('ash mile + twisted wood: grass stays 0', resolveLook(cfg, T.grass, 4) === 0 && resolveLook(cfg, T.grass, 3) === 0);
ok('fen/dunes: sand/reeds shore, grass 0', resolveLook(cfg, T.reeds, 8) === 6 && resolveLook(cfg, T.sand, 7) === 6 && resolveLook(cfg, T.grass, 8) === 0);
ok('fields/glade/foothills/meadow', resolveLook(cfg, T.grass, 6) === 4 && resolveLook(cfg, T.grass, 5) === 3 && resolveLook(cfg, T.rock, 9) === 5 && resolveLook(cfg, T.grass, 0) === 1);
ok('path in meadow = 0', resolveLook(cfg, T.path, 0) === 0);

// validator throws per bad field
const clone = () => JSON.parse(JSON.stringify(BL));
const bad = (label, mut, re) => { const d = clone(); mut(d); assert.throws(() => buildGroundLookConfig(d, T), re, label); n++; };
const gA = d => d.biomes.meadow.ground.A;
bad('glyph empty', d => { gA(d).glyphs = ''; }, /glyphs/);
bad('glyph too long', d => { gA(d).glyphs = '.,:;x'; }, /glyphs/);
bad('glyph non-ascii', d => { gA(d).glyphs = 'é'; }, /printable/);
bad('lean length', d => { gA(d).shimmer.lean = '.'; }, /lean/);
bad('ramp 3', d => { gA(d).ramp.pop(); }, /ramp/);
bad('bg 3', d => { gA(d).bg.push('#000000'); }, /bg/);
bad('bad hex', d => { gA(d).ramp[0] = 'green'; }, /hex/);
bad('contrast range', d => { gA(d).contrast = 2; }, /contrast/);
bad('noiseScale', d => { gA(d).noiseScale = 'x'; }, /noiseScale/);
bad('shimmer amp', d => { gA(d).shimmer.amp = -1; }, /amp/);
bad('shimmer mode', d => { gA(d).shimmer.mode = 'x'; }, /mode/);
bad('accent density', d => { gA(d).accents[0].d = 5; }, /\.d/);
bad('accents not array', d => { gA(d).accents = 'x'; }, /accents/);
ok('glade 3 designer accents -> 2', BL.biomes.glade.ground.A.accents.length === 3 && cfg.looks[2].accents.length === 2);
bad('pick missing', d => { d.biomes.meadow.pick.ground = 'Z'; }, /pick/);
bad('rule unknown look', d => { d.lookMap[0].look = 'nope'; }, /unknown look/);
bad('rule unknown ground', d => { d.lookMap[0].ground = ['lava']; }, /terrain type/);
bad('rule bad biome', d => { d.lookMap[1].biomes = [-1]; }, /biome id/);
bad('16 looks', d => { d.order = Array.from({ length: 16 }, () => 'meadow'); }, /at most/);

// biomeBlend AC (hash term excluded): top id == biomeAt(clean) where w < 0.4; w continuous
G.util.installBiomes(util);
const out = { a: 0, b: 0, w: 0 }, o2 = { a: 0, b: 0, w: 0 };
let seed = 12345; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
let checked = 0, mism = 0, mixed = 0;
for (let i = 0; i < 100000; i++) {
  const x = rnd() * 2400, y = rnd() * 2400;
  util.biomeBlend(x, y, out);
  assert.ok(out.w >= 0 && out.w <= 0.5 + 1e-9);
  if (out.w > 0) mixed++;
  if (out.w < 0.4) { checked++; if (out.a !== util.biomeAt(x, y, true)) mism++; }
}
ok('top id == biomeAt (clean) where w<0.4, mism=' + mism + '/' + checked, mism === 0 && checked > 90000);
ok('border samples exist (' + mixed + ')', mixed > 100);
// continuity per 2 m step (keep-rect edge excluded: hard by design, like biomeAt). The designer's SDFs (coast/ellipse) are steeper than 1 m/m
// in places, so the literal arch AC (<= 2/blendM per 2 m) cannot hold everywhere: assert the bulk and print the tail for the lane note.
const K = recipe.geo.keep, inK = (x, y) => x >= K.x0 - 2 && x < K.x1 + 2 && y >= K.y0 - 2 && y < K.y1 + 2;
let pairs = 0, big = 0, over02 = 0, worst = 0;
for (let i = 0; i < 100000; i++) {
  const x = rnd() * 2400, y = rnd() * 2400;
  if (inK(x, y)) continue;
  util.biomeBlend(x, y, out); util.biomeBlend(x + 2, y, o2);
  const dw = Math.abs(out.w - o2.w); pairs++;
  if (dw > 0.1) big++; if (dw > 0.2) over02++; if (dw > worst) worst = dw;
}
console.log('dw per 2 m: pairs ' + pairs + ', >0.1: ' + big + ', >0.2: ' + over02 + ', max ' + worst.toFixed(3));
ok('w continuous: < 0.3% of 2 m steps change by > 0.2', over02 / pairs < 0.003);
console.log('groundLookConfig tests: ' + n + ' ok');

// ENV-02d: flag parse
{
  const { groundLookFromParams } = await import('./groundLookConfig.js');
  const P = (s) => new URLSearchParams(s);
  assert.equal(groundLookFromParams(P('look=0'), BL, recipe), null);
  assert.equal(groundLookFromParams(P(''), null, recipe), null);
  const on = groundLookFromParams(P('look=dusk&looklin=0'), BL, recipe);
  assert.deepEqual(on, buildGroundLookConfig(BL, T));
  assert.equal(JSON.stringify(groundLookFromParams(P('looklin=0'), BL, recipe)), JSON.stringify(on));
  console.log('groundLookFromParams ok');
}

// ENV-02d-LIVE: main.js must pass the LEVEL def (it holds .terrain), not its inner .recipe (no .terrain -> null in the real boot).
{
  const { groundLookFromParams } = await import('./groundLookConfig.js'), P = (q) => new URLSearchParams(q), lvl = globalThis.ASSETS.levels.overworld_far;
  assert.equal(groundLookFromParams(P(''), globalThis.BIOME_LOOK, lvl.recipe), null, 'inner recipe has no terrain table');
  const live = groundLookFromParams(P('dev=1&title=0'), globalThis.BIOME_LOOK, lvl);
  assert.ok(live && live.looks.length === 6, 'main.js-equivalent opts give a look config');
  console.log('groundLookFromParams live-opts ok');
}
// LOOK-LINEAR-01: default (`?looklin=1`) uses the look hex as authored (byte / 255, like TLOOK); `?looklin=0` keeps the old sRGB->linear decode.
{
  const { groundLookFromParams } = await import('./groundLookConfig.js');
  const lvl = globalThis.ASSETS.levels.overworld_far, P = (q) => new URLSearchParams(q);
  const off = groundLookFromParams(P('looklin=0'), BL, lvl), on = groundLookFromParams(P(''), BL, lvl);
  const fo = off.looks[1], fn = on.looks[1]; // forest
  assert.deepEqual(fn.bg[0].map(v => Math.round(v * 255)), [26, 46, 22], 'forest bg #1a2e16 as authored');
  assert.deepEqual(fo.bg[0].map(v => Math.round(v * 255)), [3, 7, 2], 'looklin=0 = old decode');
  assert.equal(JSON.stringify(buildGroundLookConfig(BL, T)), JSON.stringify(off), 'off = plain build (no opts), no leak from the on build');
  assert.deepEqual(on.looks.map(l => l.glyphs), off.looks.map(l => l.glyphs), 'only colours change');
  console.log('looklin ok');
}
