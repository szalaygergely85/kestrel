// game/js/quest/dialogueCtl.js (DIALOGUE-01b2, architecture.md 38.28 items 3-6, 8).
// Owns the dialogue runner + view for one world: key edges, the input lock, flags in
// world.state['dlg.*'], damage close, NPC clips and the [E] Talk interactable.
// Works with any entity whose `components.dialogue` is a dialogue id (string or {id}).
// Zero allocation per step: keys are interned constants, clip names are data strings.
import { createDialogueRunner } from '../../../engine/index.js';
import { createDialogueView } from './dialogueView.js';
import { createJawSync } from './jawSync.js';

const CONFIRM_KEYS = ['KeyE', 'Enter'];
const UP_KEYS = ['KeyW', 'ArrowUp'], DOWN_KEYS = ['KeyS', 'ArrowDown'];

let api = null;
/** main.js: point the `npc.talk` behaviour at this load's ctl (or null). */
export function setDialogueApi(a) { api = a; }
/** Behaviour `npc.talk` (registered in quest/index.js). `ctx.def.npcId` = entity id. Returns false (never "used"). */
export function npcTalk(ctx) {
  if (api && ctx && ctx.def && ctx.def.npcId) api.openFor(ctx.def.npcId);
  return false;
}

/**
 * @param {{world:any, dialogues:Record<string,any>, events?:{on:Function}, style?:object,
 *   cps?:number, onFlag?:(key:string,v:boolean)=>void, onTalk?:(npcId:string)=>void}} opt
 *   dialogues = bundle.dialogues (compiled). events: listens to 'combat:hit' on the player (damage closes).
 */
