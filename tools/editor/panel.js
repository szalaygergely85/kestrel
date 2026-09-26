// tools/editor/panel.js - US-033 (docs/architecture.md 24.9). Place defaults
// + validation are plain, DOM-free functions (Node-tested, panel.test.mjs);
// the property-form builder at the bottom is the only DOM-touching part
// (browser only, no test - same split as pick.js/select.js).
//
// Imports only engine/index.js + doc.js/commands.js (the editor boundary rule).
import { selectionItemData } from './doc.js';
import { listBehaviours } from '../../engine/index.js';

/** Place keys (24.9): `1` prop, `2` light, `3` trigger, `4` interactable. */
export const PLACE_KEYS = { Digit1: 'prop', Digit2: 'light', Digit3: 'trigger', Digit4: 'interactable' };

/** US-066 glyph icons (design/editor-ui.md 4, no icon font): one per `kindForSelection` kind, reused by the scene tree and the inspector header. */
export const KIND_GLYPHS = { prop: '♣', light: '☼', trigger: '◇', interactable: '¤', entity: '▦' };

/** Id format (24.9): starts with a letter, then letters/digits/`_`/`-`. */
export const ID_REGEX = /^[A-Za-z][A-Za-z0-9_-]*$/;
export function isValidId(id) {
  return typeof id === 'string' && ID_REGEX.test(id);
}

/** `palette.lights` preset names minus `ambient`/`sun` (24.9's preset picker/validator). */
export function lightPresetNames(palette) {
  const lights = (palette && palette.lights) || {};
  return Object.keys(lights).filter((k) => k !== 'ambient' && k !== 'sun');
}

/** Every `lights[]` item across every level file in `doc` (24.9's `MAX_LIGHTS` refusal). */
export function countLights(doc) {
  let n = 0;
  for (const file of doc.files.values()) {
    if (file.kind === 'level') n += (file.def.lights || []).length;
  }
  return n;
}

/**
 * Behaviour names to suggest in the interact/trigger field's autocomplete
 * (24.9). US-069 (24.12 item 5) swapped the old pure-content-scan workaround
 * for the real `listBehaviours()` API, but keeps the SAME filtering the
 * workaround had: only names actually used somewhere in `doc`'s content, not
 * every behaviour the game happens to have registered (a huge, mostly
 * irrelevant list once real quest behaviours are registered). `main.js`
 * registers a no-op for exactly the names the loaded world's content
 * references (`validateBehaviours`, right after `World.load`) before this is
 * ever called, so in the real editor `listBehaviours()` already IS that same
 * "used in content" set; scanning `doc` here as well is what keeps this
 * function correct (and Node-testable without a registry) even when that
 * isn't true yet, e.g. a name just typed into a field before its next
 * rebuild re-registers it.
 * @returns {string[]} sorted, de-duplicated
 */
export function harvestBehaviourNames(doc) {
  const used = new Set();
  for (const file of doc.files.values()) {
    for (const it of file.def.interactables || []) {
      if (typeof it.interact === 'string' && it.interact) used.add(it.interact);
    }
    for (const tr of file.def.triggers || []) {
      if (typeof tr.trigger === 'string' && tr.trigger) used.add(tr.trigger);
    }
  }
  const registered = listBehaviours();
  // No registry yet (e.g. an isolated Node test) - fall back to the raw
  // content scan so "used in content" is still the answer.
  if (registered.length === 0) return [...used].sort();
  return registered.filter((n) => used.has(n)).sort();
}

/**
 * Default field values for a freshly placed item (24.9), at `pos` (already
 * in the target file's own coordinate space - local metres for a level file,
 * world metres for the world file; `main.js` converts before calling this).
 * @param {'prop'|'light'|'trigger'|'interactable'} kind
 * @param {string} id
 * @param {{x:number,y:number,z:number}} pos
 * @param {{modelKey?:string}} [opts]
 */
export function defaultItemForKind(kind, id, pos, opts = {}) {
  switch (kind) {
    case 'prop':
      return { id, model: opts.modelKey || '', x: pos.x, y: pos.y, z: pos.z, facing: 0 };
    case 'light':
      return { id, preset: 'torch', x: pos.x, y: pos.y, z: pos.z + 1.2, on: true };
    case 'trigger':
      return { id, type: 'zone', shape: 'circle', x: pos.x, y: pos.y, r: 1.5, zMin: pos.z - 0.5, once: false, trigger: '' };
    case 'interactable':
      return { id, x: pos.x, y: pos.y, z: pos.z, radius: 1.5, prompt: '[E] Use', interact: '' };
    default:
      throw new Error(`panel.js: unknown place kind "${kind}"`);
  }
}

