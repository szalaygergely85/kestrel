// WS1-06b (D-060, architecture 38.36 item 3 + 38.37 item 3): wake the dead relays (waystone kind 'relay').
// Generalises beacon.js's stepBeacon (the tower beacon keys stay untouched): per-relay state lives in a small array built once
// per world load; `step` allocates nothing. Wake = `wake` clip + hum, the point light on at the model's glow event (palette
// `lights.relay.grow` ramp through lights.entityHandle), `awake` loop when the clip ends. Waking emits `prop:touched {id, kind:'relay'}`;
// the waystone wire turns that into the sim touch (heal + ONE save + respawn anchor). E on an awake relay = the same touch, no replay.
// CRYSTAL GATE (D-062, "crystal wakes stones"): waking needs the world flag `aether.attuned` (set by CH1-03). Without it E only shows a hint.
import { playRelayHum } from '../audio/sfx.js';
import { RELAY_WAKE } from './wire/waystone.js';

export const FLAG_ATTUNED = 'aether.attuned';
export const PROMPT_WAKE = '[E] Hold up the crystal'; // story.md q06 prompt.relay.wake
export const PROMPT_TOUCH = '[E] Touch the waystone';    // WS1-W1 prompt.relay.touch
// story.md q06 hint.relay.nocrystal (PC-B writer 2026-10-10, owner-authorised while PC-A offline).
// OB-165 (writer, owner-authorised): the Ford Waystone is cold until Rook's glass is mounted; the hint depends on whether the quest is taken.
export const HINT_FORD_NOQUEST = { key: 'hint.ford.noglass', text: 'Cold stone. Its glass is gone. Ask Rook.' };
export const HINT_FORD_GLASS = { key: 'hint.ford.glassquest', text: "The mount is empty. The glass is in Rook's nest." };
export const HINT_NO_CRYSTAL = { key: 'hint.relay.nocrystal', text: 'Cold stone. Your hands are not enough.' };
// Wake notice (story.md q06 notice.relay.title / notice.relay); CH1-04a replaces the toast with the notice view.
export const NOTICE = ['WAYSTONE AWAKENED', 'Travel unlocked.', 'You can now travel between', 'awakened Waystones.'];
export const FLAG_STONE_TOLD = 'dlg.bear.stone.told'; // set by Burl's stone talk (bear.dialogue.json)
export const PROMPT_STONE = '[E] Hold up the crystal';
// OB-145: while the wake is blocked the prompt is plain, and E names the missing step (story.md q06, NEEDS WRITER to polish).
export const PROMPT_LOOK = '[E] Look at the waystone';
export const HINT_NEED_CRYSTAL = "You need Burl's crystal.", HINT_NEED_WAYSTONE = 'Wake the Waystone by the tower first.', HINT_NEED_TALK = 'Ask Burl about the stone.';
export const RADIUS = 2.2;
// D-080 / OB-146: the first wake of any waystone shows what it unlocked (the task part only when a task waits there).
export const CARD_BASE = 'Waystone woken: travel (M), heal + save', CARD_TASK = ', new task.';
const TASK_WS = new Set(['ws_roadBend', 'ws_ford', 'ws_outwall']); // errands hang on these; region waystones carry RELAY_WAKE + a region task
export function wakeCard(wsId, hasTask) { return CARD_BASE + (hasTask ? CARD_TASK : '.'); }
const TOAST_SEC = 4, TOAST_Y = 6, FG = [236, 226, 190], BG = [10, 11, 16];
const DEAD = 0, WAKING = 1, AWAKE = 2;
const WAKE_MAX_EXTRA = 3; // s after light-on + grow before a stuck wake is forced awake

