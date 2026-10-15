// game/js/quest/dialogueCtl.js (DIALOGUE-01b2, architecture.md 38.28 items 3-6, 8).
// Owns the dialogue runner + view for one world: key edges, the input lock, flags in
// world.state['dlg.*'], damage close, NPC clips and the [E] Talk interactable.
// Works with any entity whose `components.dialogue` is a dialogue id (string or {id}).
// Zero allocation per step: keys are interned constants, clip names are data strings.
import { createEscGrace } from './escGrace.js'; // OB-049
import { createDialogueRunner } from '../../../engine/index.js';
import { createDialogueView, offerIndices } from './dialogueView.js';
import { createJawSync } from './jawSync.js';

export const CLOSE_FAR_M = 6.5;
const CONFIRM_KEYS = ['KeyE', 'Enter'];
import { NPC_NAMES } from './npcNames.js'; // R6-FIX A: one name table (talk prompt + errand labels)
// DIALOGUE-LOCK-01 (PO REJECT): movement stays live, so W/S are NOT read here; choose with arrows / wheel / digits 1-4.
const DIGIT_KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4'];

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
 *   cps?:number, questFlag?:(key:string)=>void, onFlag?:(key:string,v:boolean)=>void, onTalk?:(npcId:string)=>void}} opt
 *   dialogues = bundle.dialogues (compiled). events: listens to 'combat:hit' on the player (damage closes).
 */
/** QL-06: models whose idle/listen clips have other names (Rook the crow: perch / tilt; talk is shared). */
const NPC_CLIP_ALIAS = { crow: { idle: 'perch', listen: 'perch' }, 'char.kit': { talk: 'idle', listen: 'idle' } }; // QWALK-KIT-CLIPS: Hesk / Dorrin / wardens (char.kit) have no talk/listen clips -> console.error per talk

