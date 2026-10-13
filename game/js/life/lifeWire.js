// LIFE-HOOKS-01: game wiring for the living world (wolf raids). Keeps main.js small; every piece is plain-data testable.
// Gate: the raid quest's accept never lands in world.state (`q.<id>.accept` is a dialogue ACTION key -> questBook.actKey), so
// raids.json `requires` reads a state flag this module mirrors from the book (status >= ACTIVE).
import { createRaids } from './raids.js';
import { createVillagers } from './villagers.js';
import { createChat } from './chat.js';
import { createBarks } from '../quest/barks.js';
import { yawFromDelta } from '../../../engine/index.js';

export const DAY_KEY = 'clock.day'; // whole game days elapsed (saved in world.state; the clock itself only stores the hour)
const ACTIVE = 2;

/** Mirror quest status into the raids' `requires` flags: defs[i].requires = 'life.gate.<questId>' -> state flag. */
export function syncGates(book, state, gates) {
  for (const key in gates) state[key] = !!book && book.statusOf(gates[key]) >= ACTIVE;
}

/** @returns {{step(hour:number):void, dispose():void, raids:object, sync():void}} one object for main.js */
export function createLifeWire({ defs, gates, sim, events, state, world, book, campDefs }) {
  const anchors = {};
  for (const d of defs) { const e = world.entity ? world.entity(d.target) : null; if (e && e.transform) anchors[d.target] = [e.transform.x, e.transform.y]; }
  const npcPos = (id, out) => { const e = world.entity ? world.entity(id) : null; if (!e || !e.transform) return false; out.x = e.transform.x; out.y = e.transform.y; return true; };
  const raids = createRaids({ defs, sim, events, state, anchors, npcPos, campDefs });
  let lastHour = state['clock.hour'] === undefined ? -1 : state['clock.hour'], syncT = 0;
  const sync = () => syncGates(typeof book === 'function' ? book() : book, state, gates);
  sync();
  return {
    raids, sync,
    /** once per sim step, after the clock ticked */
    step(hour) {
      if (hour < lastHour - 12) state[DAY_KEY] = (state[DAY_KEY] | 0) + 1; // midnight wrap (hour dropped from ~24 to ~0)
      lastHour = hour;
      if (++syncT >= 60) { syncT = 0; sync(); } // ~1 Hz is plenty for a quest gate
      raids.step(state[DAY_KEY] | 0, hour);
    },
    dispose() { raids.dispose(); },
  };
}

/** raids.json -> { defs, gates }: each `requires: "q.<questId>.accept"` becomes the state flag `life.gate.<questId>`. */
export function prepareRaidDefs(json) {
  const gates = {};
  const defs = (json.raids || []).map((r) => {
    const m = r.requires && /^q\.(.+)\.accept$/.exec(r.requires);
    if (!m) return { ...r };
    const key = 'life.gate.' + m[1]; gates[key] = m[1];
    return { ...r, requires: key };
  });
  return { defs, gates };
}

const HIDE_Z = -500, TURN_DEG_S = 240, COLL = { height: 1.7, stepUpMax: 0.45, walkCos: 0.7 };
const wrap180 = (d) => { d -= 360 * Math.round(d / 360); return d; };

/**
 * LIFE-04: the Outwall comes alive. Villagers (schedule + A* + collision push-out) drive the world_m1 NPC entities that exist
 * (Sorrel/Pell/Tam have none yet: dropped), chat pairs bark overheard lines, and the OUT-01 facing seam is split per NPC:
 * the routine owns the yaw while walking / chatting, OUT-01 faces the player (or its home yaw) otherwise.
 * @returns {null | {step(dt,hour,px,py):void, draw(ui,t):void, talked(id):void, dispose():void, villagers:object, chat:object, barks:object}}
 */
