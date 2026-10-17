// QL-MAIN-02 RIVER-SIDE-AUDIT (OB-136, D-070): warn when a low-band quest (band 1-5, legacy chain = level 1) has an
// objective target across the river (far side = zone band 5-10). Same geometry/target rules as game/js/quest/riverBand.test.js.
// Warnings only (wired into validate-content); nothing here moves targets.
//   node tools/quest-zone-lint.mjs        -> lists hits on real content
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const levelOf = (d) => (Array.isArray(d.band) ? d.band[0] : typeof d.band === 'number' ? d.band : 1);

/** -> [{ quest, main, level, obj, what, x, y }] low-band objective targets on the far side of the river. */
export function lintQuestZones({ world, areas, defs, bandMinAt }) {
  const side = (x, y) => (bandMinAt(x, y) > 5 ? 'far' : 'near'); // OB-136/D-070: 'far' = zone band min level > 5 (no river test)
  const ents = new Map((world.entities || []).filter((e) => e.id && e.x != null).map((e) => [e.id, e]));
  const trig = new Map((world.triggers || []).filter((t) => t.x != null).map((t) => [t.id, t]));
  const wsById = new Map((world.entities || []).filter((e) => e.components?.waystone).map((e) => [e.components.waystone.id, e]));
  const pickups = (item) => (world.entities || []).filter((e) => e.components?.questPickup?.item === item);
  const pos = (e) => e && { x: e.x, y: e.y };
  const flagTargets = (id) => {
    const m = /^waystone\.(.+)\.woken$/.exec(id); if (m && wsById.has(m[1])) return [{ what: 'ws:' + m[1], ...pos(wsById.get(m[1])) }];
    for (const key of id.split('.')) {
      if (ents.has(key)) return [{ what: 'ent:' + key, ...pos(ents.get(key)) }];
      if (trig.has(key)) return [{ what: 'trig:' + key, ...pos(trig.get(key)) }];
    }
    return [];
  };
  const targets = (w) => {
    switch (w.type) {
      case 'area': {
        const a = (areas || {})[w.id]; if (!a) return [];
        if (a.trigger && trig.has(a.trigger)) return [{ what: 'area:' + w.id, ...pos(trig.get(a.trigger)) }];
        if (a.structure) { const s = (world.structures || []).find((s) => s.id === a.structure); return s ? [{ what: 'area:' + w.id, x: s.origin.x, y: s.origin.y }] : []; }
        return [];
      }
      case 'beasts': return (w.ids || []).filter((i) => ents.has(i)).map((i) => ({ what: 'ent:' + i, ...pos(ents.get(i)) }));
      case 'collect': case 'item': case 'deliver': {
        const out = [], ps = pickups(w.id);
        if (w.type !== 'deliver' || ps.length) { // crossing only if fewer than `count` pickups lie on the near side
          const need = w.count || 1, nearN = ps.filter((e) => side(e.x, e.y) === 'near').length;
          if (ps.length && nearN < need) out.push(...ps.filter((e) => side(e.x, e.y) === 'far').slice(0, 1).map((e) => ({ what: 'pickup:' + w.id, ...pos(e) })));
        }
        if (w.to && ents.has(w.to)) out.push({ what: 'to:' + w.to, ...pos(ents.get(w.to)) });
        return out;
      }
      case 'flag': return flagTargets(w.id);
      default: return [];
    }
  };
  const hits = [];
  for (const d of defs) {
    if (levelOf(d) >= 5) continue;
    for (const o of d.objectives || []) for (const t of targets(o.when || {})) if (side(t.x, t.y) === 'far') hits.push({ quest: d.id, main: !!d.main, level: levelOf(d), obj: o.id, ...t });
  }
  return hits;
}

export const zoneWarning = (h) => `quest-zone ${h.quest}${h.main ? ' (main)' : ''}: band ${h.level} quest, objective ${h.obj} targets ${h.what} (${Math.round(h.x)},${Math.round(h.y)}) across the river (far side = band 5-10, OB-136)`;

/** Zone band min level at a point, from the game's own band grid (game/js/quest/sim/band.js over world_geo.regions). */
export async function realBandMinAt() {
  globalThis.window = globalThis.window || globalThis;
  await import('../design/levels/overworld_far.js'); await import('../design/levels/world_geo.js');
  const { createBand } = await import('../game/js/quest/sim/band.js');
  return createBand(globalThis.ASSETS.levels.world_geo.regions).bandAt;
}

/** Real content -> warning strings. */
export async function lintRealZones({ quests }) {
  const root = new URL('../', import.meta.url);
  const world = JSON.parse(readFileSync(new URL('content/worlds/world_m1.world.json', root), 'utf8'));
  const areas = JSON.parse(readFileSync(new URL('content/quests/areas.json', root), 'utf8')).areas;
  return lintQuestZones({ world, areas, defs: quests.map((q) => q.def), bandMinAt: await realBandMinAt() }).map(zoneWarning);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const v = await import('./validate-content.mjs');
  const dir = fileURLToPath(new URL('../content/quests', import.meta.url));
  const a = await v.loadDesignAssets(), f = v.loadQuestFiles(dir), p = await v.loadPackQuests(dir, a?.items?.defs);
  const w = await lintRealZones({ quests: [...f.quests, ...p.quests] });
  console.log(w.join('\n') || 'no hits'); console.log(w.length + ' hit(s)');
}
