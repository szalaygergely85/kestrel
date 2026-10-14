// ED-FOLIAGE-05 (architecture.md 38.69 section 5): foliage budget meter. Pure, no DOM.
// Zone = one 128 m band cell (38.43). Live estimate per zone = base bytes (last "Measure" = BandBakeJob bundleBytes,
// else 0) + collider-proxy bytes of every mesh placement in the zone; LOD0 triangles = sum of the meshes' triCount.

export const MB = 1024 * 1024;
export const ZONE_M = 128;
export const BUNDLE_TARGET_BYTES = 4 * MB;   // WMP-08 target: bar turns amber at or above
export const BUNDLE_HARD_BYTES = 6 * MB;     // WMP-08 hard cap: red, strokes refused
export const MESH_RADIUS_M = 64, MESH_RADIUS_MAX = 60; // meshPlace warning (not enforced here)
// UNCONFIRMED GUESS (architecture.md 38.69 open item): owner to confirm. LOD0 triangles of placed meshes per zone.
// The cap lives in content/editor/foliage.json (`triCap`); configureFoliageCap() applies it. Default below is only the fallback.
export const FOLIAGE_TRI_CAP_DEFAULT = 1500000;
export let FOLIAGE_TRI_CAP = FOLIAGE_TRI_CAP_DEFAULT;
export let FOLIAGE_TRI_TARGET = FOLIAGE_TRI_CAP * 2 / 3;   // amber from 2/3 of the cap (1.0 M at the default)
export let foliageCapWarning = '';

/** Apply `triCap` of the foliage json. Missing / non-positive / non-finite -> default + a plain warning (never throws). */
export function configureFoliageCap(json) {
  const v = json && json.triCap;
  const ok = typeof v === 'number' && Number.isFinite(v) && v > 0;
  FOLIAGE_TRI_CAP = ok ? v : FOLIAGE_TRI_CAP_DEFAULT;
  FOLIAGE_TRI_TARGET = FOLIAGE_TRI_CAP * 2 / 3;
  foliageCapWarning = ok ? '' : `foliage.json has no valid triCap, using ${FOLIAGE_TRI_CAP_DEFAULT.toLocaleString('en-US')} triangles per zone.`;
  return { cap: FOLIAGE_TRI_CAP, warning: foliageCapWarning };
}

export const zoneOf = (x, y) => ({ cx: Math.floor(x / ZONE_M), cy: Math.floor(y / ZONE_M) });
export const zoneKey = (cx, cy) => `${cx},${cy}`;
const isMesh = s => s && s.mesh && s.origin;

/** Bytes of a mesh's collision proxy (0 = none). */
export const colliderBytes = mesh => (mesh && mesh.collider ? mesh.collider.byteLength : 0);

/**
 * @param structures world file `def.structures`  @param assets registry  @param zone {cx,cy}
 * @param extra optional extra items counted as if placed  @param baseBytes last measured bundle bytes of the zone
 * @returns {{meshes:number, tris:number, colliderBytes:number, bytes:number}}
 */
export function zoneStats(structures, assets, zone, { extra = [], baseBytes = 0 } = {}) {
  let meshes = 0, tris = 0, cb = 0;
  const add = s => {
    if (!isMesh(s)) return;
    const z = zoneOf(s.origin.x, s.origin.y);
    if (z.cx !== zone.cx || z.cy !== zone.cy) return;
    const m = assets.mesh(s.mesh);
    meshes++; tris += m.triCount || 0; cb += colliderBytes(m);
  };
  for (const s of structures || []) add(s);
  for (const s of extra) add(s);
  return { meshes, tris, colliderBytes: cb, bytes: baseBytes + cb };
}

/** 'green' below target, 'amber' below the hard cap, 'red' at or above it. */
export function meterLevel(st) {
  if (st.bytes >= BUNDLE_HARD_BYTES || st.tris >= FOLIAGE_TRI_CAP) return 'red';
  if (st.bytes >= BUNDLE_TARGET_BYTES || st.tris >= FOLIAGE_TRI_TARGET) return 'amber';
  return 'green';
}

/** Fill 0..1 of the bar: the larger of the bytes and triangle fractions of their hard caps. */
export const meterFill = st => Math.min(1, Math.max(st.bytes / BUNDLE_HARD_BYTES, st.tris / FOLIAGE_TRI_CAP));

export function meterText(st) {
  return `${(st.bytes / MB).toFixed(2)} / ${BUNDLE_HARD_BYTES / MB} MB, ${(st.tris / 1000).toFixed(0)}k / ${(FOLIAGE_TRI_CAP / 1000).toFixed(0)}k tris, ${st.meshes} meshes`;
}

/**
 * Would adding `items` push any touched zone over a hard cap? Zones already over a cap only block strokes that add to them.
 * @param baseBytes (zoneKey) => number
 * @returns {{ok:true}|{ok:false, reason:string, zone:{cx,cy}, stats}}
 */
export function checkBudget(structures, assets, items, baseBytes = () => 0) {
  const zones = new Map();
  for (const it of items) if (isMesh(it)) { const z = zoneOf(it.origin.x, it.origin.y); zones.set(zoneKey(z.cx, z.cy), z); }
  for (const [k, z] of zones) {
    const st = zoneStats(structures, assets, z, { extra: items, baseBytes: baseBytes(k) });
    if (st.bytes > BUNDLE_HARD_BYTES) return { ok: false, zone: z, stats: st, reason: `Zone ${k} would pass the ${BUNDLE_HARD_BYTES / MB} MB limit (${(st.bytes / MB).toFixed(2)} MB). Place fewer or erase some first.` };
    if (st.tris > FOLIAGE_TRI_CAP) return { ok: false, zone: z, stats: st, reason: `Zone ${k} would pass ${FOLIAGE_TRI_CAP / 1e6} M triangles (${(st.tris / 1e6).toFixed(2)} M). Place fewer or erase some first.` };
  }
  return { ok: true };
}

/** Real per-zone bytes: bakes the zone with BandBakeJob (passed in, engine/dev.js) and returns bundleBytes. Seconds; on demand. */
export function measureZone(world, zone, { BandBakeJob, bundleBytes }) {
  const job = BandBakeJob.create(world, zone.cx, zone.cy, 5, 3, null); job.step(1e9);
  return bundleBytes(job.bundle());
}