export function createOutwallLife({ world, life, nav, events, state, outwall, dialogue, barksData, style, hour, seed = 1 }) {
  const lf = { ...life, npcs: life.npcs.filter((n) => world.get(n.id)) };
  if (!lf.npcs.length || !nav) return null;
  const ents = lf.npcs.map((n) => world.get(n.id));
  const out = {}, xs = new Float64Array(ents.length), ys = new Float64Array(ents.length), player = { x: 0, y: 0 };
  let talkId = null, talking = null, lastHour = hour;
  const idx = (id) => { for (let i = 0; i < lf.npcs.length; i++) if (lf.npcs[i].id === id) return i; return -1; };
  // LIFE-04-COLLIDE: mesh colliders only. Never world.ensureBandFor here (it bakes a terrain band synchronously, 260-1400 ms);
  // outside the resident band groundAt is the coarse height, good enough for a far, LOD-snapped villager.
  const collide = (x, y, o) => {
    const r = world.collideCircle(x, y, 0, 0, 0.4, world.terrain.groundAt(x, y), true, COLL, out);
    o.x = r.x ?? x; o.y = r.y ?? y;
  };
  const recs = new Array(ents.length).fill(null);
  const findRec = (key) => { const l = world.interactables; if (l) for (let j = 0; j < l.length; j++) if (l[j].key === key) return l[j]; return null; };
  // [E] Talk interactable stays attached to the NPC: registered once while visible, its live x/y/z follow every step; removed while hidden.
  const parked = (i, hidden) => {
    const id = lf.npcs[i].id, k = 'npc.' + id;
    if (hidden) { world.removeInteractable(k); recs[i] = null; return; }
    let r = recs[i];
    if (!r || !world.interactables || world.interactables.indexOf(r) < 0) { // first time, or the world reloaded and dropped it
      if (!findRec(k)) dialogue.addNpc(id);
      r = recs[i] = findRec(k);
    }
    if (r) { const t = ents[i].data.transform; r.x = t.x; r.y = t.y; r.z = t.z + 1; }
  };
  function apply(a, i) {
    const d = ents[i].data, t = d.transform, c = d.components, v = c.voxel, wasHidden = v && v.hidden;
    t.x = a.x; t.y = a.y; t.z = a.z; xs[i] = a.x; ys[i] = a.y;
    if (c.collider && c.collider.kinematic) world.setEntityCollider(a.id, a.x, a.y, a.hidden ? HIDE_Z : a.z);
    if (v) {
      v.hidden = a.hidden;
      const clip = a.anim === 'work' ? 'idle' : a.anim; // char.kit ships idle + walk only (work: idle until a clip exists)
      if (!a.hidden && v.anim !== clip) { try { if (ents[i].play) ents[i].play(clip); else v.anim = clip; } catch (e) { /* clip missing: keep the current one */ } }
    }
    if (a.hidden !== !!wasHidden || !a.hidden) parked(i, a.hidden);
  }
  const v = createVillagers({ life: lf, nav, groundAt: (x, y) => world.terrain.groundAt(x, y), collide, hour, dayIndex: state[DAY_KEY] | 0, events, apply,
    isPaused: (id) => id === talking || chat.stopped(idx(id)) });
  const barks = createBarks({ world, data: barksData, questFlag: () => {}, dialogue, style });
  const chat = createChat({ schedule: v.sched, x: xs, y: ys, player, barks, data: barksData, seed,
    talkingToPlayer: (i) => lf.npcs[i].id === talking, canChat: (i) => !v.actors[i].hidden && v.actors[i].anim !== 'walk' && lf.npcs[i].id !== talking });
  v.snapAll(hour, state[DAY_KEY] | 0);
  const owned = new Uint8Array(ents.length);
  function face(i, dt) { // yaw: routine while walking, toward the chat partner at 240 deg/s, else OUT-01
    const a = v.actors[i], t = ents[i].data.transform, j = chat.partner(i);
    let own = 0;
    if (!a.hidden && j >= 0) {
      const d = wrap180(yawFromDelta(xs[j] - a.x, ys[j] - a.y) - t.yawDeg), m = TURN_DEG_S * dt;
      t.yawDeg += d > m ? m : d < -m ? -m : d; own = 1;
    } else if (!a.hidden && a.anim === 'walk') { t.yawDeg = a.yawDeg; own = 1; }
    if (own !== owned[i]) { owned[i] = own; if (outwall) { outwall.setOwned(a.id, own); if (!own) outwall.setHome(a.id, t.yawDeg); } }
  }
  return {
    villagers: v, chat, barks,
    talked(id) { talkId = id; },
    step(dt, hr, px, py) {
      player.x = px; player.y = py;
      const dh = wrap180((hr - lastHour) * 15) / 15; lastHour = hr; // game hours; a clock jump (?time=, sleep) re-snaps everyone
      if (dh > 0.25 || dh < -0.25) v.snapAll(hr, state[DAY_KEY] | 0);
      const t = dialogue.open ? talkId : null;
      if (t !== talking) { talking = t; if (t && idx(t) >= 0) chat.interrupt(idx(t)); }
      v.step(hr, state[DAY_KEY] | 0, px, py);
      chat.step();
      for (let i = 0; i < ents.length; i++) face(i, dt);
      barks.step(dt);
    },
    draw(ui, timeSec) { barks.draw(ui, timeSec); },
    dispose() { v.dispose(); barks.cancel(); },
  };
}
