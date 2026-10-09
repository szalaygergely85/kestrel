// game/js/chestHook.js (S8-B1-04 US-092w). Wires lane C's chest sim (quest/sim/chest.js, S8-C-06) and the
// item-get card (ui/itemGetCard.js, S8-C-07) onto the gameHooks seam (D-050) WITHOUT editing either module - only
// their public create*() entry points are imported. Registered once via `gameHooks.register(createChestHook(...))`
// (main.js); `onBoot` re-creates the sim fresh every world load/restart, same lifecycle as saveRelay's handlers().
//
// Interact gate: chest.js's own `canOpen/open(id, pose)` does its OWN reach/facing test from the player's BODY
// transform + forward (not the camera eye - chest.js's header comment: "use feet/anchor z, not camera eye z"), so
// this hook does not go through the engine's generic eye-cone `world.interactables` / `updateInteraction` (that
// system is for camera-aimed props like levers and is not how a chest's own sim wants to be asked). Instead it
// reads `ctx.state.interactPressed` (the SAME gated E edge `updateInteraction` uses - false while a menu/card/note
// is up, so a chest can't steal an E press from another system) and `ctx.state.playerYawDeg` (main.js facts the
// seam already carries for exactly this reason, gameHooks.js header).
//
// Save persistence needs no new plumbing: `saveRelay.js` already listens for `chest:opened` (`bindEvents`) and
// round-trips `openedChests` through `collectSave`/`applySave` (US-089a) - this hook only reads the restored list
// back out at boot (`openedChestsOf()`) and forwards the sim's own events onto the shared `ctx.events` bus so that
// listener, and the seam's `inventory:added -> item:got` bridge (gameHooks.js `bridgeEngineEvents`), keep working
// exactly as they do for boar loot. The item-get card itself is pushed directly from the chest's own emit (not by
// also subscribing to the shared bus), so boar loot - which uses the same bus - never opens the card.
//
// NEEDS C (docs/lanes/pc-b1.md): no `content/chests/*.json` (or structure-level chest placement) exists yet
// (S8-C-06's own report: "Content registration/placement... remain open", NEEDS PC-A reward/anchor). `defs` is
// `[]` in the real game today; this hook is fully wired and simply has nothing to open until content lands.
import { createChests } from './quest/sim/chest.js';
import { createItemGetCard } from './ui/itemGetCard.js';
import { countOf } from './quest/sim/inventory.js';
import { forwardOf } from '../../engine/index.js';

export const CLIP_FOR = { closed: 'closed', opening: 'open', open: 'opened' }; // ASSETS.chestFx.clipFor (design/models/chest.js)

/**
 * @param {{defs: any[], items: any, style: any, rgb: any, openedChestsOf?: () => string[], seed?: number}} o
 *   `defs` = createChests' own definition shape (id/x/y/z/frontX/frontY/interact/table), each MAY carry an extra
 *   `propId` (a world entity id whose `components.voxel.anim` is driven from the chest's state via `entity.play()`
 *   - omitted = no model to drive, e.g. in a Node test fixture). `openedChestsOf()` is read fresh at every boot.
 *   `items` = `ASSETS.items` (the whole registry: itemGetCard wants `items.defs`, the chest sim wants the flat
 *   `items.defs` map itself - both read from this one object so main.js only has to pass it once).
 * @returns {{card: any, onBoot: Function, onTick: Function, drawHud: Function}} a gameHooks handler set, plus
 *   `card` (test/dev access to the mounted item-get card view).
 */
export function createChestHook({ defs, items, style, rgb, openedChestsOf = null, seed = 1, reduceMotion = false }) {
  const card = createItemGetCard(null, { style, items, rgb, reduceMotion });
  const itemDefs = items.defs;
  const fwdScratch = [0, 0], pose = { x: 0, y: 0, z: 0, forwardX: 0, forwardY: 0 }; // reused (rule 9)
  let sim = null, ctx = null, lastAnim = null;

  // The chest sim's PRIVATE event sink: pushes the card directly (so boar loot - which shares `ctx.events` - never
  // opens it), then forwards the same event onto the shared bus for saveRelay (`chest:opened`) and the seam's
  // `item:got` bridge / toastView (`inventory:added`, same precedent as boar loot; `inventory:full`).
  const events = {
    emit(name, p) {
      if (name === 'inventory:added') {
        const count = ctx.inventory ? countOf(ctx.inventory, p.id) : p.n;
        card.push(p.id, p.n, { count });
      } // card.push looks the id up in `items.defs` itself (itemGetCard.js)
      if (ctx.events) ctx.events.emit(name, p);
    },
  };

  return {
    card,
    onBoot(c) {
      ctx = c;
      lastAnim = new Map();
      sim = defs.length ? createChests(defs, {
        items: itemDefs, inventoryOf: () => ctx.inventory, events,
        openedChests: openedChestsOf ? openedChestsOf() : [], seed,
      }) : null;
    },
    // The card's own step. main.js calls this EVERY frame outside the `!paused` block (like invView.step): an open card
    // makes `paused` true, so gameHooks.tick (-> onTick) stops running and a step in onTick could never dismiss it.
    // `ePressed` = ungated E edge (the card dismisses itself even though interactPressed is false while it's open).
    stepUi(dt, ePressed) { card.step(dt, !!ePressed); },
    onTick(dt) {
      if (!ctx) return;
      const st = ctx.state;
      if (!sim) return;
      sim.step(dt, true);
      if (st.interactPressed && !card.isOpen) {
        forwardOf(st.playerYawDeg || 0, fwdScratch);
        const t = ctx.player.transform;
        pose.x = t.x; pose.y = t.y; pose.z = t.z; pose.forwardX = fwdScratch[0]; pose.forwardY = fwdScratch[1];
        for (let i = 0; i < defs.length; i++) if (sim.canOpen(defs[i].id, pose)) { sim.open(defs[i].id, pose); break; }
      }
      for (let i = 0; i < defs.length; i++) {
        const d = defs[i];
        if (!d.propId) continue;
        const clip = CLIP_FOR[sim.stateOf(d.id)];
        if (!clip || lastAnim.get(d.id) === clip) continue;
        const e = ctx.world.get(d.propId);
        if (e) e.play(clip);
        lastAnim.set(d.id, clip);
      }
    },
    drawHud(ui) { card.draw(ui); },
  };
}
