// engine/mesh/pointShadowJS.js (ME-16f, note 38.22): JS twin of the GPU point-light shadow pass (oracle for ?gpucompare=pointshadow).
// Per shadowed light: caster list (injected `build`, the compositor wires buildShadowList with box = origin +- radius), then 6 depth-only
// perspective renders (face matrices of render/shadowPoint.js, no polygon offset) into a Float32Array layer (slot*6+face), stored depth
// 0.75 + 0.25 * NDC z (shadowDepthStore, the sun caster convention; cleared = 1). Polygon offset = the sun's depthBias (rctx.depthBias or SUN_SHADOW_DEFAULTS). Publishes `lights.pointShadow`-shaped state {depth, res, slot, O, opts} (what lighting.js lightAt reads).
// Dirty key per slot (pointShadowKey): unchanged -> no re-render (zero alloc in steady state).
import { createRasterTarget, clearRasterTarget, rasterDrawList } from './rasterJS.js';
import { createShadowList } from './shadowList.js';
import { shadowInputHash, SUN_SHADOW_DEFAULTS } from '../render/shadowSun.js';
import { createShadowLightState, selectShadowLights, pointFaceMatrix, pointShadowKey, quantiseOrigin, shadowDepthStore } from '../render/shadowPoint.js';

const MAX_LIGHTS = 64;

/** @param {number} [maxN] max shadow slots (<= 6) */
export function createPointShadowTwin(maxN = 6) {
  return {
    maxN, n: 0, res: 0, target: /** @type {any} */ (null),
    sel: createShadowLightState(maxN),
    lists: [], // lazily one caster list per slot
    holder: new Int32Array(maxN).fill(-1), // light handle whose map is stored in slot s
    keys: new Int32Array(maxN * 2),
    keyValid: new Uint8Array(maxN),
    planes: new Float64Array(24), M: new Float64Array(16), O3: new Float64Array(3), hash: new Int32Array(2), key: new Int32Array(2),
    ctx: { M: null, depthBias: { factor: 0, units: 0 }, structFoot: null, structCount: 0, structMask: null, wind: null, maskAtlas: null },
    stats: { rendered: 0, skipped: 0 }, // slots re-rendered / skipped this call
    out: { depth: new Float32Array(0), res: 0, slot: new Uint8Array(MAX_LIGHTS), O: new Float64Array(maxN * 4), opts: null },
  };
}

function boxPlanes(O, r, p) { // inside n.p + d >= 0: the AABB origin +- r as 6 planes
  for (let a = 0; a < 3; a++) {
    const lo = a * 8, hi = lo + 4;
    p[lo] = p[lo + 1] = p[lo + 2] = p[hi] = p[hi + 1] = p[hi + 2] = 0;
    p[lo + a] = 1; p[lo + 3] = -(O[a] - r);
    p[hi + a] = -1; p[hi + 3] = O[a] + r;
  }
  return p;
}

/**
 * One twin update. Returns the `lights.pointShadow` state, or null when off / nothing selected.
 * @param {any} tw from createPointShadowTwin
 * @param {any} lights LightSet-like (count,on,pos,col,defX/Y/Z,entity)
 * @param {{x:number,y:number,z:number,planes?:Float64Array}} cam
 * @param {{n:number,res:number}} opts resolvePointShadowOptions(...); n === 0 = off
 * @param {(list:any, O:Float64Array, radius:number, planes:Float64Array)=>void} build fills `list` with the casters inside the box
 * @param {any} [rctx] raster ctx extras (structFoot, structCount, wind, maskAtlas)
 */
export function updatePointShadowTwin(tw, lights, cam, opts, build, rctx, structVersion = 0, windKey = 0) {
  const n = Math.min(opts.n | 0, tw.maxN);
  if (n <= 0) return null;
  if (tw.res !== opts.res || tw.n !== n) { // cold: (re)allocate
    tw.res = opts.res; tw.n = n; tw.target = createRasterTarget(opts.res, opts.res, 1, { depthOnly: true });
    tw.out.depth = new Float32Array(n * 6 * opts.res * opts.res); tw.keyValid.fill(0); tw.holder.fill(-1);
  }
  const out = tw.out; out.res = tw.res; out.opts = opts;
  const occ = selectShadowLights(lights, cam, n, tw.sel, opts.hysteresis);
  out.slot.fill(0);
  tw.stats.rendered = 0; tw.stats.skipped = 0;
  if (occ === 0) return null;
  const res = tw.res, layerLen = res * res, ctx = tw.ctx, O3 = tw.O3;
  const db = (rctx && rctx.depthBias) || SUN_SHADOW_DEFAULTS.depthBias; // the GPU point faces inherit the sun caster pipelines' depthBias
  ctx.depthBias.factor = db[0]; ctx.depthBias.units = db[1];
  if (rctx) { ctx.structFoot = rctx.structFoot; ctx.structCount = rctx.structCount; ctx.structMask = rctx.structMask || null; ctx.wind = rctx.wind; ctx.maskAtlas = rctx.maskAtlas; }
  for (let s = 0; s < n; s++) {
    const h = tw.sel.slots[s];
    if (h < 0) { tw.keyValid[s] = 0; tw.holder[s] = -1; continue; }
    const q = opts.originQ || 64;
    O3[0] = quantiseOrigin(lights.defX[h], q); O3[1] = quantiseOrigin(lights.defY[h], q); O3[2] = quantiseOrigin(lights.defZ[h], q);
    const far = lights.pos[h * 4 + 3], o = s * 4;
    out.slot[h] = s + 1; out.O[o] = O3[0]; out.O[o + 1] = O3[1]; out.O[o + 2] = O3[2]; out.O[o + 3] = far;
    if (!tw.lists[s]) tw.lists[s] = createShadowList();
    const list = tw.lists[s];
    build(list, O3, far, boxPlanes(O3, far, tw.planes));
    pointFaceMatrix(O3, far, 0, tw.M, opts.near);
    shadowInputHash(list, tw.M, structVersion, tw.hash, 0.02, windKey);
    pointShadowKey(tw.key, O3[0], O3[1], O3[2], far, tw.hash[0], tw.hash[1], structVersion, windKey, q);
    if (tw.keyValid[s] && tw.keys[s * 2] === tw.key[0] && tw.keys[s * 2 + 1] === tw.key[1]) { tw.stats.skipped++; tw.holder[s] = h; continue; }
    for (let f = 0; f < 6; f++) {
      clearRasterTarget(tw.target);
      pointFaceMatrix(O3, far, f, tw.M, opts.near);
      ctx.M = tw.M;
      rasterDrawList(list, tw.target, ctx);
      const z = tw.target.zbuf, base = (s * 6 + f) * layerLen, d = out.depth;
      for (let i = 0; i < layerLen; i++) d[base + i] = shadowDepthStore(z[i]); // Float32 store rounds like the GPU's depth texture
    }
    tw.keys[s * 2] = tw.key[0]; tw.keys[s * 2 + 1] = tw.key[1]; tw.keyValid[s] = 1; tw.holder[s] = h; tw.stats.rendered++;
  }
  return out;
}