export function createDialogueCtl(opt) {
  const { world, dialogues } = opt;
  const view = createDialogueView({ style: opt.style, palette: opt.palette }); // palette: ASSETS.palette (default globalThis.ASSETS.palette)
  const flags = {
    has: (k) => world.state['dlg.' + k] === true,
    set: (k) => {
      world.state['dlg.' + k] = true;
      if (opt.onFlag) opt.onFlag(k, true); // main.js: gameHooks.emitSimple('flag:set', ...)
    },
  };
  let npcId = null;       // entity id of the current speaker NPC
  let pendingClip = null; // node clip waiting to be played once
  let oneShot = false;    // a node clip is playing
  let lastBase = null;    // last talk/listen/idle we asked for
  const jaw = createJawSync({ maxDeg: opt.jawOpenDeg }); // opt.jawOpenDeg = model def's jawOpenDeg, else fallback
  let jawComp = null;     // voxel component of the NPC whose jaw we drive
  const runner = createDialogueRunner({
    cps: opt.cps || view.cps, // typing speed: explicit opt, else the style's typeOn.cps (28)
    onEvent(name) {
      if (name === 'node') { pendingClip = runner.clip; oneShot = false; lastBase = null; } // a new node cuts the old one-shot
    },
  });

  const ctl = {
    runner, view,
    /** true while the box is open and for the rest of the step in which it closed. */
    locked: false,
    get open() { return runner.state !== 'idle' && runner.state !== 'ended'; },
    _closing: false,

    /** Entity id -> dialogue id (components.dialogue as string or {id}), else null. */
    dialogueIdOf(id) {
      const h = world.get(id), d = h && h.data;
      const c = d && d.components && d.components.dialogue;
      return typeof c === 'string' ? c : (c && c.id) || null;
    },

    /** Opens the conversation of NPC entity `id`. Returns false when it has no (known) dialogue or one is open. */
    openFor(id) {
      if (ctl.open) return false;
      const did = ctl.dialogueIdOf(id);
      const comp = did && dialogues[did];
      if (!comp) return false;
      npcId = id; pendingClip = null; oneShot = false; lastBase = null;
      runner.open(comp, flags);
      ctl.locked = true; ctl._closing = false;
      if (opt.onTalk) opt.onTalk(id);
      ctl._clips();
      return true;
    },

    /** Registers the [E] Talk interactable for NPC entity `id` (call on every 'world:loaded'). */
    addNpc(id, o = {}) {
      const h = world.get(id), t = h && h.data && h.data.transform;
      if (!t) return null;
      return world.addInteractable({
        key: 'npc.' + id, name: 'npc.talk', x: t.x, y: t.y, z: t.z + (o.lift ?? 1), radius: o.radius ?? 2.2,
        prompt: o.prompt ?? '[E] Talk', def: { npcId: id },
      });
    },

    /** Close now (Esc, damage, world reload). The lock holds through the rest of this step. */
    close() {
      if (!ctl.open) return;
      runner.close();
      ctl._finish();
    },
    _finish() {
      ctl._closing = true; // locked stays true until the next step() begins
      if (npcId !== null) ctl._play('idle');
      npcId = null; pendingClip = null; oneShot = false; lastBase = null;
    },
    /** Damage to the player closes the box. */
    notifyDamage() { ctl.close(); },

    /**
     * Fixed-step update. Call EARLY in the step (before the input lock is read).
     * @param {number} dt seconds
     * @param {{pressed:(code:string)=>boolean}} input
     * @param {boolean} [lookLocked] pointer lock state; false = pause overlay up -> close
     */
    step(dt, input, lookLocked) {
      if (ctl._closing) { ctl._closing = false; ctl.locked = false; } // the closing step is over
      ctl._jaw(dt);
      if (!ctl.open) { if (runner.state === 'ended') runner.state = 'idle'; return; }
      if (lookLocked === false) { ctl.close(); return; }
      if (input.pressed('Escape')) { ctl.close(); return; }
      if (runner.state === 'choosing') {
        if (input.pressed(UP_KEYS[0]) || input.pressed(UP_KEYS[1])) runner.move(-1);
        if (input.pressed(DOWN_KEYS[0]) || input.pressed(DOWN_KEYS[1])) runner.move(1);
      }
      if (input.pressed(CONFIRM_KEYS[0]) || input.pressed(CONFIRM_KEYS[1])) {
        if (runner.state === 'choosing') runner.choose(); else runner.press();
      } // one confirm per step: a pick never also advances the next line
      runner.tick(dt);
      if (runner.state === 'ended') { ctl._finish(); return; }
      ctl._clips();
    },

    /** talk while an NPC line types, listen otherwise; a node clip plays once, then returns. */
    _clips() {
      if (npcId === null) return;
      if (pendingClip !== null) { ctl._play(pendingClip, true); pendingClip = null; oneShot = true; lastBase = null; return; }
      if (oneShot) {
        const h = world.get(npcId), c = h && h.data && h.data.components && (h.data.components.voxel || h.data.components.sprite);
        if (c && c.playing) return;
        oneShot = false;
      }
      const base = runner.state === 'typing' && !runner.isPlayer ? 'talk' : 'listen';
      if (base !== lastBase) { lastBase = base; ctl._play(base, false); }
    },
    /** Jaw lip-sync: follows the typed char while open; eases closed afterwards (then drops the ref). */
    _jaw(dt) {
      if (jawComp === null && npcId !== null) {
        const h = world.get(npcId), c = h && h.data && h.data.components && h.data.components.voxel;
        if (c) jawComp = c;
      }
      if (jawComp === null) return;
      jaw.step(dt, ctl.open ? runner : null, jawComp);
      if (!ctl.open && jaw.angle === 0) jawComp = null;
    },
    _play(clip, once) {
      const h = world.get(npcId);
      if (!h) return;
      if (once) h.play(clip, { loop: false, restart: true }); else h.play(clip);
    },

    /** Draw the box (UiLayer). */
    draw(layer, timeSec) { if (ctl.open) view.draw(layer, runner, timeSec); },
  };
  if (opt.events) {
    ctl._off = opt.events.on('combat:hit', (p) => { if (p && p.target === 'player') ctl.notifyDamage(); });
  }
  ctl.dispose = () => { if (ctl._off) ctl._off(); ctl.close(); };
  return ctl;
}