/**
 * A prop placed OUTSIDE any structure (24.9: "outside a structure -> the
 * world file's entities for props, refused for the level-only kinds"). Same
 * shape as the real `endMarker` waystone entity (content/worlds/world_m1.
 * world.json) - `type:'prop'` + `components.voxel.model`, `yawDeg` (world
 * entities use `yawDeg`, not `facing` - doc.js/main.js's existing convention).
 */
export function defaultWorldPropItem(id, pos, modelKey) {
  return { id, type: 'prop', components: { voxel: { model: modelKey || '' } }, x: pos.x, y: pos.y, z: pos.z, yawDeg: 0 };
}

/**
 * US-063 fix: classifies a placement point against the world's REAL per-cell
 * data, not just a structure's bounding rectangle. The old `structureAt` in
 * `main.js` only checked `pt` against each structure's axis-aligned bbox
 * (flagged as a known limitation in the US-033 implementation note) - a
 * courtyard gap or any other hole inside that rectangle (a cell with no
 * legend entry) was wrongly treated as "inside". `world.sectorAt(x,y)`
 * already returns `null` for exactly that cell (`Level.sectorAt`'s own
 * "outside the grid" answer, D-008) even when `world.structureAt(x,y)` finds
 * a structure whose bbox contains the point - that is the real per-cell test
 * this function uses. Takes a `world`-shaped object exposing
 * `structureAt(x,y)`/`sectorAt(x,y)` (the real `World` class - see
 * `engine/world/World.js` - or a fake with the same two methods for Node
 * tests, see `panel.test.mjs`).
 * @param {{structureAt(x:number,y:number):Object|null, sectorAt(x:number,y:number):Object|null}} world
 * @param {{x:number,y:number}} pt
 * @returns {{ zone: 'structure'|'gap'|'outside', structure: Object|null }}
 *   'structure' = a real, walkable/wall cell inside a structure's footprint;
 *   'gap' = inside a structure's bbox but on a cell with no real sector (a
 *   courtyard, a hole - placement must be refused here); 'outside' = not in
 *   any structure's bbox at all (world space, props only).
 */
export function classifyPlacement(world, pt) {
  const structure = world.structureAt(pt.x, pt.y);
  if (!structure) return { zone: 'outside', structure: null };
  const sector = world.sectorAt(pt.x, pt.y);
  return sector ? { zone: 'structure', structure } : { zone: 'gap', structure: null };
}

/**
 * Model keys placeable as a world prop (US-063's place-a-prop model picker):
 * every registered model except UI-only sprites (`ui: true` - `title`/
 * `subtitle`/`mapCard` etc, design/models/title.js - not meant to be dropped
 * into the world as a prop; `main.js`'s old single-default-model comment
 * flagged `title` by name as exactly this kind of non-placeable sprite).
 * Sorted for a stable list.
 * @param {import('../../engine/index.js').AssetRegistry} assets
 * @returns {string[]}
 */
export function listPlaceableModels(assets) {
  return assets.keys('model')
    .filter((k) => {
      const def = assets.model(k);
      return !(def && def.ui === true);
    })
    .sort();
}

/** Case-insensitive substring filter for the model picker's search box (US-063). */
export function filterModelKeys(keys, query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return keys;
  return keys.filter((k) => k.toLowerCase().includes(q));
}

/**
 * Selection collection -> validation/place "kind" (24.9). World file items
 * (`entities`) get the generic `'entity'` kind - looser validation (no
 * model/preset requirement unless the field is actually present).
 */
export function kindForSelection(selection) {
  switch (selection.collection) {
    case 'props': return 'prop';
    case 'lights': return 'light';
    case 'triggers': return 'trigger';
    case 'interactables': return 'interactable';
    default: return 'entity';
  }
}

/**
 * Validates a candidate item (place or a property-panel field edit, 24.9).
 * Never mutates `item`. Returns a (possibly empty) list of error strings -
 * commit is refused while this is non-empty, so a NaN position or a broken
 * reference never lands in `doc` (this story's own "never invalid" AC). This
 * is the 24.9-scoped subset only (id/model/preset/numeric/r/zMin<zMax) - a
 * full cross-file `validateDoc` pass is explicitly US-034 scope (24.10); see
 * the US-033 backlog note for that gap.
 * @param {string} kind from `kindForSelection`/a place kind
 * @param {Object} item
 * @param {{assets:Object, palette:Object, siblingIds:Set<string>}} ctx
 */