export function createDialogueCtl(opt) {
  const { world, dialogues } = opt;
  const view = createDialogueView({ style: opt.style, palette: opt.palette }); // palette: ASSETS.palette (default globalThis.ASSETS.palette)
  // QG-03 (38.35 item 5): `q.*` keys are quest-book checks/actions (opt.book() = current book), never stored in world.state.
  // CH1-06 (38.37 item 6): `s.<key>` = world.state[key] check / opt.questFlag(key) set. rest-of-key strings are cached (no per-call slice).
  const sRest = new Map();
  const restOf = (k) => { let r = sRest.get(k); if (r === undefined) { r = k.slice(2); sRest.set(k, r); } return r; };
  const isS = (k) => k.charCodeAt(0) === 115 && k.charCodeAt(1) === 46;
  const flags = {
    has: (k) => {
      if (isS(k)) return !!world.state[restOf(k)];
      if (k.charCodeAt(0) === 113 && k.charCodeAt(1) === 46) { const b = opt.book && opt.book(); return !!b && b.hasKey(k); }
      return world.state['dlg.' + k] === true;
    },
    set: (k) => {
      if (isS(k)) { if (opt.questFlag) opt.questFlag(restOf(k)); return; }
      if (k.charCodeAt(0) === 113 && k.charCodeAt(1) === 46) { const b = opt.book && opt.book(); if (b) b.actKey(k); return; }
      world.state['dlg.' + k] = true;
      if (opt.onFlag) opt.onFlag(k, true); // main.js: gameHooks.emitSimple('flag:set', ...)
    },
  };
  let npcId = null;       // entity id of the current speaker NPC
  let pendingClip = null; // node clip waiting to be played once
  let oneShot = false;    // a node clip is playing
  let offerArmed = false; // OB-186 redo: true once an offer node has seen a step without confirm
  let lastBase = null;    // last talk/listen/idle we asked for
  const jaw = createJawSync({ maxDeg: opt.jawOpenDeg }); // opt.jawOpenDeg = model def's jawOpenDeg, else fallback
  let jawComp = null;     // voxel component of the NPC whose jaw we drive
  const runner = createDialogueRunner({
    pageLines: opt.pageLines, pageChars: opt.pageChars, // OB-022 grouping (defaults in the runner; tests may pass pageLines:1 for one line per page)
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
    get speaker() { return npcId; }, // ANIM-LOOKAT-01 AC3: entity id of the NPC being talked to (null for object offers)
    _closing: false,
    escGrace: createEscGrace(), // OB-049: Esc under pointer lock closes the box only; main.js keeps pause down while .active

    /** Entity id -> dialogue id (components.dialogue as string or {id}), else null. */
    dialogueIdOf(id) {
      const h = world.get(id), d = h && h.data;
      const c = d && d.components && d.components.dialogue;
      return typeof c === 'string' ? c : (c && c.id) || null;
    },

    /** Opens the conversation of NPC entity `id`. Returns false when it has no (known) dialogue or one is open. */
    openFor(id) {
      if (ctl.open || ctl._closing) return false; // DIALOGUE-LOCK-01: not in the step that just closed (the closing E must not re-open via the [E] Talk interactable)
      const did = ctl.dialogueIdOf(id);
      const comp = did && dialogues[did];
      if (!comp) return false;
      npcId = id; pendingClip = null; oneShot = false; lastBase = null;
      jawComp = null; // re-pick the jaw component for THIS npc (_jaw reacquires it on the next step)
      runner.open(comp, flags);
      ctl.locked = true; ctl._closing = false;
      if (opt.onTalk) opt.onTalk(id);
      ctl._clips();
      return true;
    },

    /** D-087: opens the generated Accept/Exit offer of an object giver (dialogue 'obj.<objectId>', no speaker entity). */
    openObject(objectId) {
      if (ctl.open || ctl._closing) return false;
      const comp = dialogues['obj.' + objectId];
      if (!comp) return false;
      npcId = null; pendingClip = null; oneShot = false; lastBase = null; jawComp = null;
      runner.open(comp, flags);
      ctl.locked = true; ctl._closing = false;
      return true;
    },

    /** Registers the [E] Talk to <name> interactable for NPC entity `id` (call on every 'world:loaded'). */
    addNpc(id, o = {}) {
      const h = world.get(id), t = h && h.data && h.data.transform;
      if (!t) return null;
      const have = world.interactables && world.interactables.find((r) => r.key === 'npc.' + id); // R6-FIX A: idempotent (generic giver loop + explicit registrations)
      if (have) { have.x = t.x; have.y = t.y; have.z = t.z + (o.lift ?? 1); return have; } // refresh the pose: restore() re-registers after an NPC moved/respawned (stale point = 'no dialogue opened')
      return world.addInteractable({
        key: 'npc.' + id, name: 'npc.talk', x: t.x, y: t.y, z: t.z + (o.lift ?? 1), radius: o.radius ?? 2.2,
        prompt: o.prompt ?? ('[E] Talk to ' + (NPC_NAMES[id] || id)).slice(0, 28), def: { npcId: id },
        bodyId: id, bodyR: o.bodyR ?? ((h.data.components.targetable && h.data.components.targetable.radius) || 0.45), bodyH: o.bodyH ?? ((h.data.components.targetable && h.data.components.targetable.height) || 1.9), // OB-084: [E] on the whole body
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
    /** DIALOGUE-LOCK-01: the player is never frozen by a dialogue; walking further than `r` m from the speaker closes the box. */
    closeIfFar(px, py, r = CLOSE_FAR_M) {
      if (!ctl.open || npcId === null) return false;
      const h = world.get(npcId), t = h && h.data && h.data.transform;
      if (!t) return false;
      const dx = px - t.x, dy = py - t.y;
      if (dx * dx + dy * dy <= r * r) return false;
      ctl.close(); return true;
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
      if (ctl.escGrace.lockLost(lookLocked, ctl.open)) ctl.close();
      ctl.escGrace.tick(!ctl.open, input);
      ctl._jaw(dt);
      if (!ctl.open) { if (ctl.locked && !ctl._closing) ctl.locked = false; return; } // DIALOGUE-LOCK-01: never stay locked without an open box. runner.state is read-only here ('ended' already counts as closed)
      if (lookLocked === false) { ctl.close(); return; }
      if (input.pressed('KeyQ') && !input.pressed('Escape') && runner.state === 'choosing') { // OB-186: Q on an offer = its decline/exit choice
        const o = offerIndices(runner);
        if (o) { runner.selected = o.decline; runner.choose(); if (input.consumePressed) input.consumePressed(); runner.tick(dt); if (runner.state === 'ended') { ctl._finish(); return; } ctl._clips(); return; }
      }
      if (input.pressed('Escape') || input.pressed('KeyQ')) { if (input.consumePressed) input.consumePressed(); ctl.close(); return; } // OB-174: Q = close too; the press is used up so it does not toggle lock-on
      let digit = false;
      if (runner.state === 'choosing') {
        if (input.pressed('ArrowUp')) runner.move(-1);
        if (input.pressed('ArrowDown')) runner.move(1);
        const wh = input.consumeWheel ? input.consumeWheel() : 0;
        if (wh !== 0) runner.move(wh < 0 ? -1 : 1);
        for (let i = 0; i < DIGIT_KEYS.length; i++) {
          if (i < runner.choiceCount && input.pressed(DIGIT_KEYS[i])) { runner.selected = i; digit = true; break; }
        }
      }
      const conf = digit || input.pressed(CONFIRM_KEYS[0]) || input.pressed(CONFIRM_KEYS[1]);
      const offerNow = runner.state === 'choosing' && !digit && offerIndices(runner);
      if (!offerNow) offerArmed = false; else if (!conf) offerArmed = true; // OB-186 redo: an offer node only accepts E after a step without confirm (the press that paged into it is not a deliberate accept)
      if (conf && offerNow && !offerArmed) { if (input.consumePressed) input.consumePressed(); } // swallowed: still the paging press
      else if (conf) {
        if (runner.state === 'choosing') { const o = !digit && offerIndices(runner); if (o) runner.selected = o.accept; runner.choose(); } else runner.press(); // OB-186: E on an offer = accept
        if (input.consumePressed) input.consumePressed(); // DIALOGUE-LOCK-01: the confirm edge is used up, later handlers (E interact) must not see it
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
      const vc = h.data && h.data.components && h.data.components.voxel, al = vc && NPC_CLIP_ALIAS[vc.model];
      if (al && al[clip]) clip = al[clip]; // QL-06: the crow has perch/tilt, not idle/listen
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
