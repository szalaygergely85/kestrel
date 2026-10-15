// CONTACT-AO-01c + CANOPY-SHAFT-01c (arch 38.76/38.78, D-107): game hookup of contact AO blobs and sun shafts.
// Rule (arch ruling): `lights.cao` / `lights.shaft` stay null on the Canvas2D/JS gameplay path and at low/medium; WebGPU high+ only.
// Presets data drive it (knobs.contactAO, knobs.shaftSteps). `?cao=0` / `?shafts=0` switch off; `?shafts=<k>` sets the strength.
import { createContactAO, setDynamicBlobs, buildContactBlobs, CAO_MAX, SHAFT_DEFAULTS } from '../../engine/index.js';

export const SHAFT_K_DEFAULT = 0.25;
// FX-TUNE-01 (D-107): shaft strength follows sun elevation (strong at low sun, ~0 at noon) and forest density. Data: look field wins.
export const SHAFT_LOOK = { kMax: 0.7, kNoon: 0.06, elevLow: 12, elevHigh: 55, pw: 2.5, treesFull: 40 };
/** Pure: k for a sun elevation (deg) and the tree count in the candidate cache; kOver (URL ?shafts=) wins. */
export function shaftKFor(elevDeg, trees, kOver, L = SHAFT_LOOK) {
  if (kOver > 0) return kOver;
  const t = Math.min(1, Math.max(0, (L.elevHigh - elevDeg) / (L.elevHigh - L.elevLow)));
  const f = 0.5 + 0.5 * Math.min(1, trees / L.treesFull);
  return (L.kNoon + (L.kMax - L.kNoon) * t * t * (3 - 2 * t)) * f;
} // used when the atmos state carries no shaftK (forest ~0.35, meadow ~0.08 come with the look data)
export const TREE_TRUNK_M = 0.3, TREE_K = 2.5; // 38.78 item 2: trunk radius x treeK, never the crown
const REFRESH_M = 4, CAND_MAX = 512, STATIC_R = 24, PROP_K = 0.6, PROP_MAX_SPAN = 12;

/** -> { cao: bool, shaft: null | {steps, k} } for a backend ('webgpu' only) + preset knobs + URL params. Pure. */
export function resolveFx(params, backend, knobs) {
  const gpu = backend === 'webgpu' && !params.get('gpucompare') && !!knobs;
  const cao = gpu && knobs.contactAO === true && params.get('cao') !== '0';
  const sp = params.get('shafts');
  const steps = gpu && sp !== '0' ? knobs.shaftSteps | 0 : 0;
  const kOver = sp !== null && sp !== '' && Number.isFinite(+sp) && +sp > 0 ? +sp : 0;
  return { cao, shaft: steps > 0 ? { steps, k: kOver || SHAFT_K_DEFAULT, kOver } : null };
}

/** Fixed parallel arrays (the staticSrc / dynamic list shape of contactAO.js). */
function mkList(n) {
  return { count: 0, x: new Float32Array(n), y: new Float32Array(n), zBase: new Float32Array(n), rx: new Float32Array(n), ry: new Float32Array(n), h: new Float32Array(n), k: new Float32Array(n), id: new Int32Array(n) };
}
function put(l, i, x, y, z, rx, ry, h, k, id) { l.x[i] = x; l.y[i] = y; l.zBase[i] = z; l.rx[i] = rx; l.ry[i] = ry; l.h[i] = h; l.k[i] = k; l.id[i] = id; }

/**
 * @param {{cao:boolean, shaft:null|{steps:number,k:number}}} cfg resolveFx result
 * Statics (prop bboxes from the active placement cells + tree scatter) are gathered into a candidate cache only when the
 * camera moved REFRESH_M (or the world changed); per frame only the <= 32 nearest are sorted. Beasts cache refreshes with it.
 */
