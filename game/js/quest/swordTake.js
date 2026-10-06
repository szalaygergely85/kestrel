// game/js/quest/swordTake.js (US-078c, docs/architecture.md 30.1). Real body
// of `sword.take`, named by `content/levels/tower.level.json`'s
// interactable `{ id: 'sword', prop: 'sword', interact: 'sword.take',
// once: true, ... }` (copied in from `design/models/sword.js`'s
// `ASSETS.levelPatch.towerSword`). No literal coordinate here (US-010 tech
// note 1 rule) - the sword prop's position comes from the level data, this
// file only reacts to the interaction.
//
// "Has the sword" is exactly the one flag `tower.sword.taken` (architecture.md
// 30.1's last sentence) - no second state key, unlike the lantern's extra
// `used.*`/hook-light bookkeeping (that lamp still needs a prop PRESENT, just
// re-skinned; the sword prop is simply gone).
//
// Deviation from the architecture.md 30.1 text (flagged to the architect/PO):
// the spec paragraph says `world.removeEntity(ctx.entity.id)`. `removeEntity`
// is the engine's low-level map delete (`engine/world/World.js`) - it does
// NOT add the id to `world._removedContent`, so a `serialize()` -> `deserialize()`
// round trip would re-spawn the sword prop from content on the far side
// (`appendedContentEntities` in `engine/world/serialize.js`, since the prop's
// content id is still current and isn't in the saved `removed` list). This
// file uses `world.remove(id)` instead - the SAME content-aware removal
// `lantern.js` already uses for `lampFlame` (`world.remove(`${structId}.${def.flameProp}`)`),
// documented at architecture.md line ~1550 ("`remove(id)` on a content id
// also adds it to `w._removedContent`") - the only call that actually keeps
// the prop gone across a save round trip, which this story's own required
// test demands.
//
// US-091a1 (architecture.md 37.16.4): taking the sword also puts it in the pack (`addItem`) and into the
// left hand (or the right, if the left is taken). Item defs come from `design/items.js` -> `ASSETS.items`,
// read off the global like main.js reads `window.ASSETS.viewModels`/`swordForHand` (a named behaviour cannot
// see `ASSETS` any other way - `engine.assets` is the AssetRegistry, which does not carry `.items`). The
// fallback `{}` keeps `addItem` a no-op rather than a crash if items.js ever fails to load.
import { ensureInventory, addItem } from './sim/inventory.js';

const EMPTY_START = { pack: [], left: null, right: null };

function itemDefs() {
  return (globalThis.ASSETS && globalThis.ASSETS.items && globalThis.ASSETS.items.defs) || {};
}

// Carried-light offset collision (architecture.md 30.1): the lantern's
// carried light and a drawn sword view model would otherwise sit on the same
// (right) side of the screen. Taking the sword nudges an EXISTING carried
// light (the lantern's, if already taken) to the left; `lanternTake` (see
// `lantern.js`) does the mirror-image check for the other pickup order.
export function swordTake(ctx) {
  const { world, entity, actor } = ctx;

  if (entity) world.remove(entity.id);
  world.state['tower.sword.taken'] = true;

  if (actor) {
    const light = actor.getComponent && actor.getComponent('light');
    if (light) {
      actor.setComponent('light', { ...light, offset: { ...light.offset, right: -0.3 } });
    }

    // US-091a1 (37.16.4): sword in the pack + left hand if empty (else right). `ensureInventory` only
    // creates the component when it is missing, so a restart with the sword already in the pack never
    // duplicates it; main.js seeds the demo pack before any interaction can fire here anyway.
    const inv = ensureInventory(actor.data, EMPTY_START);
    addItem(inv, itemDefs(), 'sword', 1);
    if (inv.left === null) inv.left = 'sword';
    else if (inv.right === null) inv.right = 'sword';
  }

  return true;
}

/**
 * On `'world:loaded'` (main.js's single handler, same convention as
 * `resetHints`/`resetGameAudio`/`stepLantern`'s callers - architecture.md 7.4
 * "module-level game variables are reset only in the world:loaded handler"):
 * a reload/save-load that lands with `tower.sword.taken` already true but
 * still carrying the sword prop (e.g. a future state-only save, US-089, or
 * any other path that doesn't go through `World.remove`'s own
 * `_removedContent`/`skipIds` restore - a normal CO-5 `deserialize()` round
 * trip already keeps the prop gone on its own, see the `swordTake` comment
 * above) must not show a sword that was already picked up. Cheap no-op
 * (two `typeof`/truthiness checks) once the flag is unset or the prop is
 * already gone.
 *
 * NOT wired into `main.js` by this story (PC-B main session only edits that
 * shared file) - call this from the `'world:loaded'` handler, same slot as
 * `resetHints()`, if/when that wiring lands.
 * @param {import('../../../engine/index.js').World} world
 */
export function removeSwordIfTaken(world) {
  if (!world || !world.state['tower.sword.taken']) return;
  // `World.spawn`'s own id convention (`${structId}.${propId}`) - the sword
  // is always the tower structure's `sword` prop (content/levels/tower.level.json),
  // same precedent `lantern.js`/`beacon.js` use for their own fixed prop id.
  for (const s of world.structures || []) {
    const id = `${s.id}.sword`;
    if (world.get(id)) world.remove(id);
  }
}
