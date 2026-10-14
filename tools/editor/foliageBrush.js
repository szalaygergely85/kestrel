// ED-FOLIAGE-01 (architecture.md 38.69): foliage brush, placements mode. Pure, no DOM, no Math.random.
// A stroke turns dabs into real `fol_<n>` mesh placements (always floor-snapped via snapMeshOrigin, OB-155)
// and ends in ONE undo batch record. Decor mode (detail-layer paint) is ED-FOLIAGE-04, not here.

import { hash2, PROP_SCALE_MIN, PROP_SCALE_MAX } from '../../engine/index.js';
import { makeInsertRecord, makeDeleteRecord, makeFieldEditRecord, findReferrers } from './commands.js';
import { createMeshPlacement, snapMeshOrigin, meshScale } from './meshPlace.js';

export const FOLIAGE_MAX_PER_STROKE = 200;
export const FOLIAGE_RADIUS_RANGE = [1, 24];
export const FOLIAGE_DENSITY_RANGE = [0.1, 20];
export const FOLIAGE_PATH = 'editor/foliage.json';
const WATER_MAX_DEPTH = 0.3, DEFAULT_GAP = 0.5;
const PLACE_KEYS = ['mesh', 'w', 'gapM', 'scale', 'maxSlopeDeg', 'collide', 'shadow'];

/** @returns {string[]} errors; unknown keys error; every place mesh must be registered AND have a collider proxy. */
export function validateFoliagePalettes(json, { assets }) {
  const errors = [], fin = v => typeof v === 'number' && Number.isFinite(v);
  if (!json || typeof json !== 'object') return ['foliage: not an object'];
  for (const k of Object.keys(json)) if (!['version', 'triCap', 'palettes'].includes(k)) errors.push(`foliage.${k}: unknown key`);
  if (json.version !== 1) errors.push('foliage.version: must be 1');
  if (!json.palettes || typeof json.palettes !== 'object' || Array.isArray(json.palettes)) return [...errors, 'foliage.palettes: must be an object'];
  for (const [id, pal] of Object.entries(json.palettes)) {
    const at = `palettes.${id}`;
    for (const k of Object.keys(pal)) if (!['place', 'decor'].includes(k)) errors.push(`${at}.${k}: unknown key`);
    if (!pal.place && !pal.decor) errors.push(`${at}: needs place or decor`);
    (pal.place || []).forEach((s, i) => {
      const p = `${at}.place[${i}]`;
      for (const k of Object.keys(s)) if (!PLACE_KEYS.includes(k)) errors.push(`${p}.${k}: unknown key`);
      if (typeof s.mesh !== 'string' || !assets.has('mesh', s.mesh)) errors.push(`${p}.mesh: unknown registered mesh`);
      else if (!assets.mesh(s.mesh).collider?.length) errors.push(`${p}.mesh: no collider proxy (a brush never uses render-triangle colliders)`);
      if (!fin(s.w) || s.w <= 0) errors.push(`${p}.w: must be > 0`);
      if (!fin(s.gapM) || s.gapM < 0) errors.push(`${p}.gapM: must be >= 0`);
      if (!Array.isArray(s.scale) || s.scale.length !== 2 || !s.scale.every(fin) || s.scale[0] > s.scale[1] || s.scale[0] < PROP_SCALE_MIN || s.scale[1] > PROP_SCALE_MAX) errors.push(`${p}.scale: [min,max] within ${PROP_SCALE_MIN}..${PROP_SCALE_MAX}`);
      if (!fin(s.maxSlopeDeg) || s.maxSlopeDeg < 0 || s.maxSlopeDeg > 89) errors.push(`${p}.maxSlopeDeg: 0..89`);
      for (const k of ['collide', 'shadow']) if (k in s && typeof s[k] !== 'boolean') errors.push(`${p}.${k}: must be boolean`);
    });
    (pal.decor || []).forEach((d, i) => {
      const p = `${at}.decor[${i}]`;
      for (const k of Object.keys(d)) if (!['layer', 'target'].includes(k)) errors.push(`${p}.${k}: unknown key`);
      if (typeof d.layer !== 'string' || !d.layer) errors.push(`${p}.layer: required`);
      if (!fin(d.target) || d.target < 0 || d.target > 2) errors.push(`${p}.target: 0..2`);
    });
  }
  return errors;
}

/** Validated placement species of one palette (throws with every error). */
export function paletteSpecies(json, id, { assets }) {
  const errors = validateFoliagePalettes(json, { assets });
  if (errors.length) throw new Error(errors.join('; '));
  if (!json.palettes[id]) throw new Error(`foliage: no palette "${id}"`);
  return json.palettes[id].place || [];
}

