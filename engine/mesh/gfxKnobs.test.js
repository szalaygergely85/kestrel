// GFX-03 (engine knobs for the quality presets). Run: node engine/mesh/gfxKnobs.test.js
// Knobs: shadows.sun 'off' + resolveShadowLevel, scatter density, lodScale, tuft drawScale. Defaults = unchanged, clamps, determinism.
import assert from 'node:assert/strict';
import { GFX_DEFAULTS, resolveGfxKnobs, placementHash01, keepPlacement } from './gfxKnobs.js';
import { bindDetailInstances, feedDetail } from './scatterFeed.js';
import { InstanceGroups } from './instances.js';
import { bindScatterInstances, createEngine } from '../core/engine.js';
import * as pub from '../index.js';
import { SUN_OFF_MATRIX, resolveSunShadowOptions, resolveShadowLevel, SHADOW_LEVELS, sunShadowTaps } from '../render/shadowSun.js';
import { lightAt, lightFlags } from '../render/lighting.js';
import { WgShadowPass } from '../render/gpu/wg/passShadow.js';
import { makeMockGpuDevice } from '../test/assert.js';

let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

// ---- option resolution + clamps -------------------------------------------------------------------------------------
eq(resolveGfxKnobs(), { scatterDensity: 1, lodScale: 1, tuftDrawScale: 1 }); eq(resolveGfxKnobs(null), { ...GFX_DEFAULTS });
eq(resolveGfxKnobs({ scatterDensity: -3, lodScale: 99, tuftDrawScale: 0 }), { scatterDensity: 0, lodScale: 4, tuftDrawScale: 0.25 }, 'clamped');
eq(resolveGfxKnobs({ scatterDensity: 7, lodScale: 0, tuftDrawScale: 50 }), { scatterDensity: 1, lodScale: 0.25, tuftDrawScale: 2 });
eq(resolveGfxKnobs({ scatterDensity: NaN, lodScale: 'x', tuftDrawScale: Infinity }), { scatterDensity: 1, lodScale: 1, tuftDrawScale: 1 }, 'non-finite = default');
ok(pub.resolveGfxKnobs === resolveGfxKnobs && pub.resolveShadowLevel === resolveShadowLevel && pub.GFX_DEFAULTS, 'public entry exports');
const ctx = { createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }) };
globalThis.window = { innerWidth: 0, innerHeight: 0, addEventListener() {} };
globalThis.document = { createElement: () => ({ getContext: () => ctx }) };
const mkEngine = (extra) => createEngine({ canvas: { getContext: () => ctx }, assets: {}, gpu: false, force2d: true, inputTarget: window, ...extra });
eq({ ...mkEngine({ gfx: { lodScale: 2, scatterDensity: 5 } }).gfx }, { scatterDensity: 1, lodScale: 2, tuftDrawScale: 1 }, 'createEngine({ gfx }) resolves + clamps into engine.gfx');
ok(Object.isFrozen(mkEngine().gfx)); eq({ ...mkEngine().gfx }, { ...GFX_DEFAULTS }, 'engine default');

