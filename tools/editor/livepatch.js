// tools/editor/livepatch.js - US-064 (docs/architecture.md 24.8's
// `commit(rec) -> rebuild()` path measured at 73-90 ms against the real
// tower against the 5 ms budget, PO finding on US-033's implementation
// note). Pure, DOM/World-import-free classification + patch-application
// helpers, split out of main.js so the Node timing test (livepatch.test.mjs)
// can drive them directly without a canvas/WebGL context - same split as
// commands.js/doc.js/panel.js.
//
// The idea (US-032's drag path, generalised): moving/rotating/toggling an
// EXISTING prop or light only ever changes a handful of already-live
// runtime fields (an entity's `transform`, or a `LightSet` handle's
// position/on-flag via its own public `move()`/`setOn()` mutators) - there
// is no need to re-run `World.load` (which re-parses every level/world def,
// re-places every structure, re-spawns every entity) just to move one prop.
// `isPatchableRecord` decides whether a given `commands.js` `EditRecord`
// only touches such fields; `applyPropTransformPatch`/`applyLightPatch` do
// the actual write. Everything else (add/delete/rename/any other field,
// e.g. a prop's `model` or a light's `preset`/`radius`-affecting fields -
// no live setter exists for those, see the US-064 backlog note) still goes
// through `main.js`'s full `rebuild()`.

/** Prop fields patchable straight onto a live entity's `transform` (position + facing). */
export const PROP_LIVE_FIELDS = new Set(['x', 'y', 'z', 'facing', 'yawDeg']);
/** Light fields patchable via `LightSet.move`/`LightSet.setOn` (engine/render/lighting.js's own public per-edit mutators). */
export const LIGHT_LIVE_FIELDS = new Set(['x', 'y', 'z', 'on']);

/**
 * Field-value inequality that treats two structurally-equal objects as
 * unchanged (`commands.js`'s `makeRecord` `structuredClone`s `before`/
 * `after` independently, so an untouched object-valued field like a prop's
 * `components` is never the SAME reference on both sides - a plain `!==`
 * would wrongly count it as "changed").
 */
function fieldChanged(a, b) {
  if (a === b) return false;
  if (a && b && typeof a === 'object' && typeof b === 'object') return JSON.stringify(a) !== JSON.stringify(b);
  return true;
}

/**
 * True when `rec` (a `commands.js` `EditRecord`, or one already run through
 * `invert()` for undo/redo) is a plain field edit whose changed keys are ALL
 * inside `PROP_LIVE_FIELDS`/`LIGHT_LIVE_FIELDS` for its collection - i.e. it
 * can be applied live with no `World.load` rebuild. A `batch` (rename),
 * an insert (`before == null`) or a delete (`after == null`) is always
 * `false` (main.js keeps the full rebuild for those, per the US-064 AC).
 * @param {{batch?:Object[], before:Object|null, after:Object|null, collection:string}} rec
 */
export function isPatchableRecord(rec) {
  if (!rec || rec.batch) return false;
  if (rec.before == null || rec.after == null) return false;
  const changed = Object.keys(rec.after).filter((k) => fieldChanged(rec.before[k], rec.after[k]));
  if (!changed.length) return false;
  if (rec.collection === 'lights') return changed.every((k) => LIGHT_LIVE_FIELDS.has(k));
  if (rec.collection === 'props') return changed.every((k) => PROP_LIVE_FIELDS.has(k));
  // A world-file prop entity (US-033's `defaultWorldPropItem` shape,
  // `collection === 'entities'`, `type: 'prop'`) - only when NEITHER side
  // of the edit changed `type` away from 'prop' (a type change is a
  // structural edit, left to the full rebuild).
  if (rec.collection === 'entities' && rec.before.type === 'prop' && rec.after.type === 'prop') {
    return changed.every((k) => PROP_LIVE_FIELDS.has(k));
  }
  return false;
}

/**
 * Writes `item`'s x/y/(z)/(facing|yawDeg) into a live entity's `transform`
 * object in place (US-032's drag path: `data.transform.x = ...; data.
 * transform.y = ...; world.renderVersion++`, generalised to every patchable
 * field). `z`/facing are only touched when `item` actually carries a
 * numeric value for them - a prop whose `z` is the string `'ground'` (never
 * nudgeable, see `main.js`'s `applyNudge`) keeps its already-resolved
 * `transform.z` untouched.
 * @param {{x:number,y:number,z:number,yawDeg:number}} transform live entity transform (mutated in place)
 * @param {Object} item the doc item's new (`after`) state
 * @param {{x:number,y:number,z:number}} origin local->world offset (0 for a world-file item)
 * @param {boolean} isWorldSpace true when `item`'s own x/y/z are already world metres
 */
export function applyPropTransformPatch(transform, item, origin, isWorldSpace) {
  transform.x = isWorldSpace ? item.x : item.x + origin.x;
  transform.y = isWorldSpace ? item.y : item.y + origin.y;
  if (typeof item.z === 'number') transform.z = isWorldSpace ? item.z : item.z + origin.z;
  if (typeof item.facing === 'number') transform.yawDeg = item.facing;
  else if (typeof item.yawDeg === 'number') transform.yawDeg = item.yawDeg;
}

/**
 * Writes `item`'s x/y/z/on into a live `LightSet` handle via its own public
 * per-edit mutators (`move`/`setOn`, engine/render/lighting.js) - no
 * rebuild. `ls` is duck-typed (`{move(handle,x,y,z), setOn(handle,on)}`) so
 * this is Node-testable with a plain fake, same split as `pick.js`.
 * @param {{move(h:number,x:number,y:number,z:number):void, setOn(h:number,on:boolean):void}} ls
 * @param {number} handle
 * @param {Object} item the doc item's new (`after`) state
 * @param {{x:number,y:number,z:number}} origin
 * @param {boolean} isWorldSpace
 */
export function applyLightPatch(ls, handle, item, origin, isWorldSpace) {
  const wx = isWorldSpace ? item.x : item.x + origin.x;
  const wy = isWorldSpace ? item.y : item.y + origin.y;
  const zLocal = typeof item.z === 'number' ? item.z : 0;
  const wz = isWorldSpace ? zLocal : zLocal + origin.z;
  ls.move(handle, wx, wy, wz);
  if (typeof item.on === 'boolean') ls.setOn(handle, item.on);
}

/**
 * Finds a light's handle by its `${structureId}.${lightId}` key (`LightSet.
 * key[]`, set by `buildLightSet` - engine/render/lighting.js). Linear scan
 * over `ls.count` (<= `MAX_LIGHTS`, 16) - an edit-time lookup, not a
 * per-frame one, so this is not the "no per-frame allocation/scan" rule's
 * concern.
 * @param {{count:number, key:Array<string|null>}} ls
 * @param {string} key
 * @returns {number} the handle, or -1
 */
export function findLightHandle(ls, key) {
  for (let i = 0; i < ls.count; i++) if (ls.key[i] === key) return i;
  return -1;
}
