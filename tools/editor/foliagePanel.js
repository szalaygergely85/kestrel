// ED-FOLIAGE-02 (architecture.md 38.69): Foliage tab logic. Pure, no DOM: main.js only wires inputs/canvas to this.
// Stroke = foliageBrush dabs along the drag; end -> ONE batch record the host commits (applyEdit + one rebuild, which
// reloads the World and so rebuilds mesh colliders once). Undo/redo is the editor's normal batch-record path.

import { FOLIAGE_RADIUS_RANGE, FOLIAGE_DENSITY_RANGE, paletteSpecies, beginFoliageStroke } from './foliageBrush.js';

export const FOLIAGE_OPS = ['paint', 'erase'];
export const FOLIAGE_FALLOFFS = ['smooth', 'hard'];
const clamp = (v, [lo, hi]) => Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo));

export function createFoliageState(json) {
  const ids = Object.keys((json && json.palettes) || {}).filter((id) => json.palettes[id].place?.length);
  return { ids, palette: ids[0] || null, op: 'paint', radius: 8, falloff: 'smooth', density: 6, seed: 1, shift: false };
}
/** Clamp + validate one UI param; returns the stored value. */
export function setFoliageParam(st, k, v) {
  if (k === 'radius') st.radius = clamp(Number(v), FOLIAGE_RADIUS_RANGE);
  else if (k === 'density') st.density = clamp(Number(v), FOLIAGE_DENSITY_RANGE);
  else if (k === 'seed') st.seed = Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : st.seed;
  else if (k === 'op') { if (FOLIAGE_OPS.includes(v)) st.op = v; }
  else if (k === 'falloff') { if (FOLIAGE_FALLOFFS.includes(v)) st.falloff = v; }
  else if (k === 'palette') { if (st.ids.includes(v)) st.palette = v; }
  else if (k === 'shift') st.shift = !!v;
  return st[k];
}
export const foliageDabSpacing = (radius) => Math.max(1, radius * 0.35);

/** Points from `a` (exclusive; null = none) to `b` (inclusive) every `step` metres. */
export function pointsAlong(a, b, step) {
  if (!a) return [[b.x, b.y]];
  const d = Math.hypot(b.x - a.x, b.y - a.y), n = Math.floor(d / step), out = [];
  for (let i = 1; i <= n; i++) out.push([a.x + (b.x - a.x) * i * step / d, a.y + (b.y - a.y) * i * step / d]);
  return out;
}

/**
 * Quest references for erase refusal: `texts` = {sourceName: jsonText}. Returns externalRefs(id) -> string[] of
 * "quest <source>" entries whose JSON holds a string value equal to the id (step, target, giver, reward ...).
 */
export function buildExternalRefs(texts) {
  const idx = new Map();
  const walk = (v, src) => {
    if (typeof v === 'string') { if (v.length <= 64 && /^[A-Za-z][\w-]*$/.test(v)) { const s = idx.get(v) || idx.set(v, new Set()).get(v); s.add(src); } }
    else if (Array.isArray(v)) v.forEach((x) => walk(x, src));
    else if (v && typeof v === 'object') for (const x of Object.values(v)) walk(x, src);
  };
  for (const [src, text] of Object.entries(texts || {})) { try { walk(JSON.parse(text), src); } catch { /* unreadable quest file: ignored */ } }
  return (id) => [...(idx.get(id) || [])].map((s) => `quest ${s}`);
}

/**
 * host: {doc, fileId, assets, getWorld(), json (palettes), commit(rec), externalRefs?, flash?}
 * One controller per editor session; `start/move/end` mirror the grass/terrain brush gesture.
 */
export function createFoliageController(host, state) {
  let stroke = null, last = null, species = null, count = 0;
  const speciesFor = () => paletteSpecies(host.json, state.palette, { assets: host.assets });
  return {
    get active() { return !!stroke; },
    /** Ghost origins of the placements the running stroke would add (paint only). */
    ghosts() { return stroke && state.op === 'paint' ? stroke.added.map((it) => it.origin) : []; },
    start(pt) {
      if (!state.palette) { host.flash?.('foliage: no palette'); return false; }
      try { species = speciesFor(); } catch (e) { host.flash?.(`foliage: ${e.message}`); return false; }
      stroke = beginFoliageStroke({ doc: host.doc, fileId: host.fileId, assets: host.assets, world: host.getWorld(), species },
        { op: state.op, radius: state.radius, falloff: state.falloff, density: state.density, seed: state.seed + count, shift: state.shift, externalRefs: host.externalRefs });
      last = null; this.move(pt); return true;
    },
    move(pt) {
      if (!stroke) return;
      for (const [x, y] of pointsAlong(last, pt, foliageDabSpacing(state.radius))) stroke.dab(x, y);
      last = { x: pt.x, y: pt.y };
    },
    /** @returns {{rec, messages, refused}|null} cancel = drop without committing. */
    end(cancel = false) {
      const s = stroke; stroke = null; last = null;
      if (!s) return null;
      count++; // next stroke gets a different seed so repeat strokes do not stack on identical cells
      const rec = cancel ? null : s.end();
      if (rec) host.commit(rec);
      const info = { rec, messages: s.messages, refused: s.refused, stats: s.stats };
      if (host.flash) host.flash(rec ? `${rec.label}: ${rec.batch.length} placements${s.messages.length ? ` (${s.messages[0]})` : ''}` : s.refused.length ? `foliage erase refused: ${s.refused.length} referenced (${s.refused[0].refs[0]})` : cancel ? 'foliage: stroke cancelled' : 'foliage: nothing placed');
      return info;
    },
  };
}