export function createFxHook(cfg) {
  const cao = cfg.cao ? createContactAO() : null;
  const cand = mkList(CAND_MAX), dyn = mkList(CAO_MAX), beasts = [];
  const kOver = cfg.shaft && cfg.shaft.kOver || 0, shaft = cfg.shaft ? { steps: cfg.shaft.steps, k: cfg.shaft.k, iso: SHAFT_DEFAULTS.iso, pw: SHAFT_LOOK.pw, maxM: SHAFT_DEFAULTS.maxM } : null;
  const camP = { x: 0, y: 0 }, OPTS = { radius: STATIC_R };
  let lx = 0, ly = 0, lw = null, gridVer = -1, nTrees = 0;

  function gather(world, cx, cy) {
    let n = 0; const R2 = (STATIC_R + REFRESH_M) * (STATIC_R + REFRESH_M);
    const g = world.placementGrid, st = world.structures;
    if (g && st) for (let i = 0; i < g.activeCount && n < CAND_MAX; i++) {
      const s = st[g.activeList[i]], b = s && s.bbox; if (!b) continue;
      const sx = b.x1 - b.x0, sy = b.y1 - b.y0; if (sx > PROP_MAX_SPAN || sy > PROP_MAX_SPAN || sx <= 0 || sy <= 0) continue; // buildings/terrain-scale pieces: not a contact blob
      const x = (b.x0 + b.x1) * 0.5, y = (b.y0 + b.y1) * 0.5, dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy > R2) continue;
      put(cand, n, x, y, b.z0, sx * 0.5, sy * 0.5, b.z1 - b.z0, PROP_K, g.activeList[i]); n++;
    }
    const nProps = n, t = world.scatter;
    if (t && t.count > 0) for (let i = 0; i < t.count && n < CAND_MAX; i++) {
      const dx = t.x[i] - cx, dy = t.y[i] - cy;
      if (dx * dx + dy * dy > R2) continue;
      put(cand, n, t.x[i], t.y[i], t.z[i], TREE_TRUNK_M * TREE_K, TREE_TRUNK_M * TREE_K, 3, PROP_K, 0x40000000 + i); n++;
    }
    cand.count = n; nTrees = t && t.count > 0 ? n - nProps : 0;
    beasts.length = 0; // refresh cost only: rare
    const ents = world._entities;
    if (ents) for (const e of ents.values()) if (e.type === 'beast' && beasts.length < CAO_MAX - 1) beasts.push(e);
  }

  return {
    cao, shaft, cand, dyn,
    /** Per frame: lights = LightSet (or null), world, player transform/radius. Returns the occluder count. 0 allocation after warm-up. */
    update(lights, world, px, py, pz, pr, camX, camY) {
      if (!lights) return 0;
      if (shaft) { const sun = world.sun; if (sun && sun.elevation !== undefined) shaft.k = shaftKFor(sun.elevation, nTrees, kOver); lights.shaft = shaft; } else if (lights.shaft) lights.shaft = null;
      if (!cao) { if (lights.cao) lights.cao = null; return 0; }
      const gv = world.placementGrid ? world.placementGrid.version : 0;
      if (world !== lw || gv !== gridVer || (camX - lx) * (camX - lx) + (camY - ly) * (camY - ly) > REFRESH_M * REFRESH_M) {
        lw = world; gridVer = gv; lx = camX; ly = camY; gather(world, camX, camY);
      }
      let n = 0;
      put(dyn, n++, px, py, pz, pr, pr, 1.7, 0.5, 0);
      for (let i = 0; i < beasts.length && n < CAO_MAX; i++) {
        const e = beasts[i], tr = e.transform, c = e.components, tg = c && c.targetable, hp = c && c.health;
        if (!tr || (hp && hp.hp <= 0)) continue;
        const r = tg && tg.radius > 0 ? tg.radius : 0.45, h = tg && tg.height > 0 ? tg.height : 0.7;
        put(dyn, n++, tr.x, tr.y, tr.z, r * 1.2, r * 0.8, h, 0.55, 1 + i);
      }
      dyn.count = n;
      setDynamicBlobs(cao, dyn);
      camP.x = camX; camP.y = camY; buildContactBlobs(cao, camP, cand, OPTS);
      lights.cao = cao.n > 0 ? cao : null;
      return cao.n;
    },
  };
}
