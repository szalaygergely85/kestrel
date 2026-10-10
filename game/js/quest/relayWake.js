// WS1-06b (D-060, architecture 38.36 item 3 + 38.37 item 3): wake the dead relays (waystone kind 'relay').
// Generalises beacon.js's stepBeacon (the tower beacon keys stay untouched): per-relay state lives in a small array built once
// per world load; `step` allocates nothing. Wake = `wake` clip + hum, the point light on at the model's glow event (palette
// `lights.relay.grow` ramp through lights.entityHandle), `awake` loop when the clip ends. Waking emits `prop:touched {id, kind:'relay'}`;
// the waystone wire turns that into the sim touch (heal + ONE save + respawn anchor). E on an awake relay = the same touch, no replay.
// CRYSTAL GATE (D-062, "crystal wakes stones"): waking needs the world flag `aether.attuned` (set by CH1-03). Without it E only shows a hint.
import { playRelayHum } from '../audio/sfx.js';

export const FLAG_ATTUNED = 'aether.attuned';
export const PROMPT_WAKE = '[E] Hold up the crystal'; // story.md q06 prompt.relay.wake
export const PROMPT_TOUCH = '[E] Touch the relay';    // WS1-W1 prompt.relay.touch
// NEEDS WRITER: relay without crystal (no story.md line yet) - placeholder key + text, not canon.
export const HINT_NO_CRYSTAL = { key: 'hint.relay.nocrystal.PLACEHOLDER', text: 'The relay stays dark.' };
// Wake notice (story.md q06 notice.relay.title / notice.relay); CH1-04a replaces the toast with the notice view.
export const NOTICE = ['BEND RELAY AWAKENED', 'Travel unlocked.', 'You can now travel between', 'awakened Waystones.'];
export const FLAG_STONE_TOLD = 'dlg.bear.stone.told'; // set by Burl's stone talk (bear.dialogue.json)
export const PROMPT_STONE = '[E] Hold up the crystal';
export const RADIUS = 2.2;
const TOAST_SEC = 4, TOAST_Y = 6, FG = [236, 226, 190], BG = [10, 11, 16];
const DEAD = 0, WAKING = 1, AWAKE = 2;
const WAKE_MAX_EXTRA = 3; // s after light-on + grow before a stuck wake is forced awake

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
 * @param {{questFlag?:(k:string)=>void, notice?:{push:(key:string)=>boolean}, world:Object, palette?:Object, emit:(id:string,kind:string,pos:Object)=>void, hum?:()=>void}} o
 *   emit = gameHooks.emitSimple('prop:touched', ...) in main.js; hum defaults to playRelayHum.
 */
export function createRelayWake(o) {
  const { world, palette, emit } = o, hum = o.hum || playRelayHum;
  const relays = [];
  const toast = { left: 0 };
  const hint = { left: 0 };
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
      rec: null,
    };
    // Reload/restart: a woken relay comes back awake + light on, no hum.
    if (world.state[woken(r.wsId)]) {
      r.phase = AWAKE; r.lightOn = true;
      if (e.components.light) e.components.light.on = true;
      const h = world.get(e.id); if (h) h.play('awake');
    }
    r.rec = world.addInteractable({
      key: stone ? 'stone.' + r.wsId : 'relay.' + r.wsId, requires: r.phase === AWAKE || !stone ? undefined : FLAG_STONE_TOLD, name: 'relay.wake', x: e.transform.x, y: e.transform.y, z: e.transform.z + 1, radius: RADIUS,
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
  function showWakeNotice(r) { if (o.notice && o.notice.push(r.notice)) return; toast.left = TOAST_SEC; } // CH1-04a: notice view when injected, toast fallback (tests)

  return {
    relays,
    /** `relay.wake` behaviour body (E on the interactable). Returns true when something happened. */
    interact(wsId) {
      const r = find(wsId);
      if (!r || r.phase === WAKING) return false;
      if (r.phase === AWAKE) { touch(r); return true; }
      if (!world.state[FLAG_ATTUNED] || (r.stone && !world.state[FLAG_STONE_TOLD])) { hint.left = TOAST_SEC; return false; } // gate: the crystal wakes stones
      const h = world.get(r.entId);
      if (h) h.play('wake');
      hum();
      r.phase = WAKING; r.t = 0; r.rec.prompt = PROMPT_TOUCH;
      world.state[woken(r.wsId)] = true;
      touch(r);
      if (o.questFlag) o.questFlag(woken(r.wsId)); // chain flag (m1 step 'waystone')
      r.rec.requires = undefined; // woken: E = plain touch
      showWakeNotice(r);
      return true;
    },
    /** Fixed step: timer, light on + grow ramp, wake -> awake. No allocation. `lights` may be null (?lights=0). */
    step(dt, lights) {
      if (toast.left > 0) toast.left -= dt;
      if (hint.left > 0) hint.left -= dt;
      for (let i = 0; i < relays.length; i++) {
        const r = relays[i];
        if (r.phase === DEAD) continue;
        if (r.phase === AWAKE) {
          if (!r.growDone && r.target !== null && lights) {
            const lh = lights.entityHandle.get(r.entId);
            if (lh !== undefined) { lights.baseIntensity[lh] = r.target; r.growDone = true; }
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
        if (frac >= 1 && c && c.anim === 'awake') { r.phase = AWAKE; r.growDone = true; }
        else if (r.t > r.delay + r.growDur + WAKE_MAX_EXTRA) { // model without a `wake` clip: never stay WAKING (E would be dead)
          if (d && d.components.light) d.components.light.on = true;
          r.lightOn = true; r.phase = AWAKE; if (h) h.play('awake');
        }
      }
    },
    get toastLeft() { return toast.left; },
    get hintLeft() { return hint.left; },
    drawHud(ui) {
      if (toast.left > 0) for (let i = 0; i < NOTICE.length; i++) plate(ui, NOTICE[i], TOAST_Y + i);
      else if (hint.left > 0) plate(ui, HINT_NO_CRYSTAL.text, TOAST_Y);
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