export const foliageFalloff = (t, mode) => {
  if (mode === 'hard') return t <= 1 ? 1 : 0;
  if (t >= 1) return 0;
  return 1 - t * t * (3 - 2 * t); // smoothstep
};
const u01 = (ix, iy, seed, k) => hash2(ix, iy, (seed + k * 0x9e3779b1) | 0) / 4294967296;
const isMesh = s => s && s.mesh && s.origin;
const footprint = (assets, key, scale) => { const b = assets.mesh(key).bbox; return 0.25 * Math.max(b[3] - b[0], b[4] - b[1]) * scale; };

/**
 * @param ctx {{doc, fileId, assets, world, species: Object[]}}  species from paletteSpecies
 * @param p {{op:'paint'|'erase', radius, falloff:'hard'|'smooth', density, seed:number, shift?:boolean, externalRefs?:(id)=>string[]}}
 * dab(x,y) accumulates; end() -> {label, batch}|null. Nothing touches the doc until the caller applyEdit()s the record
 * (paint mints ids from file.meta.nextId at dab time; undo never reuses them).
 */
export function beginFoliageStroke(ctx, p) {
  const { doc, fileId, assets, world, species } = ctx, file = doc.files.get(fileId);
  const radius = Math.max(FOLIAGE_RADIUS_RANGE[0], Math.min(FOLIAGE_RADIUS_RANGE[1], p.radius));
  const density = Math.max(FOLIAGE_DENSITY_RANGE[0], Math.min(FOLIAGE_DENSITY_RANGE[1], p.density));
  const seed = p.seed | 0, wsum = species.reduce((a, s) => a + s.w, 0);
  const gapOf = new Map(species.map(s => [s.mesh, s.gapM]));
  const grid = new Map(), key = (ix, iy) => ix * 65536 + iy; // 4 m spatial hash of the file's mesh placements
  const gridAdd = it => { const k = key(Math.floor(it.origin.x / 4), Math.floor(it.origin.y / 4)); (grid.get(k) || grid.set(k, []).get(k)).push(it); };
  for (const s of file.def.structures || []) if (isMesh(s)) gridAdd(s);
  const gapFor = it => gapOf.has(it.mesh) ? gapOf.get(it.mesh) : DEFAULT_GAP;
  const added = [], seen = new Set(), erased = new Map(), refused = [];
  const stats = { noFloor: 0, slope: 0, zone: 0, gap: 0, water: 0 };
  const out = { messages: [], stats, refused, added };
  const wOut = { surfaceZ: 0, depth: 0 };

  const tooClose = (x, y, gap) => {
    const cx = Math.floor(x / 4), cy = Math.floor(y / 4), reach = Math.ceil(Math.max(gap, 8) / 4);
    for (let i = cx - reach; i <= cx + reach; i++) for (let j = cy - reach; j <= cy + reach; j++)
      for (const o of grid.get(key(i, j)) || []) if (Math.hypot(o.origin.x - x, o.origin.y - y) < Math.max(gap, gapFor(o))) return true;
    return false;
  };

  function paintCell(ix, iy, cx, cy) {
    const f = foliageFalloff(Math.hypot(ix + 0.5 - cx, iy + 0.5 - cy) / radius, p.falloff);
    if (!(u01(ix, iy, seed, 0) < density / 100 * f)) return;
    if (added.length >= FOLIAGE_MAX_PER_STROKE) {
      if (!out.capped) { out.capped = true; out.messages.push(`stroke capped at ${FOLIAGE_MAX_PER_STROKE} placements`); }
      return;
    }
    let pick = u01(ix, iy, seed, 1) * wsum, sp = species[species.length - 1];
    for (const s of species) { if ((pick -= s.w) < 0) { sp = s; break; } }
    const x = ix + 0.1 + 0.8 * u01(ix, iy, seed, 2), y = iy + 0.1 + 0.8 * u01(ix, iy, seed, 3);
    const yawDeg = Math.floor(u01(ix, iy, seed, 4) * 360);
    const scale = meshScale(sp.scale[0] + (sp.scale[1] - sp.scale[0]) * u01(ix, iy, seed, 5));
    const o = snapMeshOrigin(world, assets.mesh(sp.mesh), sp.mesh, x, y, scale); // null = no floor / courtyard gap; z is never typed (OB-155)
    if (!o) { stats.noFloor++; return; }
    const e = footprint(assets, sp.mesh, scale), z = (dx, dy) => world.floorAt(o.x + dx, o.y + dy);
    const slope = Math.max(Math.abs(z(e, 0) - z(-e, 0)), Math.abs(z(0, e) - z(0, -e))) / (2 * e);
    if (!(Math.atan(slope) * 180 / Math.PI <= sp.maxSlopeDeg)) { stats.slope++; return; }
    if (world.structureAt(o.x, o.y)) { stats.zone++; return; }
    if (typeof world.waterAt === 'function' && world.waterAt(o.x, o.y, wOut) && wOut.depth > WATER_MAX_DEPTH) { stats.water++; return; }
    if (tooClose(o.x, o.y, sp.gapM)) { stats.gap++; return; }
    const r = createMeshPlacement(file, sp.mesh, { x, y }, { assets, world, yawDeg, scale });
    if (!r.item) return;
    r.item.id = 'fol_' + r.item.id.slice(5); // mintId gave mesh_<n>; same n keeps validateMeshStructure's suffix rule
    if (sp.collide === false) r.item.collide = false;
    if (sp.shadow === false) r.item.castShadow = false;
    added.push(r.item); gridAdd(r.item);
  }

  function eraseDab(cx, cy) {
    (file.def.structures || []).forEach((s, index) => {
      if (!isMesh(s) || erased.has(s.id) || refused.some(r => r.id === s.id)) return;
      if (!p.shift && !gapOf.has(s.mesh)) return; // Shift erases any mesh species
      const f = foliageFalloff(Math.hypot(s.origin.x - cx, s.origin.y - cy) / radius, p.falloff);
      if (!(f > 0) || !(u01(Math.round(s.origin.x * 100), Math.round(s.origin.y * 100), seed, 6) < f)) return;
      const refs = [...findReferrers(file.def, file.kind, 'structures', s.id), ...(p.externalRefs ? p.externalRefs(s.id) : [])];
      if (refs.length) { refused.push({ id: s.id, refs }); return; }
      erased.set(s.id, { item: s, index });
    });
  }

  return Object.assign(out, {
    dab(cx, cy) {
      if (p.op === 'erase') return eraseDab(cx, cy);
      for (let ix = Math.floor(cx - radius); ix <= Math.ceil(cx + radius); ix++) for (let iy = Math.floor(cy - radius); iy <= Math.ceil(cy + radius); iy++) {
        const k = key(ix, iy);
        if (seen.has(k)) continue; // one placement per lattice cell per stroke
        const before = added.length; paintCell(ix, iy, cx, cy);
        if (added.length > before) seen.add(k);
      }
    },
    end() {
      if (p.op === 'erase') {
        const list = [...erased.values()].sort((a, b) => a.index - b.index); // ascending: invert() keeps order, so undo re-inserts each at its original index
        return list.length ? { label: 'foliage erase', batch: list.map(e => makeDeleteRecord(fileId, 'structures', e.item, e.index)) } : null;
      }
      return added.length ? { label: 'foliage paint', batch: added.map(it => makeInsertRecord(fileId, 'structures', it)) } : null;
    },
  });
}