// ---- placement hash: deterministic, monotone ------------------------------------------------------------------------
{
  ok(placementHash01(1.5, -2.25, 3) === placementHash01(1.5, -2.25, 3), 'deterministic');
  const pts = Array.from({ length: 4000 }, (_, i) => [((i * 37) % 997) * 0.31, ((i * 91) % 883) * 0.27 - 50, i]);
  const kept = (d) => new Set(pts.filter(([x, y, i]) => keepPlacement(x, y, i, d)).map(p => p[2]));
  eq(kept(1).size, pts.length, 'density 1 keeps all'); eq(kept(0).size, 0, 'density 0 keeps none');
  let prev = new Set();
  for (const d of [0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
    const k = kept(d);
    ok([...prev].every(i => k.has(i)), `density ${d} keeps a superset of the lower density`);
    if (d < 1) ok(Math.abs(k.size / pts.length - d) < 0.05, `density ${d} keeps ~${d} (${k.size / pts.length})`);
    prev = k;
  }
  eq([...kept(0.4)], [...kept(0.4)], 'repeatable');
}

// ---- tree scatter (bindScatterInstances): default unchanged, density thins by hash, lodScale ------------------------
{
  const N = 600, x = new Float64Array(N), y = new Float64Array(N), z = new Float64Array(N), yaw = new Int16Array(N), sp = new Uint8Array(N);
  for (let i = 0; i < N; i++) { x[i] = (i * 13) % 211 + 0.25; y[i] = (i * 29) % 197 - 0.5; z[i] = 1; yaw[i] = (i * 7) % 360; sp[i] = i % 3 === 0 ? 0 : 1; }
  const cfg = { seed: 1, cellM: 6, jitter: 1, fill: 1, maxTrees: 1500, lodCells: 6, species: [{ model: 'oak', weight: 1, trunkR: 0.4, trunkH: 3 }, { model: 'birch', weight: 1, trunkR: 0.4, trunkH: 3 }] };
  const world = { scatter: { count: N, x, y, z, yawDeg: yaw, species: sp }, terrain: { recipe: { recipe: { forest: { trees: cfg } } } } };
  const mk = () => { const g = new InstanceGroups(); g.bindPool({ models: new Map([['oak', {}], ['birch', {}]]) }); return g; };
  const ids = (groups) => new Set(groups.flatMap(g => Array.from({ length: g.count }, (_, k) => g.ib.u32[k * 16 + 12])));
  const base = bindScatterInstances(world, mk()), same = bindScatterInstances(world, mk(), [], null, { scatterDensity: 1, lodScale: 1 });
  eq([...ids(base)], [...ids(same)], 'defaults unchanged'); eq(base.map(g => [g.count, g.lodCells]), same.map(g => [g.count, g.lodCells]));
  eq(ids(base).size, N); ok(base.every(g => g.lodCells === 6));
  const half = bindScatterInstances(world, mk(), [], null, { scatterDensity: 0.5 }), quarter = bindScatterInstances(world, mk(), [], null, { scatterDensity: 0.25 });
  const ih = ids(half), iq = ids(quarter);
  ok(ih.size > N * 0.4 && ih.size < N * 0.6, `half ${ih.size}`); ok([...iq].every(i => ih.has(i)) && iq.size < ih.size, 'lower density = subset');
  ok(half.every(g => g.ib.capacity === g.count), 'groups sized to the thinned count');
  eq([...ids(bindScatterInstances(world, mk(), [], null, { scatterDensity: 0.5 }))], [...ih], 'same input = same set');
  eq(bindScatterInstances(world, mk(), [], null, { scatterDensity: 0 }).length, 0, 'density 0: no groups');
  ok(bindScatterInstances(world, mk(), [], null, { lodScale: 2 }).every(g => g.lodCells === 3), 'lodScale 2 halves the lodCells threshold = doubles the switch distance');
  ok(bindScatterInstances(world, mk(), [], null, { lodScale: 0.5 }).every(g => g.lodCells === 12));
  ok(bindScatterInstances(world, mk(), [], null, { lodScale: 1000 }).every(g => g.lodCells === 1.5), 'lodScale clamps at 4');
}

// ---- detail tufts (bindDetailInstances / feedDetail): density, lodScale, drawScale ---------------------------------------
{
  const points = [], tileStart = [0], tileM = 4, tx0 = -3, ty0 = -4, tilesX = 8, tilesY = 7;
  for (let ty = 0; ty < tilesY; ty++) for (let tx = 0; tx < tilesX; tx++) {
    for (let n = 0; n < 12; n++) points.push({ x: (tx0 + tx) * tileM + (n % 4) + 0.125, y: (ty0 + ty) * tileM + Math.floor(n / 4) + 0.75, z: 0, yawDeg: n * 30, species: n % 2, r2: (7 + n * 0.5) ** 2 });
    tileStart.push(points.length);
  }
  const detail = { count: points.length, tileM, tx0, ty0, tilesX, tilesY, tileStart: Uint32Array.from(tileStart),
    speciesDefs: [{ model: 'tuft', shadow: false, lodCells: 4 }, { model: 'rock', shadow: true, lodCells: 6 }],
    x: Float64Array.from(points, p => p.x), y: Float64Array.from(points, p => p.y), z: Float64Array.from(points, p => p.z),
    yawDeg: Int16Array.from(points, p => p.yawDeg), species: Uint16Array.from(points, p => p.species), r2: Float32Array.from(points, p => p.r2) };
  const cfg = { maxDraw: 4000, refeedM: 4, layers: [{ drawM: 13 }] };
  const mk = () => { const g = new InstanceGroups(); g.bindPool({ models: new Map([['tuft', {}], ['rock', {}]]) }); return g; };
  const feed = (gfx) => {
    const b = bindDetailInstances(detail, mk(), cfg, 0, gfx), n = feedDetail(b, 0, 0, true), set = new Set();
    for (const g of b.groups) for (let k = 0; k < g.count; k++) set.add(g.ib.u32[k * 16 + 12]);
    return { b, n, set };
  };
  const base = feed(undefined), same = feed({ scatterDensity: 1, lodScale: 1, tuftDrawScale: 1 });
  eq([...base.set], [...same.set], 'defaults unchanged (same instances, same order)'); ok(base.n > 100);
  eq(base.b.groups.map(g => g.lodCells), [4, 6]);
  const h = feed({ scatterDensity: 0.5 }), q = feed({ scatterDensity: 0.25 });
  ok(h.n < base.n && q.n < h.n && [...q.set].every(i => h.set.has(i)) && [...h.set].every(i => base.set.has(i)), `detail density thins as subsets (${q.n} < ${h.n} < ${base.n})`);
  eq(feed({ scatterDensity: 0 }).n, 0);
  eq(feed({ lodScale: 2 }).b.groups.map(g => g.lodCells), [2, 3], 'lodScale 2 on tufts');
  const wide = feed({ tuftDrawScale: 2 }), narrow = feed({ tuftDrawScale: 0.5 });
  ok(narrow.n < base.n && base.n < wide.n, `drawScale moves the draw distance (${narrow.n} < ${base.n} < ${wide.n})`);
  ok([...narrow.set].every(i => base.set.has(i)) && [...base.set].every(i => wide.set.has(i)), 'draw sets nest');
  eq(feed({ tuftDrawScale: 99 }).n, wide.n, 'drawScale clamps at 2');
}

// ---- shadows: 'off', levels ------------------------------------------------------------------------------------------------
{
  const def = resolveSunShadowOptions(undefined, 'mesh'), off = resolveSunShadowOptions({ sun: 'off' }, 'mesh');
  eq(def.sun, 'map'); eq(off.sun, 'off');
  assert.throws(() => resolveSunShadowOptions({ sun: 'off' }, 'dda'), /needs renderer 'mesh'/); checks++;
  eq([...SHADOW_LEVELS], ['off', 'low', 'mid', 'high']); ok(Object.isFrozen(SHADOW_LEVELS));
  eq(resolveSunShadowOptions(resolveShadowLevel('high'), 'mesh'), def, "'high' == today's defaults");
  eq(resolveShadowLevel('off'), { sun: 'off' });
  for (const lv of ['low', 'mid']) {
    const o = resolveSunShadowOptions(resolveShadowLevel(lv), 'mesh');
    ok(o.sun === 'map' && o.res < def.res && o.res % 2 === 0 && o.instCastM < def.instCastM && o.meshLod0M < def.meshLod0M && o.meshCastM > 0 && o.meshCastCap < 64 && o.meshLod0M <= o.instCastM, `${lv} is cheaper than high and valid`);
  }
  const lo = resolveSunShadowOptions(resolveShadowLevel('low'), 'mesh'), mid = resolveSunShadowOptions(resolveShadowLevel('mid'), 'mesh');
  ok(lo.res < mid.res && lo.instCastM < mid.instCastM && lo.meshCastCap < mid.meshCastCap, 'low < mid');
  assert.throws(() => resolveShadowLevel('ultra'), /unknown level/); checks++;

  // JS twin: sun off = everything sunlit, no map
  ok(sunShadowTaps(null, SUN_OFF_MATRIX, [10, 20, 3], [0, 0, 1], off) === 4 && sunShadowTaps(null, SUN_OFF_MATRIX, [-5e4, 7e3, -9], [0, 1, 0], off) === 4, 'off matrix: every receiver is outside the box (4 taps)');
  const lights = { count: 0, ambient: [0.1, 0.1, 0.1], on: [], pos: new Float32Array(4), col: new Float32Array(4), sun: { on: true, dir: [0, 0, 1], col: [1, 0.5, 0.25] } };
  const out = [0, 0, 0];
  lightAt(lights, null, 3, 4, 5, 0, 0, 1, out, null, 0, false, { map: null, M: SUN_OFF_MATRIX, opts: off });
  ok(Math.abs(out[0] - 1.1) < 1e-9 && Math.abs(out[1] - 0.6) < 1e-9 && lightFlags.sunlit === 1 && lightFlags.sunN === 4, 'JS twin: sun lights N.L, sunlit flag, no shadow lookup');

  // WebGPU: no shadow pass / textures / pipelines; run() publishes the sun-mode-2 inputs only
  const mock = makeMockGpuDevice(), d = mock.device;
  const passes = []; d.beginPass = (t) => passes.push(t);
  const sh = new WgShadowPass(d, { shadows: { sun: 'off' } });
  ok(sh.off && !sh.enabled && sh.depthTex === null && sh.pipes.length === 0, "'off': no depth texture, no pipelines");
  const p = { _light: { sun: { on: true } }, _cam: {}, _world: {} };
  ok(sh.run(p, null) === true && sh.active && sh.draws === 0 && passes.length === 0, 'run: active (light sunMode 2) but no pass issued');
  const lp = sh.lightParams();
  ok(lp.active && lp.texture === null && Array.from(lp.matrix).every((v, i) => v === SUN_OFF_MATRIX[i]), 'light params: off matrix, no texture (passLight binds the dummy)');
  p._light.sun.on = false; ok(sh.run(p, null) === false && !sh.active, 'sun off in the world: inactive');
  const sh2 = new WgShadowPass(d, { shadows: { sun: 'map', res: 64 } });
  ok(sh2.enabled && !sh2.off && sh2.depthTex, 'map unchanged'); sh2.dispose(); sh.dispose();
}

console.log(`gfxKnobs.test.js: ${checks} checks OK`);
