// ENV-01-WIRE (arch 38.62): pure helpers for the GPU decor scatter mount in main.js. No DOM, no GPU: the page passes the recipe,
// a mesh lookup and the WgDecorPass; everything here is testable in Node.
import { packDecorLayers } from '../../engine/index.js';

/** `?decor=cpu` / `?decor=0` force the CPU layers; anything else (missing, garbage, 'gpu') = `canGpu` (true only on the WebGPU mesh renderer with a GPU cull).
 *  DECOR-ON-01 (OB-119 follow-up): default ON again now that the dispose-deferral fix is in. */
export function parseDecorMode(raw, canGpu) {
  if (!canGpu) return false;
  const v = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return v !== 'cpu' && v !== '0';
}

/** Preset `decorDensity` (0..1) -> layer densityQ8 (256 = the mask's own probability). Garbage -> 256. */
export function densityQ8For(d) { return Number.isFinite(d) && d >= 0 && d <= 1 ? Math.round(d * 256) : 256; }

const IDENT = () => { const m = new Float32Array(12); m[0] = 1; m[4] = 1; m[8] = 1; return m; };

/**
 * Recipe `detail.layers` (gpu ones) -> the WgDecorPass.configure() argument. One species list per layer: the first non-empty
 * `ground` list (the mask byte has no ground type; `warn` is called when other lists differ by mesh set).
 * @param {any} detailCfg recipe.detail @param {(id:string)=>any} meshOf registry mesh lookup
 * @param {{density?:number, carpetRadiusM?:number, objectId?:number, warn?:(m:string)=>void}} [o]
 * @returns {{cfg:any, names:string[]}|null} null = no gpu layers
 */
export function buildDecorConfig(detailCfg, meshOf, o = {}) {
  const gl = ((detailCfg && detailCfg.layers) || []).filter((l) => l.gpu);
  if (!gl.length) return null;
  const warn = o.warn || (() => {}), q8 = densityQ8For(o.density === undefined ? 1 : o.density);
  const layers = [], hostLayers = [], parts = { m: IDENT(), flags: Uint32Array.of(1) };
  let radiusM = 0.5;
  for (const l of gl) {
    const lists = Object.values(l.ground || {}).filter((x) => x && x.length), list = lists[0];
    if (!list) throw new Error(`decor layer ${l.name}: empty ground lists`);
    const ids = (x) => x.map((s) => s.mesh).sort().join();
    if (lists.some((x) => ids(x) !== ids(list))) warn(`decor layer ${l.name}: ground lists differ; GPU decor uses the first`);
    const species = [], hs = [], fade = [];
    for (const s of list) {
      const m0 = meshOf(s.mesh); if (!m0) throw new Error(`decor layer ${l.name}: unknown mesh ${s.mesh}`);
      const lod = m0.lods && m0.lods[0] && meshOf(m0.lods[0].mesh) || null;
      const maxM = s.maxDistM > 0 ? Math.min(s.maxDistM, l.drawM) : l.drawM;
      species.push({ weight: s.weight, lodM: lod ? Math.round(maxM * 0.5) : maxM, maxDistM: maxM, grassLike: !!s.grassLike, sway: !!s.sway, sinkM: s.sinkM, scaleMin: 1, scaleMax: 1 });
      hs.push({ meshes: [m0, lod], parts }); fade.push(Math.round(maxM * 100));
      if (m0.radius > radiusM) radiusM = m0.radius;
    }
    layers.push({ seed: l.seed, cellM: l.cellM, jitterM: l.jitter, drawM: l.drawM, densityQ8: q8, species });
    hostLayers.push({ species: hs, fadeCm: Int32Array.from(fade) });
  }
  return { names: gl.map((l) => l.name), cfg: { packed: packDecorLayers({ layers }), layers: hostLayers, carpetRadiusM: o.carpetRadiusM || 0, objectId: o.objectId === undefined ? 0x40000 : o.objectId, radiusM } };
}

/**
 * Wraps `pass.run` (called every frame inside the render loop): counts dispatches into `dbg.total`; on the FIRST error counts it,
 * switches the pass off (`setMasks(null, 0)`), flags `dbg.bad`, warns once and never rethrows (a failing pass must not throw every frame).
 * @param {{run:Function, stats:{dispatches:number}, setMasks:Function}} pass @param {{total:number, frameErrors:number, bad?:boolean}} dbg @param {(m:string)=>void} [warn]
 */
export function guardDecorRun(pass, dbg, warn = console.warn) {
  const run0 = pass.run.bind(pass);
  pass.run = (fr, p) => {
    if (dbg.bad) return;
    try { run0(fr, p); dbg.total += pass.stats.dispatches; } catch (e) {
      dbg.frameErrors++; dbg.bad = true;
      try { pass.setMasks(null, 0); } catch (_) { /* already failing */ }
      warn('[decor] GPU decor pass failed, disabled: ' + (e && e.message));
    }
  };
}
