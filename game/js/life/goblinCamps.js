// game/js/life/goblinCamps.js (GOB-04, architecture.md 38.57 (3)): goblin camps on the Outwall west bank.
// Rule 15 (game/js/life/**): no Math.random, no trig, no clock, 0 alloc per step.
//
//   ensureGoblinCamps(world, defs, terrain?)          // BEFORE createBeastSim: adds the member beast entities + brazier props
//   const camps = createGoblinCamps({ defs, sim, events, state });
//   camps.step(dayIndex, px, py);                     // once per game step (cheap: one distance test per camp)
//
// sim API used (GOB-01, beastSim): slotOf, isDead, setDormant(slot, on), flee(slot), setDown(slot, on).
//   setDown(slot, true)  = the slot goes to STATE_GONE (hidden, skipped); setDown(slot, false) = back alive at home, hp max.
//   (setDown is NOT in the 38.57 sim list: GOB-01 or a small follow-up must provide it.)
// Saved keys (world.state, and ONLY these): life.camp.<id>.cleared (stays true, quests read it), .day (dayIndex when cleared),
// .down (drives the GONE state). The goblins themselves reset on load like every beast.
// Events: life:camp:cleared {id}.

export const WEST_X = 1100;          // same as band.js: x < WEST_X is the west bank
export const DORMANT_R = 160;        // > this from the player: camp dormant
export const WAKE_R = 140;           // < this: awake again (hysteresis)
export const RESPAWN_FAR_R = 150;    // a down camp returns only when the player is farther than this
export const GOBLIN_SPECIES = 'goblin';
export const GOBLIN_MODEL = 'goblin'; // keep equal to goblinBrain.GOBLIN_MODEL

export const clearedKey = (id) => 'life.camp.' + id + '.cleared';
export const dayKey = (id) => 'life.camp.' + id + '.day';
export const downKey = (id) => 'life.camp.' + id + '.down';

/** Enabled camp defs of a goblinCamps.json object (disabled entries are authored but never spawn). */
export function activeCamps(json) { return (json.camps || []).filter((c) => c.enabled !== false); }

/** World helper (call BEFORE createBeastSim, like ensureWolves). Returns the number of goblins added. */
export function ensureGoblinCamps(world, defs, terrain) {
  let n = 0;
  for (const c of defs) {
    for (const m of c.members) {
      if (world.get && world.get(m.id)) continue; // WMP-09: a world restored from a save already holds the camp members - add only the missing ones
      const x = c.at[0] + m.at[0], y = c.at[1] + m.at[1];
      const z = terrain && terrain.groundAt ? terrain.groundAt(x, y) : 0;
      world.addEntity({
        id: m.id, type: 'beast', transform: { x, y, z, yaw: 0 },
        components: {
          brain: { kind: 'beast', species: GOBLIN_SPECIES, role: m.role, home: [x, y], leashR: c.leashR, camp: c.id },
          targetable: { height: 1.2, radius: 0.4 },
          voxel: { t: 0, frame: 0, speed: 1, playing: true, anim: 'idle', loop: true, model: GOBLIN_MODEL },
        },
      });
      n++;
    }
    for (let k = 0; k < c.props.length; k++) {
      const p = c.props[k];
      world.addEntity({ id: c.id + '.prop' + k, type: 'prop', transform: { x: c.at[0] + p.at[0], y: c.at[1] + p.at[1], z: terrain && terrain.groundAt ? terrain.groundAt(c.at[0] + p.at[0], c.at[1] + p.at[1]) : 0, yaw: p.yaw || 0 }, components: { voxel: { model: p.model } } });
    }
  }
  return n;
}

export function createGoblinCamps({ defs, sim, events, state }) {
  const n = defs.length;
  const slots = defs.map((d) => d.members.map((m) => sim.slotOf(m.id)).filter((s) => s >= 0));
  const total = slots.map((s) => s.length);
  const dead = new Int32Array(n);
  const fled = new Uint8Array(n);
  const dormant = new Uint8Array(n);
  const slotCamp = new Map();            // slot -> camp index
  slots.forEach((list, c) => list.forEach((s) => slotCamp.set(s, c)));
  const evPayload = defs.map((d) => ({ id: d.id }));
  const cKey = defs.map((d) => clearedKey(d.id)), dKey = defs.map((d) => dayKey(d.id)), wKey = defs.map((d) => downKey(d.id));
  let lastDay = 0;

  function setDown(c, on) {
    for (let k = 0; k < slots[c].length; k++) sim.setDown(slots[c][k], on);
    if (on) dead[c] = total[c];
    else { // BH-S5: tell the save relay these members are alive again (it prunes its `dead` set)
      dead[c] = 0; fled[c] = 0;
      for (const m of defs[c].members) events.emit('beast:respawned', { id: m.id });
    }
  }
  // create / load: a camp that was down stays down (its slots go to GONE until the respawn rule lets them back)
  for (let c = 0; c < n; c++) if (state[wKey[c]]) setDown(c, true);

  const offDied = events.on('beast:died', (p) => {
    const s = sim.slotOf(p.id), c = s >= 0 ? slotCamp.get(s) : undefined;
    if (c === undefined || state[wKey[c]]) return;
    dead[c]++;
    if (dead[c] >= total[c]) { // all members dead: the camp is cleared and down
      state[cKey[c]] = true; state[dKey[c]] = lastDay; state[wKey[c]] = true;
      events.emit('life:camp:cleared', evPayload[c]);
    } else if (!fled[c] && dead[c] * 2 >= total[c]) { // half dead: the survivors run once, then walk back to camp
      fled[c] = 1;
      for (let k = 0; k < slots[c].length; k++) if (!sim.isDead(slots[c][k])) sim.flee(slots[c][k]);
    }
  });

  // beasts:reset (resetAll) brings every slot back alive: re-apply the down state and clear the per-camp counters
  const offReset = events.on('beasts:reset', () => {
    for (let c = 0; c < n; c++) { dead[c] = 0; fled[c] = 0; dormant[c] = 0; if (state[wKey[c]]) setDown(c, true); }
  });

  return {
    step(dayIndex, px, py) {
      lastDay = dayIndex;
      for (let c = 0; c < n; c++) {
        const dx = defs[c].at[0] - px, dy = defs[c].at[1] - py, d2 = dx * dx + dy * dy;
        if (state[wKey[c]]) { // down: respawn after respawnDays, only with the player far away
          if (dayIndex - (state[dKey[c]] | 0) >= defs[c].respawnDays && d2 > RESPAWN_FAR_R * RESPAWN_FAR_R) {
            state[wKey[c]] = false; setDown(c, false); dormant[c] = 0;
          }
          continue;
        }
        if (!dormant[c] && d2 > DORMANT_R * DORMANT_R) { dormant[c] = 1; for (let k = 0; k < slots[c].length; k++) sim.setDormant(slots[c][k], true); }
        else if (dormant[c] && d2 < WAKE_R * WAKE_R) { dormant[c] = 0; for (let k = 0; k < slots[c].length; k++) sim.setDormant(slots[c][k], false); }
      }
    },
    isDown: (c) => !!state[wKey[c]],
    isDormant: (c) => dormant[c] === 1,
    deadCount: (c) => dead[c],
    dispose() { offDied(); offReset(); },
  };
}
