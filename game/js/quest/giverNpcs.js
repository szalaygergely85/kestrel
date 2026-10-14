// D-098 / QFIX-S5a-4 + S5c: the placed quest-giver NPCs (post-keeper Tobin + 10 region givers). Entities live in world_m1.
// Tobin appears only once mq.smoke is done (keeps "Smoke. Cookfires. Out here?"): voxel.hidden + no [E] talk before that, and his quests
// keep their old giver/turn-in ids (giverResolve hidden set). Looks: own char.<npcLooks id> per giver (GIVER_LOOK, registerGiverLooks at boot).
import { setPlacedNpcs, setHiddenNpcs } from './sim/giverResolve.js';

export const GIVER_NAMES = { postKeeper: 'Tobin', npcGlasswater: 'Ansel', npcNorthwood: 'Garrow', npcHighPastures: 'Ilsa', npcAshMile: 'Coll', npcDowns: 'Petra', npcSignalHill: 'Jory', npcHeath: 'Tansy', npcReedmire: 'Osk', npcStrand: 'Nell', npcWhitecombs: 'Kettil' };
/** giver entity id -> design/chargen/npc_looks.js id (model 'char.' + id). */
export const GIVER_LOOK = { postKeeper: 'npcPostKeeper', ...Object.fromEntries(Object.keys(GIVER_NAMES).filter((k) => k !== 'postKeeper').map((k) => [k, k])) };
/** NPC-LOOKS-01: register char.<look> for every giver. deps = { compose, mesh, collapse, rigged } (engine fns); returns the ids added. */
export function registerGiverLooks(assets, kit, npcLooks, { compose, mesh, collapse, rigged }) {
  const K2 = npcLooks.extendKit(kit), added = [];
  for (const id of npcLooks.ids) {
    const mid = 'char.' + id; if (assets.has('model', mid)) continue;
    try { assets.add('model', mid, rigged(collapse(mesh(compose(K2, K2.looks[id])), K2.partMap))); added.push(id); } catch (e) { console.warn('[' + mid + '] ' + e.message); }
  }
  return added;
}
/** id -> world.state flag that must be true before the NPC exists (absent = always there). */
export const GIVER_GATES = { postKeeper: 'mq.smoke.done' };

/** Call on every 'world:loaded' after the world has its entities. `refresh(true)` re-checks (quest:done mq.smoke). */
export function installGiverNpcs({ world, ctl }) {
  const talk = new Set();
  const refresh = (force) => {
    const placed = [], hidden = [];
    for (const id of Object.keys(GIVER_NAMES)) {
      const h = world.get(id); if (!h || !h.data) continue;
      const gate = GIVER_GATES[id], on = !gate || !!world.state[gate] || force === true;
      const v = h.data.components && h.data.components.voxel;
      if (v && v.hidden !== !on) { v.hidden = !on; world.renderVersion++; }
      if (on) { placed.push(id); if (!talk.has(id)) { talk.add(id); ctl.addNpc(id); } } else hidden.push(id);
    }
    setPlacedNpcs(placed); setHiddenNpcs(hidden);
  };
  refresh();
  return { refresh };
}