// QL-07 (D-011 SOS): the Bend relay blinks 3 short + 3 long, 3 times, once after it first wakes (not replayed on reload).
const BEND_WS = 'ws_roadBend', PULSE_CYCLES = 3, PULSE_GAP = 1.5, PULSE_OFF = 0.12;
const PULSE_SEQ = [0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.75, 0.25, 0.75, 0.25, 0.75, 0.25]; // on, off, on, off ... (seconds)
const PULSE_CYCLE = PULSE_SEQ.reduce((a, b) => a + b, 0) + PULSE_GAP;
/** Light factor 0..1 at pulse time t (seconds since the relay became awake); -1 when the pulse is over. Pure, allocation-free. */
export function pulseFactor(t) {
  if (t >= PULSE_CYCLES * PULSE_CYCLE) return -1;
  let u = t % PULSE_CYCLE;
  for (let i = 0; i < PULSE_SEQ.length; i++) { if (u < PULSE_SEQ[i]) return i % 2 === 0 ? 1 : PULSE_OFF; u -= PULSE_SEQ[i]; }
  return 1; // the gap between cycles: steady
}
const FORD_WS = 'ws_ford', FLAG_MIRROR = 'mq.ford.mirror.glass'; // set by errands.mainSync while relay.mirror is in the pack
const woken = (wsId) => 'waystone.' + wsId + '.woken';

/** Seconds from the start of `wake` to the light switching on (voxel event glowOn, else relay wakeLightFrame / fps, else 0.25). */
function lightDelay(model) {
  const a = model && model.voxel && model.voxel.animations && model.voxel.animations.wake;
  if (a && a.events && typeof a.events.glowOn === 'number' && Array.isArray(a.durations)) {
    let s = 0;
    for (let i = 0; i < a.events.glowOn && i < a.durations.length; i++) s += a.durations[i];
    return s / 1000;
  }
  const w = model && model.animations && model.animations.wake;
  if (model && w && w.fps && typeof model.wakeLightFrame === 'number') return model.wakeLightFrame / w.fps;
  return 0.25;
}

/**
 * OB-123: the pick volume covers the WHOLE visible stone (the default 0.3x0.3x0.4 m box at z+1 only matched looking down at its
 * middle). World AABB from the voxel model (cellM * size, anchor z = cells below the ground point), else the sprite `world`
 * size, else the entity collider component, else a 1.2 x 1.2 x 2.2 m fallback. Square footprint (yaw-independent), +0.1 m.
 */
export function stonePick(e, model) {
  const t = e.transform, c = e.components || {}, v = model && model.voxel;
  let w = 1.2, d = 1.2, h = 2.2, below = 0;
  if (v && Array.isArray(v.size) && typeof v.cellM === 'number') {
    w = v.size[0] * v.cellM; d = v.size[1] * v.cellM; h = v.size[2] * v.cellM;
    below = Array.isArray(v.anchor) && typeof v.anchor[2] === 'number' ? v.anchor[2] * v.cellM : 0;
  } else if (model && model.world && typeof model.world.h === 'number') { w = d = model.world.w || 1.2; h = model.world.h; }
  else if (c.collider && typeof c.collider.h === 'number') { w = d = (c.collider.r || 0.6) * 2; h = c.collider.h; }
  const r = Math.max(w, d) * 0.5 + 0.1;
  return { x0: t.x - r, x1: t.x + r, y0: t.y - r, y1: t.y + r, z0: t.z - below, z1: t.z - below + h };
}

/**
 * @param {{questFlag?:(k:string)=>void, notice?:{push:(key:string)=>boolean}, world:Object, palette?:Object, emit:(id:string,kind:string,pos:Object)=>void, hum?:()=>void}} o
 *   emit = gameHooks.emitSimple('prop:touched', ...) in main.js; hum defaults to playRelayHum.
 */
