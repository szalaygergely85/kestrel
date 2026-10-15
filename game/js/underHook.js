// B1-MAIN hooks 7: UNDER-03 Ford cellar ladder + UNDER-02 crypt door/chest, as one gameHooks handler (null-safe everywhere).
// Pure logic lives in quest/under/fordCellar.js + crypt.js; this file only connects it to ctx (world, player, events, inventory).
import { stepFordCellar, ladderEnd, ladderPrompt, bindFordCellarFlags, syncFordCellarFlags, FORD_CELLAR } from './quest/under/fordCellar.js';
import { cryptDoorAction, applyCryptDoor, cryptCleared, bindCryptFlags, syncCryptFlags, CRYPT } from './quest/under/crypt.js';
import { countOf } from './quest/sim/inventory.js';
import { underQuestFlags } from './quest/under/underQuestFlags.js';
import { hooks as seam } from './gameHooks.js';

/** @param {{getBeasts?: () => any, openedChestsOf?: () => string[], afterMove?: ()=>void, notify?: (t:string)=>void}} o */
export function createUnderHook({ getBeasts = () => null, openedChestsOf = () => [], afterMove = null, notify = null, emitFlag = (k) => seam.emitSimple('flag:set', k, true) } = {}) {
  let ctx = null, qT = 0; const qList = [], qFeet = { x: 0, y: 0, z: 0 };
  let offs = [], keys = [];
  const ladder = { t: 0, end: null }, feet = { x: 0, y: 0, z: 0 };
  const move = (x, y, z) => { // same world, seamless: just place the body (no fade, no load)
    const t = ctx.player.transform, b = ctx.player.components && ctx.player.components.body;
    t.x = x; t.y = y; t.z = z; if (b) { b.vx = 0; b.vy = 0; b.vz = 0; b.fallDistance = 0; }
    if (afterMove) afterMove();
  };
  const hasItem = (id) => !!(ctx && ctx.inventory) && countOf(ctx.inventory, id) > 0;
  return {
    /** Chest gate for chestHook: the crypt chest opens only once room 3 is cleared. */
    canOpenChest(id) {
      if (!CRYPT.chests.includes(id)) return true;
      const b = getBeasts();
      return !!(ctx && ctx.world && b && cryptCleared(ctx.world, b));
    },
    onBoot(c) {
      ctx = c; ladder.end = null; ladder.t = 0;
      for (const o of offs) { try { o && o(); } catch (e) { /* ignore */ } }
      offs = [];
      const w = c.world;
      if (!w || !w.state) return;
      if (c.events && c.events.on) { offs.push(bindFordCellarFlags(w, c.events), bindCryptFlags(w, c.events)); }
      const opened = openedChestsOf() || [];
      syncFordCellarFlags(w, opened); syncCryptFlags(w, opened);
      applyCryptDoor(w);
      if (w.addInteractable && w.removeInteractable) { // [E] prompt at each ladder end (engine crosshair/reach test; the climb itself is stepFordCellar)
        for (const k of keys) w.removeInteractable(k);
        keys = [];
        for (const [id, end] of [['cellarTrapdoor', 'down'], ['cellarLadder', 'up']]) {
          const e = w.entity && w.entity(id); if (!e) continue;
          const t = e.transform, key = 'under.ladder.' + id;
          w.removeInteractable(key);
          w.addInteractable({ key, name: 'under.ladder', x: t.x, y: t.y, z: t.z + 0.9, radius: FORD_CELLAR.reach, prompt: ladderPrompt(end) });
          keys.push(key);
        }
      }
    },
    onTick(dt) {
      if (!ctx || !ctx.world || !ctx.player || !ctx.world.state) return;
      const t = ctx.player.transform, w = ctx.world, press = !!ctx.state.interactPressed;
      feet.x = t.x; feet.y = t.y; feet.z = t.z;
      if ((qT -= dt) <= 0) { qT = 1; const fl = underQuestFlags(w.state, feet, getBeasts(), qList); for (let i = 0; i < fl.length; i++) emitFlag(fl[i]); } // UNDER-07: ~1 Hz quest flags
      if ((press || ladder.end) && stepFordCellar(w, ladder, dt, press, feet, move)) return;
      if (press && !w.state['under.crypt.doorOpen']) { // E at the sealed crypt door
        const d = w.entity && w.entity('cemeteryCryptDoor');
        if (d && Math.hypot(t.x - d.transform.x, t.y - d.transform.y) <= CRYPT.reach && Math.abs(t.z - d.transform.z) <= 3) {
          if (cryptDoorAction(w, hasItem) === 'open' && notify) notify('The crypt door grinds open.');
        }
      }
    },
  };
}
