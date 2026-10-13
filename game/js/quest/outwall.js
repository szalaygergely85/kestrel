// game/js/quest/outwall.js (OUT-01): Hesk + Dorrin at Outwall. They already talk (content/dialogue/{hesk,dorrin}.dialogue.json,
// world_m1 entities, char.kit); this adds the shared table, turn-to-player within FACE_M and the saved `*.met` flags.
// Presentation only: writes transform.yawDeg. OUT-02 SEAM: outwallRoutines.js may set `ow.paused = true` (it owns the yaw
// while an NPC walks) or replace NPCS[i].home via `ow.setHome(id, yawDeg)`; nothing here depends on it.
import { yawFromDelta } from '../../../engine/index.js';

export const FACE_M = 6;
export const MAX_DEG_S = 180;
/** One data table: entity id -> dialogue id, met flag, talk text ids (NEEDS WRITER: the writer replaces the lines in the dialogue JSON by these node ids). */
export const NPCS = {
  hesk:   { dialogue: 'hesk',   metFlag: 'ow.hesk.met',   talkIds: ['hesk.meet.1', 'hesk.names.1'],   placeholder: 'NEEDS WRITER: hesk.meet' },
  dorrin: { dialogue: 'dorrin', metFlag: 'ow.dorrin.met', talkIds: ['dorrin.meet.1', 'dorrin.relay.1'], placeholder: 'NEEDS WRITER: dorrin.meet' },
};
/** OUT-03: the other approved characters (D-069). No entity, dialogue or met flag until a model is registered in the game
 *  (the animal files exist in design/models but are not in game/index.html or world_m1; anchors = quest-roadmap 2b / world_m1). */
export const PENDING = {
  nub:    { status: 'done elsewhere', note: 'already placed in world_m1, follows Burl (NUB-01); no lines by design' },
  skip:   { status: 'NEEDS REGISTRATION', model: 'voxel_otter.js', note: 'anchor Gullhaven jetty (1500,1715) is outside walk bounds (y max ~1110); register otter + place when the south opens' },
  stilt:  { status: 'NEEDS REGISTRATION', model: 'voxel_heron.js', note: 'anchor eel weirs (1210,1660) outside walk bounds; same steps as Skip' },
  slate:  { status: 'NEEDS REGISTRATION', model: 'voxel_tortoise.js', note: 'anchor Glasswater (1235,505) outside walk bounds; same steps as Skip' },
  crag:   { status: 'NEEDS REGISTRATION', model: 'voxel_goat.js', note: 'anchor Signal Head (760,1405) outside walk bounds; same steps as Skip' },
  sorrel: { status: 'NEEDS DESIGNER', note: 'Outwall herb-woman, no model (char.kit recolour)' },
  pell:   { status: 'NEEDS DESIGNER', note: 'Outwall child, no model' },
  tam:    { status: 'NEEDS DESIGNER', note: 'old exile singer, no model' },
  ama:    { status: 'NEEDS DESIGNER', note: 'Glasswater fisher, no model' },
  cobb:   { status: 'NEEDS DESIGNER', note: 'brother of Ama, up the river, no model' },
};
const wrap180 = (d) => { d %= 360; return d > 180 ? d - 360 : d <= -180 ? d + 360 : d; };

/** @param {{world:{get:(id:string)=>any, state:object}, questFlag:(k:string)=>void}} o */
export function createOutwall({ world, questFlag }) {
  const list = [];
  for (const id of Object.keys(NPCS)) {
    const h = world.get(id), t = h && h.data && h.data.transform;
    if (t) list.push({ id, t, home: t.yawDeg || 0, met: NPCS[id].metFlag });
  }
  const byId = (id) => { for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; };
  const ow = {
    paused: false,
    npcs: list,
    /** Dialogue opened with `id` (dialogueCtl onTalk): set the met flag once. Returns true when newly set. */
    talked(id) {
      const n = NPCS[id];
      if (!n || world.state[n.metFlag]) return false;
      questFlag(n.metFlag); return true;
    },
    setHome(id, yawDeg) { const e = byId(id); if (e) e.home = yawDeg; },
    step(dt, px, py) {
      if (ow.paused) return;
      const max = MAX_DEG_S * dt;
      for (let i = 0; i < list.length; i++) {
        const e = list[i], t = e.t, dx = px - t.x, dy = py - t.y, d2 = dx * dx + dy * dy, cur = t.yawDeg || 0;
        const target = d2 <= FACE_M * FACE_M && d2 > 1e-6 ? yawFromDelta(dx, dy) : e.home;
        const err = wrap180(target - cur);
        t.yawDeg = wrap180(cur + (err > max ? max : err < -max ? -max : err));
      }
    },
  };
  return ow;
}
