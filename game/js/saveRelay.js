// US-089w: relay between the live game and the lane-C save module (quest/save/saveState.js).
// Owns the game-side facts a WorldState does not hold (quest, opened chests, dead beasts, play time), autosaves,
// and restores them before the beast sim is created (beastSim resets every beast to alive on create).
// No window/DOM access: the platform storage object is injected, so everything here runs in Node.
import { localToWorld } from '../../engine/index.js';
import { collectSave, applySave, createStorageAdapter } from './quest/save/saveState.js';
import { createQuestRelay } from './questRelay.js';
import { migrateM1Ch1 } from './quest/sim/questBook.js';

export const AUTOSAVE_SEC = 60;
const STATE_GONE = 12; // beastSim.STATE_GONE (hidden, skipped everywhere) - same literal beastSim exports

/**
 * @param {{storage:any, questDef:any, giverDefs?:any[], slot?:number, enabled?:boolean, autosaveSec?:number, playerName?:string, place?:string}} o
 */
export function createSaveRelay({ storage, questDef, giverDefs = [], slot: slot0 = 0, enabled = true, autosaveSec = AUTOSAVE_SEC, playerName = 'Wick', place = 'Kestrel', defaultLook = null }) {
  let slot = slot0; // US-090w: the title menu picks the slot (setSlot)
  const adapter = storage ? createStorageAdapter(storage) : null;
  const quest = createQuestRelay(questDef, null, giverDefs);
  const chests = new Set(), dead = new Set();
  const facts = { wakeDone: false, swordTaken: false, endStarted: false, x: 0, y: 0, z: 0 };
  const tmp = { x: 0, y: 0, z: 0 };
  let breach = null, breachFor = null;
  let playSec = 0, sinceSave = 0, pending = null, lastResult = null;
  let look = defaultLook; // CHARGEN-16: player.look (CharRecipe); new game = kit default, restored from the save on load

  const relay = {
    enabled, quest, adapter,
    get slot() { return slot; },
    /** US-090w: target slot for load/save (title menu choice). */
    setSlot(n) { if (Number.isInteger(n) && n >= 0) slot = n; },
    get openedChests() { return [...chests]; },
    get deadBeasts() { return [...dead]; },
    get playTimeSec() { return playSec; },
    /** PAUSE-MENU-01: true when play time has passed since the last save/load (asks "Save first?"). */
    get dirty() { return sinceSave > 0; },
    get lastResult() { return lastResult; },
    get look() { return look; },
    set look(v) { look = v; },

    /** Subscribes to engine events the seam has no name for (chest:opened); beast:died / item:got arrive via handlers().
     *  Returns an unsubscribe function. */
    bindEvents(events) {
      const offs = [
        events.on('chest:opened', (p) => { if (p && typeof p.id === 'string') chests.add(p.id); }),
      ];
      return () => { for (const off of offs) off(); };
    },

    /** gameHooks handler set: quest + save relay on the seam (onBoot keeps ctx, onTick steps, onEvent feeds the quest, drawHud = TEMPORARY objective line). */
    handlers() {
      let ctx = null;
      return {
        onBoot(c) { ctx = c; quest.world = c && c.world || null; },
        onTick(dt) { if (ctx && ctx.world && ctx.player) relay.stepGame(dt, ctx.world, ctx.player.transform, ctx.state); },
        onEvent(name, d) {
          if (name === 'beast:died') { dead.add(d.id); quest.feed({ type: name, id: d.id }); }
          else if (name === 'item:got' || name === 'area:entered') quest.feed({ type: name, id: d.id });
          else if (name === 'prop:touched' && d.id === 'waystone') quest.feed({ type: 'area:entered', id: 'waystone' }); // WAYSTONE-NORMAL-01: touching the stone completes the last objective (no end sequence any more)
          else if (name === 'flag:set') quest.feed({ type: name, key: d.key, value: d.value });
        },
        drawHud(ui) { relay.quest.draw(ui); },
      };
    },

    /** Reads the slot (`force` = explicit menu Continue, even where autosave is off); when a save exists returns the restored World (caller swaps it in) and arms the pending restore. */
    load(assets, worldOpts = {}, force = false) {
      if ((!enabled && !force) || !adapter) return null;
      const r = adapter.readSlot(slot);
      if (!r.ok) { lastResult = { op: 'load', ok: false, error: r.error }; return null; }
      if (!r.save) return null;
      try {
        // CH1-02: old m1 chain (with `lantern`) -> new 11-step chain BEFORE the book is built (38.37 item 8)
        // The migration's world flags (6/6 saves) go to the WorldState at save.world.state, not save.game.
        let save = r.save;
        if (save.game && save.game.quest) {
          const m = migrateM1Ch1({ quest: save.game.quest, world: save.world }, questDef.objectives.map(o => o.id));
          if (m.quest !== save.game.quest) save = { ...save, game: { ...save.game, quest: m.quest }, world: m.world || save.world };
        }
        const a = applySave(save, assets, { questDef, giverDefs, worldOptions: worldOpts, defaultLook });
        pending = a;
        lastResult = { op: 'load', ok: true };
        return a.world;
      } catch (e) { lastResult = { op: 'load', ok: false, error: String(e) }; return null; }
    },

    /** 'world:loaded' (first thing): consume a pending restore, else a fresh run (also `R` restart). */
    onWorldLoaded() {
      chests.clear(); dead.clear(); sinceSave = 0;
      if (pending) {
        quest.reset(pending.quest ? pending.quest : null, pending.quests);
        for (const id of pending.openedChests) chests.add(id);
        for (const id of pending.deadBeasts) dead.add(id);
        playSec = pending.meta.playTimeSec;
        look = pending.look || defaultLook;
        pending = null;
      } else { quest.reset(null); playSec = 0; look = defaultLook; }
    },

    /** After createBeastSim: restored dead beasts stay gone (the sim made them alive again). */
    applyDeadToBeasts(beasts) {
      if (!beasts || !beasts.slotOf) return;
      for (const id of dead) {
        const i = beasts.slotOf(id);
        if (i < 0) continue;
        beasts.state[i] = STATE_GONE;
        beasts.steer.removeAgent(i);
        const h = beasts.entities[i].components.health;
        if (h) h.hp = 0;
      }
    },

    /** Writes the slot now. `ending` (end walk running) saves with the end trigger un-started so a load does not replay it. */
    save(world, { ending = false } = {}) {
      if (!enabled || !adapter || !world) return false;
      let save;
      try {
        save = collectSave(world, { quest: quest.state, questDef, quests: quest.book.toSave().quests, giverDefs, openedChests: [...chests], deadBeasts: [...dead], playerName, place, playTimeSec: playSec, savedAt: Date.now(), look }); // SAVE-TIME-01: only the real writer stamps time (pure collect stays deterministic)
        if (ending && save.world.state) save.world.state['quest.endT'] = -1;
      } catch (e) { lastResult = { op: 'save', ok: false, error: String(e) }; return false; }
      const r = adapter.writeSlot(slot, save);
      lastResult = { op: 'save', ok: r.ok, error: r.error };
      sinceSave = 0;
      return r.ok;
    },

    /**
     * One fixed step: world facts -> quest events, play-time clock, autosave (every autosaveSec, and once on waystone touch).
     * @param {number} dt seconds
     * @param {any} world live World
     * @param {{x:number,y:number,z:number}} pos player transform
     * @param {{wakeDone:boolean, canSave:boolean}} o
     */
    stepGame(dt, world, pos, o) {
      if (breachFor !== world) { breachFor = world; breach = resolveBreach(world, tmp); }
      quest.world = world; quest.checkSections();
      const ws = world.state, wasWay = quest.state.areas.includes('waystone');
      facts.wakeDone = o.wakeDone; facts.swordTaken = ws['tower.sword.taken'] === true;
      facts.endStarted = typeof ws['quest.endT'] === 'number' && ws['quest.endT'] >= 0;
      facts.x = pos.x; facts.y = pos.y; facts.z = pos.z;
      quest.poll(facts, breach);
      if (!wasWay && quest.state.areas.includes('waystone')) { relay.save(world, { ending: true }); playSec += dt; return; }
      relay.tick(dt, world, o.canSave && !facts.endStarted);
    },

    /** Per-frame clock; autosaves every `autosaveSec` of play when `canSave`. Returns true when it saved. */
    tick(dtSec, world, canSave, opts) {
      playSec += dtSec; sinceSave += dtSec;
      if (enabled && canSave && sinceSave >= autosaveSec) return relay.save(world, opts);
      return false;
    },
  };
  return relay;
}

/** World-space breach marker from the tower structure's level markers (null when the world has none). */
function resolveBreach(world, out) {
  for (const s of world.structures) {
    const m = s.level && s.level.def && s.level.def.markers && s.level.def.markers.breach;
    if (!m) continue;
    const frame = world.frameOf(s.id);
    if (!frame) continue;
    localToWorld(frame, m.x, m.y, m.z, out);
    return { x: out.x, y: out.y, z: out.z };
  }
  return null;
}
