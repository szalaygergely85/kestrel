// tools/editor/quest/wire.js - ED-QUEST-WIRE. Pure helpers behind the quest panel's live lint list and "Play from here".
import { lintQuest } from './lintQuest.js';
import { classify } from './targets.js';

const BURY_MIN = 0.05, BURY_MAX = 1.2, SKIP_MESH = /Tree|Pine|Bush|Grass|Fern|Plant|Flower|Clover|Mushroom|Pebble/;   // same R12 constants/filter as tools/content-lint-rules.js + prop-ground-lint.mjs
/** World-space AABB tops of placed meshes (support candidates), same shape as prop-ground-lint supportBoxes. getMesh(key) -> {pos}|null. */
export function structureTops(structs, getMesh) {
  const out = [];
  for (const s of structs || []) {
    let m = null; try { m = s.mesh && getMesh ? getMesh(s.mesh) : null; } catch { m = null; }
    if (!m || !m.pos || m.lazy || SKIP_MESH.test(s.mesh) || !s.origin) continue;
    const sc = s.scale || 1, a = ((s.yawDeg || 0) * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a), p = m.pos;
    const b = { id: s.id, x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, z1: -Infinity };
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i] * sc, y = p[i + 1] * sc, wx = c * x - sn * y + s.origin.x, wy = sn * x + c * y + s.origin.y, z = p[i + 2] * sc + s.origin.z;
      if (wx < b.x0) b.x0 = wx; if (wx > b.x1) b.x1 = wx; if (wy < b.y0) b.y0 = wy; if (wy > b.y1) b.y1 = wy; if (z > b.z1) b.z1 = z;
    }
    out.push(b);
  }
  return out;
}

/** lintQuest ctx from the editor's world json. R5/R12 are live: groundAt = floorAt; walkable = slope test on floorAt (no nav grid in the editor); support = entity base vs ground + structure tops (content-lint R12 shape). */
export function buildLintCtx({ world, itemDefs, names, floorAt, sites = {}, getMesh }) {
  const ents = new Map(), characters = new Set();
  for (const e of (world && world.entities) || []) { ents.set(e.id, e); if (classify(e) === 'character') characters.add(e.id); }
  for (const k of Object.keys(sites)) { const id = sites[k] && sites[k].entity; if (id && ents.has(id)) { ents.set(k, ents.get(id)); if (characters.has(id)) characters.add(k); } }
  const boxes = floorAt ? structureTops((world && world.structures) || [], getMesh) : [];
  // like content-lint: a flat ring point (|dz| < 0.3 vs the spot's own floor) within 3 m means standable ground
  const walkable = (x, y) => { const g0 = floorAt(x, y); for (let a = 0; a < 360; a += 15) for (const d of [1.2, 2, 2.8]) if (Math.abs(floorAt(x + Math.cos(a * Math.PI / 180) * d, y + Math.sin(a * Math.PI / 180) * d) - g0) < 0.3) return true; return false; };
  const support = (id) => {
    const e = ents.get(id); if (!e || !Number.isFinite(e.x)) return null;
    const base = typeof e.z === 'number' ? e.z : floorAt(e.x, e.y);   // model bottom offset ignored (editor has no voxel anchors)
    let sup = -Infinity, above = null;
    for (const [dx, dy] of [[0, 0], [0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]]) {
      const x = e.x + dx, y = e.y + dy; sup = Math.max(sup, floorAt(x, y));
      for (const b of boxes) if (b.x0 <= x && b.x1 >= x && b.y0 <= y && b.y1 >= y) { if (b.z1 <= base + BURY_MIN) sup = Math.max(sup, b.z1); else if (b.z1 <= base + BURY_MAX) above = Math.max(above ?? 0, b.z1 - base); }
    }
    return { id: e.id, x: e.x, y: e.y, base, support: sup, floorAbove: above };
  };
  return {
    characters, itemDefs, ...(floorAt ? { walkable, support } : {}),
    pos: (id) => { const e = ents.get(id); return e && Number.isFinite(e.x) ? { x: e.x, y: e.y, z: typeof e.z === 'number' ? e.z : (floorAt ? floorAt(e.x, e.y) : 0) } : null; },
    groundAt: floorAt, labelOf: names && names.npc ? (id) => names.npc(id) : (id) => id,
  };
}

/** Live lint of one quest -> messages with a panel "Go to" target ({kind,id}); [] when q is null. */
export function liveLint(model, q, ctx) { return q ? lintQuest(model, q.id, ctx) : []; }

/** Dropdown for "Play from here": value is the `?qstate` preset token (parseQstateParam format). */
export function presetOptions(q) {
  const n = q ? q.objectives.length : 0, out = [{ value: 'notStarted', label: 'Not started' }, { value: 'accepted', label: 'Accepted' }];
  for (let i = 2; i <= n; i++) out.push({ value: 'objective' + i, label: 'Objective ' + i });
  out.push({ value: 'readyToReturn', label: 'Ready to return' });
  return out;
}

/** Game URL for the editor camera ground position. base e.g. '../../game/index.html'. */
export function playUrl(base, pos, questId, preset) {
  const f = (v) => (Math.round(v * 100) / 100).toString();
  return `${base}?at=${f(pos.x)},${f(pos.y)},${f(pos.z)},0,0&qstate=${encodeURIComponent(questId + ':' + preset)}`;
}