export function createRelayWake(o) {
  const { world, palette, emit } = o, hum = o.hum || playRelayHum;
  const relays = [];
  const toast = { left: 0, line: null };
  const card = { left: 0, line: null };
  const hint = { left: 0, line: null };
  /** OB-145: the plain-text reason a dormant relay/stone cannot be woken yet, or null when the gate is open. */
  function blockedHint(r) {
    if (!world.state[FLAG_ATTUNED]) return HINT_NEED_CRYSTAL;
    if (r.stone) return world.state[FLAG_STONE_TOLD] ? null : HINT_NEED_TALK;
    return world.state[woken('waystone')] ? null : HINT_NEED_WAYSTONE;
  }
  const pos = { x: 0, y: 0, z: 0 };
  world.forEachEntity((e) => {
    const w = e && e.components && e.components.waystone;
    if (!w || (w.kind !== 'relay' && w.kind !== 'stone') || typeof w.id !== 'string') return;
    const stone = w.kind === 'stone'; // CH1-04b: the dormant meadow stone wakes the same way (needs Burl's stone talk + the crystal)
    if (stone && !w.dormant) return;
    const comp = e.components.voxel || e.components.sprite;
    const model = comp && world.assets && world.assets.has && world.assets.has('model', comp.model) ? world.assets.model(comp.model) : null;
    const preset = palette && palette.lights && e.components.light && palette.lights[e.components.light.preset];
    const r = {
      entId: e.id, wsId: w.id, stone, notice: typeof w.notice === 'string' ? w.notice : 'relay', phase: DEAD, t: 0, delay: lightDelay(model), lightOn: false, growDone: false,
      growDur: preset && preset.grow && typeof preset.grow.duration === 'number' ? preset.grow.duration : 1,
      target: preset && typeof preset.intensity === 'number' ? preset.intensity : null,
      rec: null, pulseT: -1, wasAwake: false,
    };
    // Reload/restart: a woken relay comes back awake + light on, no hum.
    if (world.state[woken(r.wsId)]) {
      r.phase = AWAKE; r.lightOn = true;
      if (e.components.light) e.components.light.on = true;
      const h = world.get(e.id); if (h) h.play('awake');
    }
    r.rec = world.addInteractable({
      key: stone ? 'stone.' + r.wsId : 'relay.' + r.wsId, requires: r.phase === AWAKE || !stone ? undefined : FLAG_STONE_TOLD, name: 'relay.wake', x: e.transform.x, y: e.transform.y, z: e.transform.z + 1, radius: RADIUS, pick: stonePick(e, model),
      prompt: r.phase === AWAKE ? PROMPT_TOUCH : PROMPT_WAKE, def: { waystoneId: r.wsId, entityId: e.id },
    });
    relays.push(r);
  });

  function find(wsId) { for (let i = 0; i < relays.length; i++) if (relays[i].wsId === wsId) return relays[i]; return null; }
  function touch(r) {
    const h = world.get(r.entId), tr = h && h.data && h.data.transform;
    pos.x = tr ? tr.x : 0; pos.y = tr ? tr.y : 0; pos.z = tr ? tr.z : 0;
    emit(r.wsId, r.stone ? 'waystone' : 'relay', pos);
  }
  /** One function so CH1-04a can swap the toast for the notice view. */
  function showWakeNotice(r) {
    const task = o.hasTask ? !!o.hasTask(r.wsId) : (!r.stone && (TASK_WS.has(r.wsId) || !!RELAY_WAKE[r.wsId]));
    card.line = wakeCard(r.wsId, task); card.left = TOAST_SEC + 2;
    const line = RELAY_WAKE[r.wsId]; // WM-13b: a region relay shows its own line (toast); old relays keep the notice/generic toast
    if (line) { toast.line = line; toast.left = TOAST_SEC; return; }
    toast.line = null;
    if (o.notice && o.notice.push(r.notice)) return; toast.left = TOAST_SEC; // CH1-04a: notice view when injected, toast fallback (tests)
  }

  return {
    relays,
    /** `relay.wake` behaviour body (E on the interactable). Returns true when something happened. */
    interact(wsId) {
      const r = find(wsId);
      if (!r || r.phase === WAKING) return false;
      if (r.phase === AWAKE) { touch(r); return true; }
      const why = blockedHint(r); if (why) { hint.line = why; hint.left = TOAST_SEC; return false; } // gate: the crystal wakes stones
      if (r.wsId === FORD_WS && !world.state[FLAG_MIRROR]) { hint.line = (o.questActive && o.questActive('mq.ford.mirror') ? HINT_FORD_GLASS : HINT_FORD_NOQUEST).text; hint.left = TOAST_SEC; return false; } // mq.ford.mirror: the mount is empty until the player holds relay.mirror
      const h = world.get(r.entId);
      if (h) h.play('wake');
      hum();
      r.phase = WAKING; r.t = 0; r.rec.prompt = PROMPT_TOUCH;
      world.state[woken(r.wsId)] = true;
      if (o.questFlag) o.questFlag(woken(r.wsId)); // chain flag (m1 step 'waystone'); BEFORE touch so errands gated on it are offered by the wake touch (WMP-01)
      touch(r);
      r.rec.requires = undefined; // woken: E = plain touch
      showWakeNotice(r);
      return true;
    },
    /** Fixed step: timer, light on + grow ramp, wake -> awake. No allocation. `lights` may be null (?lights=0). */
    step(dt, lights) {
      if (toast.left > 0) toast.left -= dt;
      if (card.left > 0) card.left -= dt;
      if (hint.left > 0) hint.left -= dt;
      for (let i = 0; i < relays.length; i++) {
        const r = relays[i];
        if (r.phase === DEAD) { r.rec.prompt = blockedHint(r) ? PROMPT_LOOK : (r.stone ? PROMPT_STONE : PROMPT_WAKE); continue; } // OB-145
        if (r.phase === AWAKE) {
          if (!r.growDone && r.target !== null && lights) {
            const lh = lights.entityHandle.get(r.entId);
            if (lh !== undefined) { lights.baseIntensity[lh] = r.target; r.growDone = true; }
          }
          if (r.wsId === BEND_WS && r.pulseT >= 0 && r.target !== null && lights) { // SOS blink
            r.pulseT += dt;
            const lh = lights.entityHandle.get(r.entId), f = pulseFactor(r.pulseT);
            if (lh !== undefined) lights.baseIntensity[lh] = r.target * (f < 0 ? 1 : f);
            if (f < 0) r.pulseT = -1;
          }
          continue;
        }
        const h = world.get(r.entId), d = h && h.data, c = d && (d.components.voxel || d.components.sprite);
        r.t += dt;
        if (r.t >= r.delay && !r.lightOn) { if (d && d.components.light) d.components.light.on = true; r.lightOn = true; }
        let frac = 0;
        if (r.lightOn) {
          frac = r.growDur > 0 ? Math.min(1, (r.t - r.delay) / r.growDur) : 1;
          const lh = lights && r.target !== null ? lights.entityHandle.get(r.entId) : undefined;
          if (lh !== undefined) lights.baseIntensity[lh] = r.target * frac;
        }
        if (c && c.anim === 'wake' && c.playing === false && h) h.play('awake');
        if (frac >= 1 && c && c.anim === 'awake') { r.phase = AWAKE; r.growDone = true; r.pulseT = 0; }
        else if (r.t > r.delay + r.growDur + WAKE_MAX_EXTRA) { // model without a `wake` clip: never stay WAKING (E would be dead)
          if (d && d.components.light) d.components.light.on = true;
          r.lightOn = true; r.phase = AWAKE; r.pulseT = 0; if (h) h.play('awake');
        }
      }
    },
    get toastLeft() { return toast.left; },
    get cardLeft() { return card.left; },
    get cardLine() { return card.line; },
    get hintLeft() { return hint.left; },
    get hintLine() { return hint.line; },
    drawHud(ui) {
      if (card.left > 0 && card.line) plate(ui, card.line, TOAST_Y + 5);
      if (toast.left > 0 && toast.line) plate(ui, toast.line, TOAST_Y);
      else if (toast.left > 0) for (let i = 0; i < NOTICE.length; i++) plate(ui, NOTICE[i], TOAST_Y + i);
      else if (hint.left > 0) plate(ui, hint.line || HINT_NO_CRYSTAL.text, TOAST_Y);
    },
  };
}

function plate(ui, s, y) { // no closure per draw
  for (let j = -1; j <= s.length; j++) plateCell(ui, 2 + j, y, 32);
  for (let j = 0; j < s.length; j++) plateCell(ui, 2 + j, y, s.charCodeAt(j));
}
function plateCell(ui, x, y, code) { if (x >= 0 && x < ui.cols) ui.setCellRGB(x, y, code - 32, FG[0], FG[1], FG[2], BG[0], BG[1], BG[2]); }

let api = null;
/** main.js: point the `relay.wake` behaviour at this load's relays (or null). */
export function setRelayWakeApi(a) { api = a; }
/** `relay.wake` behaviour (quest/index.js). Never consumes the interactable. */
export function relayWake(ctx) {
  if (api && ctx && ctx.def && ctx.def.waystoneId) api.interact(ctx.def.waystoneId);
  return false;
}