export function validateItem(kind, item, ctx) {
  const errors = [];
  if (!isValidId(item.id)) {
    errors.push(`id: "${item.id}" must start with a letter and contain only letters, digits, "_" or "-"`);
  } else if (ctx.siblingIds && ctx.siblingIds.has(item.id)) {
    errors.push(`id: "${item.id}" is already used in this collection`);
  }
  for (const [key, val] of Object.entries(item)) {
    if (typeof val === 'number' && !Number.isFinite(val)) errors.push(`${key}: must be a finite number`);
  }
  const modelKey = item.model
    || (item.components && item.components.voxel && item.components.voxel.model)
    || (item.components && item.components.sprite && item.components.sprite.model);
  if ((kind === 'prop' || (modelKey && kind === 'entity')) && ctx.assets) {
    if (!modelKey) errors.push('model: required');
    else if (!ctx.assets.has('model', modelKey)) errors.push(`model: unknown "${modelKey}"`);
  }
  if (kind === 'light' && typeof item.preset === 'string' && ctx.palette) {
    if (!lightPresetNames(ctx.palette).includes(item.preset)) errors.push(`preset: "${item.preset}" is not in palette.lights`);
  }
  if (typeof item.r === 'number' && Number.isFinite(item.r) && !(item.r > 0)) errors.push('r: must be > 0');
  if (typeof item.radius === 'number' && Number.isFinite(item.radius) && !(item.radius > 0)) errors.push('radius: must be > 0');
  if (typeof item.zMin === 'number' && typeof item.zMax === 'number'
    && Number.isFinite(item.zMin) && Number.isFinite(item.zMax) && !(item.zMin < item.zMax)) {
    errors.push('zMin must be < zMax');
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Below this line: DOM-touching (browser only, no Node test - same split as
// pick.js/select.js). `renderPropertyPanel` regenerates the whole form on
// every call (selection change, undo/redo, a committed field edit) - cheap,
// a handful of DOM nodes, not a per-frame path (24.14's allocation rule only
// applies to the render loop).
// ---------------------------------------------------------------------------

function makeDatalist(container, id, values) {
  let dl = container.ownerDocument.getElementById(id);
  if (!dl) {
    dl = document.createElement('datalist');
    dl.id = id;
    container.appendChild(dl);
  }
  dl.textContent = '';
  for (const v of values) {
    const opt = document.createElement('option');
    opt.value = v;
    dl.appendChild(opt);
  }
  return dl;
}

/** US-066: `x`/`y`/`z` get amber/green/cyan axis badges (design/editor-ui.md 1: "X amber, Y green, Z cyan"). */
const AXIS_CLASS = { x: 'x', y: 'y', z: 'z' };

/**
 * Renders the property form for the current selection into `container`
 * (24.9: a form generated from the item's own JSON shape - number/string/
 * boolean inputs, array-or-object fields as a JSON textarea; US-066 restyles
 * this into a header + POSITION card + a Properties card, same per-field
 * commit/validate/undo path as before - no behaviour change). `ctx`:
 * `{ doc, selection, assets, palette, behaviourNames, onFieldCommit(patch),
 * onRename(newId, setError) }`.
 */
export function renderPropertyPanel(container, ctx) {
  container.textContent = '';
  const { doc, selection } = ctx;
  if (!selection) {
    const empty = document.createElement('div');
    empty.className = 'insp-empty';
    empty.textContent = '(nothing selected)';
    container.appendChild(empty);
    return;
  }
  const item = selectionItemData(doc, selection);
  if (!item) {
    const empty = document.createElement('div');
    empty.className = 'insp-empty';
    empty.textContent = '(item not found)';
    container.appendChild(empty);
    return;
  }
  const kind = kindForSelection(selection);

  const errEl = document.createElement('div');
  errEl.className = 'insp-error';
  container.appendChild(errEl);

  const header = document.createElement('div');
  header.className = 'insp-header';
  const glyph = document.createElement('span');
  glyph.className = 'insp-glyph';
  glyph.textContent = KIND_GLYPHS[kind] || '?';
  const idEl = document.createElement('span');
  idEl.className = 'insp-id';
  idEl.textContent = item.id;
  const kindChip = document.createElement('span');
  kindChip.className = 'insp-kind-chip';
  kindChip.textContent = kind;
  header.appendChild(glyph);
  header.appendChild(idEl);
  header.appendChild(kindChip);
  container.appendChild(header);

  const file = doc.files.get(selection.fileId);
  const siblingIdsFor = (collection, excludeId) => {
    const ids = new Set((file.def[collection] || []).map((it) => it.id));
    ids.delete(excludeId);
    return ids;
  };

  /**
   * Builds one field's input (exactly the original 24.9 type-dispatch +
   * datalist wiring) and wires the same commit/validate/undo path as before -
   * `renderOutliner`/`renderProperties` call site owns the undo stack, this
   * function only ever calls `ctx.onFieldCommit`/`ctx.onRename`. Returns the
   * `<input>`/`<textarea>` element (the caller lays it out, e.g. an axis
   * field vs. a generic labelled row).
   */
  function buildInput(key) {
    const val = item[key];
    let input;
    if (typeof val === 'number') {
      input = document.createElement('input');
      input.type = 'number';
      input.step = 'any';
      input.value = String(val);
    } else if (typeof val === 'boolean') {
      input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = val;
    } else if (val !== null && typeof val === 'object') {
      input = document.createElement('textarea');
      input.rows = 2;
      input.value = JSON.stringify(val);
    } else {
      input = document.createElement('input');
      input.type = 'text';
      input.value = val == null ? '' : String(val);
      if (key === 'interact' || key === 'trigger') {
        const listId = `panel-datalist-behaviours`;
        makeDatalist(container, listId, ctx.behaviourNames || []);
        input.setAttribute('list', listId);
      } else if (key === 'model') {
        const listId = 'panel-datalist-models';
        makeDatalist(container, listId, ctx.assets ? ctx.assets.keys('model') : []);
        input.setAttribute('list', listId);
      } else if (key === 'preset') {
        const listId = 'panel-datalist-presets';
        makeDatalist(container, listId, lightPresetNames(ctx.palette || {}));
        input.setAttribute('list', listId);
      }
    }

    const commitField = () => {
      let raw;
      if (input.type === 'number') {
        raw = Number(input.value);
      } else if (input.type === 'checkbox') {
        raw = input.checked;
      } else if (input.tagName === 'TEXTAREA') {
        try { raw = JSON.parse(input.value); } catch (e) { errEl.textContent = `${key}: invalid JSON (${e.message})`; return; }
      } else {
        raw = input.value;
      }
      if (key === 'id') {
        if (raw === item.id) { errEl.textContent = ''; return; }
        ctx.onRename(raw, (msg) => { errEl.textContent = msg; });
        return;
      }
      const patch = { [key]: raw };
      const candidate = { ...item, ...patch };
      const siblingIds = siblingIdsFor(selection.collection, item.id);
      const errors = validateItem(kind, candidate, { assets: ctx.assets, palette: ctx.palette, siblingIds });
      if (errors.length) { errEl.textContent = errors.join('; '); return; }
      errEl.textContent = '';
      ctx.onFieldCommit(patch);
    };
    input.addEventListener(input.type === 'checkbox' ? 'change' : 'blur', commitField);
    return input;
  }

  // ---- POSITION card: x/y/z (axis-coloured) + yaw (facing/yawDeg) --------
  const posKeys = ['x', 'y', 'z'].filter((k) => k in item);
  const yawKey = typeof item.facing === 'number' ? 'facing' : (typeof item.yawDeg === 'number' ? 'yawDeg' : null);
  if (posKeys.length || yawKey) {
    const card = document.createElement('div');
    card.className = 'insp-card';
    const title = document.createElement('div');
    title.className = 'insp-card-title';
    title.textContent = 'Position';
    card.appendChild(title);
    if (posKeys.length) {
      const grid = document.createElement('div');
      grid.className = 'insp-pos-grid';
      for (const axis of posKeys) {
        const field = document.createElement('div');
        field.className = 'insp-axis-field';
        const badge = document.createElement('span');
        badge.className = `insp-axis-badge ${AXIS_CLASS[axis] || ''}`;
        badge.textContent = axis.toUpperCase();
        const input = buildInput(axis);
        field.appendChild(badge);
        field.appendChild(input);
        grid.appendChild(field);
      }
      card.appendChild(grid);
    }
    if (yawKey) {
      const yawRow = document.createElement('div');
      yawRow.className = 'insp-field-row insp-yaw-row';
      const label = document.createElement('span');
      label.className = 'insp-field-label';
      label.textContent = 'YAW (deg)';
      const input = buildInput(yawKey);
      yawRow.appendChild(label);
      yawRow.appendChild(input);
      card.appendChild(yawRow);
    }
    container.appendChild(card);
  }

  // ---- Properties card: id + every remaining field ------------------------
  const handled = new Set([...posKeys, yawKey].filter(Boolean));
  const card = document.createElement('div');
  card.className = 'insp-card';
  const title = document.createElement('div');
  title.className = 'insp-card-title';
  title.textContent = 'Properties';
  card.appendChild(title);
  for (const key of Object.keys(item)) {
    if (handled.has(key)) continue;
    const row = document.createElement('label');
    row.className = 'insp-field-row';
    const label = document.createElement('span');
    label.className = 'insp-field-label';
    label.textContent = key;
    row.appendChild(label);
    row.appendChild(buildInput(key));
    card.appendChild(row);
  }
  container.appendChild(card);
}
