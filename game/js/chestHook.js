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
import { buildChestDefs } from './quest/sim/chestDefs.js';
import { CHEST_DEFAULTS as C } from './quest/sim/lootConfig.js';
import { forwardOf } from '../../engine/index.js';

// OB-106: chests had NO interactable, so the crosshair never found one and "[E] Open chest" was never shown. Pick box = the model's
// footprint/height (the chest models carry no collider shapes). Half extents in metres, local x = long side, z up from the feet.
const PICK_HALF = { chestSmall: [0.35, 0.2, 0.275], chestBig: [0.55, 0.35, 0.45] };
const CHEST_REACH = 2.2; // ray length to the box (findInteractTarget also caps at its own 1.8 m reach)
export function chestPickShape(e) {
  const t = e.transform, comp = e.components && (e.components.voxel || e.components.sprite);
  const h = PICK_HALF[comp && comp.model] || PICK_HALF.chestSmall, sc = t.scale || 1, a = (t.yawDeg || 0) * Math.PI / 180;
  return { cx: t.x, cy: t.y, cz: t.z + h[2] * sc, hx: h[0] * sc, hy: h[1] * sc, hz: h[2] * sc, c: Math.cos(a), s: Math.sin(a) };
}
/** World AABB of a pick shape (the broadphase `rec.pick` findInteractTarget needs next to `pickShapes`). */
export function shapeAabb(sh) {
  const ex = Math.abs(sh.c) * sh.hx + Math.abs(sh.s) * sh.hy, ey = Math.abs(sh.s) * sh.hx + Math.abs(sh.c) * sh.hy;
  return { x0: sh.cx - ex, x1: sh.cx + ex, y0: sh.cy - ey, y1: sh.cy + ey, z0: sh.cz - sh.hz, z1: sh.cz + sh.hz };
}

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
export function createChestHook({ defs, items, style, rgb, openedChestsOf = null, seed = 1, reduceMotion = false, notify = null, canOpenGate = null }) {
  const card = createItemGetCard(null, { style, items, rgb, reduceMotion });
  const itemDefs = items.defs;
  // OB-075: with `notify` (main.js: toasts.say) chest / gear pickups show a one-line "Looted: Leggings" / "Looted: 2 Potions" toast, no pause, no card.
  // Without it (Node fixtures) the old item-get card is used. The heart-piece card (heartHook.js, a story beat) is kept.
  const lootedLine = (id, n) => { const d = itemDefs[id], nm = d && d.name ? d.name : id; return 'Looted: ' + (n > 1 ? n + ' ' + nm + (/s$/i.test(nm) ? '' : 's') : nm); };
  const gotLoot = (id, n, extra) => { if (notify) notify(lootedLine(id, n)); else card.push(id, n, extra); };
  const fwdScratch = [0, 0], pose = { x: 0, y: 0, z: 0, forwardX: 0, forwardY: 0, onBottom: false }; // reused (rule 9)
  let recs = [], offGear = null, sim = null, ctx = null, lastAnim = null, active = defs; // EQ-10: `active` = defs, or the world's chest* anchors when defs is []

  // The chest sim's PRIVATE event sink: pushes the card directly (so boar loot - which shares `ctx.events` - never
  // opens it), then forwards the same event onto the shared bus for saveRelay (`chest:opened`) and the seam's
  // `item:got` bridge / toastView (`inventory:added`, same precedent as boar loot; `inventory:full`).
  const events = {
    emit(name, p) {
      if (name === 'inventory:added') {
        const count = ctx.inventory ? countOf(ctx.inventory, p.id) : p.n;
        gotLoot(p.id, p.n, { count });
      } // card.push looks the id up in `items.defs` itself (itemGetCard.js)
      if (ctx.events) ctx.events.emit(name, p);
    },
  };

  return {
    card,
    onBoot(c) {
      ctx = c;
      lastAnim = new Map();
      active = defs.length ? defs : (c.world && typeof c.world.entity === 'function' ? buildChestDefs(c.world) : []);
      if (offGear) offGear();
      offGear = c.events && c.events.on ? c.events.on('gear:got', (p) => gotLoot(p.id, p.n, { count: p.n })) : null; // loot.js gear pickup
      sim = active.length ? createChests(active, {
        items: itemDefs, inventoryOf: () => ctx.inventory, events,
        openedChests: openedChestsOf ? openedChestsOf() : [], seed,
      }) : null;
      recs = [];
      if (sim && c.world && c.world.addInteractable) { // OB-106: one crosshair target per still-closed chest
        for (const d of active) {
          const e = d.propId && c.world.entity ? c.world.entity(d.propId) : null;
          const key = 'chest.' + d.id;
          if (c.world.removeInteractable) c.world.removeInteractable(key);
          if (!e || sim.stateOf(d.id) !== 'closed' || (canOpenGate && !canOpenGate(d.id))) continue; // UNDER-02: gated chests (crypt) get their [E] only once the gate opens, see onTick
          const sh = chestPickShape(e);
          const rec = c.world.addInteractable({ key, name: 'chest.open', x: d.x, y: d.y, z: d.z + sh.hz, radius: CHEST_REACH, prompt: C.prompt, pick: shapeAabb(sh), pickShapes: [sh], def: { chestId: d.id } });
          recs.push({ id: d.id, key });
        }
      }
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
        const pb = ctx.player.components && ctx.player.components.body; pose.onBottom = !!(pb && pb.onBottom); // SWIM-04d
        for (let i = 0; i < active.length; i++) if (sim.canOpen(active[i].id, pose) && (!canOpenGate || canOpenGate(active[i].id))) { sim.open(active[i].id, pose); break; }
      }
      if (canOpenGate && ctx.world && ctx.world.addInteractable) { // gate opened later (crypt cleared): add the crosshair target once
        for (const d of active) {
          const key = 'chest.' + d.id, e = d.propId && ctx.world.entity ? ctx.world.entity(d.propId) : null;
          if (!e || recs.some((r) => r.id === d.id) || sim.stateOf(d.id) !== 'closed' || !canOpenGate(d.id)) continue;
          const sh = chestPickShape(e);
          ctx.world.addInteractable({ key, name: 'chest.open', x: d.x, y: d.y, z: d.z + sh.hz, radius: CHEST_REACH, prompt: C.prompt, pick: shapeAabb(sh), pickShapes: [sh], def: { chestId: d.id } });
          recs.push({ id: d.id, key });
        }
      }
      for (let i = recs.length - 1; i >= 0; i--) { // OB-106: an opened (or opening) chest shows no [E]
        if (sim.stateOf(recs[i].id) !== 'closed') { if (ctx.world.removeInteractable) ctx.world.removeInteractable(recs[i].key); recs.splice(i, 1); }
      }
      for (let i = 0; i < active.length; i++) {
        const d = active[i];
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