// ---- ED-FOLIAGE-05: terrain re-snap (OB-155 nothing floats) ----
export const isFolId = id => typeof id === 'string' && id.startsWith('fol_');

/** The z a placement should have on the current floor (same rule as paint: snapMeshOrigin). null = no floor. */
const snappedZ = (world, assets, s) => { const o = snapMeshOrigin(world, assets.mesh(s.mesh), s.mesh, s.origin.x, s.origin.y, meshScale(s.scale ?? 1)); return o ? o.z : null; };

/**
 * After a terrain stroke: every `fol_` mesh placement inside world rect [x0,y0,x1,y1] (metres, padded by the footprint)
 * gets its z re-snapped to the NEW floor. Returns ONE batch of field-edit records (or null when nothing moved) that the
 * host stores on the terrain record, so undo/redo of the stroke undoes/redoes the z changes too. `world.floorAt` must
 * already see the new terrain; the doc is NOT changed here (applyEdit the batch).
 */
export function resnapFoliage({ doc, fileId, assets, world }, rect, pad = 2) {
  const file = doc.files.get(fileId); if (!file) return null;
  const [x0, y0, x1, y1] = [rect[0] - pad, rect[1] - pad, rect[2] + pad, rect[3] + pad], batch = [];
  (file.def.structures || []).forEach((s, index) => {
    if (!isMesh(s) || !isFolId(s.id)) return;
    if (s.origin.x < x0 || s.origin.x > x1 || s.origin.y < y0 || s.origin.y > y1) return;
    const z = snappedZ(world, assets, s);
    if (z === null || Math.abs(z - s.origin.z) < 0.005) return;
    batch.push(makeFieldEditRecord('resnap', fileId, 'structures', s, index, { origin: { ...s.origin, z } }));
  });
  return batch.length ? { label: 'foliage resnap', batch } : null;
}

/** probe-floating twin for placed foliage: `fol_` placements whose z differs from the current snapped floor by > tol. */
export function floatingFoliage({ doc, fileId, assets, world }, tol = 0.01) {
  const out = [];
  for (const s of doc.files.get(fileId).def.structures || []) {
    if (!isMesh(s) || !isFolId(s.id)) continue;
    const z = snappedZ(world, assets, s);
    if (z !== null && Math.abs(s.origin.z - z) > tol) out.push({ id: s.id, gap: +(s.origin.z - z).toFixed(3) });
  }
  return out;
}
