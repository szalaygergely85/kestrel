// OB-136: zone bands (D-067/2026-10-11): tower side of the river = levels 1-5, far side = 5-10.
// Audit: no quest with a suggested level < 5 may have an objective target (area / entity / pickup) across the river.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadDesignAssets, loadQuestFiles, loadPackQuests } from '../../../tools/validate-content.mjs';

const root = new URL('../../../', import.meta.url);
const world = JSON.parse(readFileSync(new URL('content/worlds/world_m1.world.json', root), 'utf8'));
const areas = JSON.parse(readFileSync(new URL('content/quests/areas.json', root), 'utf8')).areas;
const assets = await loadAssets();
async function loadAssets() { return loadDesignAssets(); }
const dir = fileURLToPath(new URL('content/quests', root));
const files = loadQuestFiles(dir), packs = await loadPackQuests(dir, assets?.items?.defs);
const defs = [...files.quests, ...packs.quests].map(q => q.def);

// River centreline: all river-shaped water pieces, path points [x, y, z, width]; x as a function of y.
const rivers = world.water.filter(w => w.shape === 'river').map(w => w.path);
function riverAt(y) { // [centreX, halfWidth] or null when y is outside every river piece
  for (const p of rivers) for (let i = 0; i + 1 < p.length; i++) {
    const a = p[i], b = p[i + 1];
    if (y >= a[1] && y <= b[1]) { const t = b[1] === a[1] ? 0 : (y - a[1]) / (b[1] - a[1]); return [a[0] + (b[0] - a[0]) * t, (a[3] + (b[3] - a[3]) * t) / 2]; }
  }
  return null;
}
// Tower side = east (the tower stands at x ~1480). Far side = west of the water edge. Outside the river's y range: x < 1000 counts as far.
export function side(x, y) {
  const r = riverAt(y);
  if (!r) return x < 1000 ? 'far' : 'near';
  return x < r[0] - r[1] ? 'far' : 'near';
}

const ents = new Map(world.entities.filter(e => e.id && e.x != null).map(e => [e.id, e]));
const trig = new Map(world.triggers.filter(t => t.x != null).map(t => [t.id, t]));
const wsById = new Map(world.entities.filter(e => e.components?.waystone).map(e => [e.components.waystone.id, e]));
const pickups = (item) => world.entities.filter(e => e.components?.questPickup?.item === item);
const pos = (e) => e && { x: e.x, y: e.y };

// objective -> list of { what, x, y } targets that must be reached (best effort; unresolved ones are listed, not failed)
const unresolved = new Set();
function flagTargets(id) {
  const m = /^waystone\.(.+)\.woken$/.exec(id); if (m && wsById.has(m[1])) return [{ what: 'ws:' + m[1], ...pos(wsById.get(m[1])) }];
  for (const tok of id.split('.')) {
    const key = tok.replace(/\.hit$/, '');
    if (ents.has(key)) return [{ what: 'ent:' + key, ...pos(ents.get(key)) }];
    if (trig.has(key)) return [{ what: 'trig:' + key, ...pos(trig.get(key)) }];
  }
  const t = id.match(/^(target\d|owTarget\d)\.hit$/); if (t && ents.has(t[1])) return [{ what: 'ent:' + t[1], ...pos(ents.get(t[1])) }];
  unresolved.add(id); return [];
}
function targets(w) {
  switch (w.type) {
    case 'area': {
      const a = areas[w.id]; if (!a) return [];
      if (a.trigger && trig.has(a.trigger)) return [{ what: 'area:' + w.id, ...pos(trig.get(a.trigger)) }];
      if (a.structure) { const s = world.structures.find(s => s.id === a.structure); return s ? [{ what: 'area:' + w.id, x: s.origin.x, y: s.origin.y }] : []; }
      unresolved.add('area:' + w.id); return [];
    }
    case 'beasts': return (w.ids || []).filter(i => ents.has(i)).map(i => ({ what: 'ent:' + i, ...pos(ents.get(i)) }));
    case 'collect': case 'item': case 'deliver': {
      const out = [];
      const ps = pickups(w.id);
      if (w.type !== 'deliver' || ps.length) { // pickups: crossing only if fewer than `count` lie on the tower side
        const need = w.count || 1, nearN = ps.filter(e => side(e.x, e.y) === 'near').length;
        if (ps.length && nearN < need) out.push(...ps.filter(e => side(e.x, e.y) === 'far').slice(0, 1).map(e => ({ what: 'pickup:' + w.id, ...pos(e) })));
        if (!ps.length && w.type !== 'deliver') unresolved.add('item:' + w.id);
      }
      if (w.to) { if (ents.has(w.to)) out.push({ what: 'to:' + w.to, ...pos(ents.get(w.to)) }); else unresolved.add('npc:' + w.to); }
      return out;
    }
    case 'flag': return flagTargets(w.id);
    default: return [];
  }
}
// suggested level: pack `band` (number or [lo,hi]); legacy chain quests without a band are level 1.
const levelOf = (d) => Array.isArray(d.band) ? d.band[0] : (typeof d.band === 'number' ? d.band : 1);

// Main-chain steps that cross early; the chain is being rewritten (D-106), so they are listed, not fixed (lane entry OB-136).
export const KNOWN_MAIN_CROSSINGS = ['mq.ford.mirror', 'mq.ford.stones', 'mq.smoke'];
// Side quests whose only target is the Ford trade post / well / shrine (all west of the water, x < 1010). No same-side alternative
// exists (postkeeper, rook, notePost, fordWest, well, shrine are the far-bank hub), so PO must either raise their band to 5 or re-site
// them; listed here so the audit passes now and every NEW early crossing fails.
export const KNOWN_SIDE_CROSSINGS = ['sq.burl.scout', 'sq.burl.ask', 'sq.burl.parcel', 'sq.post.spare', 'sq.rb.shield', 'sq.fc.ford', 'sq.rb.parcel', 'sq.fc.well', 'sq.fc.shrine', 'sq.honey', 'sq.packet'];

const crossings = [];
for (const d of defs) {
  if (levelOf(d) >= 5) continue;
  for (const o of d.objectives || []) for (const t of targets(o.when || {})) if (side(t.x, t.y) === 'far') crossings.push({ quest: d.id, main: !!d.main, obj: o.id, ...t });
}
const known = new Set([...KNOWN_MAIN_CROSSINGS, ...KNOWN_SIDE_CROSSINGS]);
const bad = crossings.filter(c => !known.has(c.quest));
if (process.env.RIVER_REPORT) console.log(crossings.map(c => `${c.main ? 'MAIN' : 'side'} ${c.quest}/${c.obj} ${c.what} (${Math.round(c.x)},${Math.round(c.y)}) lvl ${levelOf(defs.find(d => d.id === c.quest))}`).join('\n'), '\nunresolved:', [...unresolved].join(' '));
assert.deepEqual(bad.map(c => `${c.quest}/${c.obj} -> ${c.what} (${Math.round(c.x)},${Math.round(c.y)})`), [], 'early quest targets across the river (OB-136)');
// sanity: the geometry itself - tower is near, the ford west bank and the outer wall are far
assert.equal(side(1480, 1018), 'near'); assert.equal(side(1010, 1072), 'far'); assert.equal(side(938, 930), 'far'); assert.equal(side(1045, 1066), 'near');
console.log('riverBand.test ok (' + crossings.length + ' crossings, ' + known.size + ' known main)');
