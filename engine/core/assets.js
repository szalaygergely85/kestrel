// AssetRegistry (US-024, docs/architecture.md section 6): a typed
// dictionary over the designer's content pack, validation on construction,
// `get`-shaped accessors that throw on an unknown key. The engine never
// reads `window.ASSETS`/globals itself (check-deps rule 2) - `main.js` reads
// them exactly once, via `AssetRegistry.fromGlobals`, and hands the registry
// to `createEngine`.

const KINDS = ['model', 'level', 'terrain', 'world'];

function throwUnknown(kind, key, map) {
  const known = Object.keys(map).join(', ') || '(none)';
  throw new Error(`AssetRegistry: unknown ${kind} "${key}" (known: ${known})`);
}

export class AssetRegistry {
  /** @param {import('./assets.js').AssetBundle} bundle */
  constructor(bundle = {}) {
    if (!bundle.palette) {
      throw new Error('AssetRegistry: bundle.palette is required');
    }
    if (typeof bundle.palette.util?.validate === 'function') {
      const errs = bundle.palette.util.validate();
      if (errs && errs.length) {
        throw new Error(`AssetRegistry: palette failed validation:\n${errs.join('\n')}`);
      }
    }
    if (bundle.detailPass && typeof bundle.detailPass.util?.validate === 'function') {
      const errs = bundle.detailPass.util.validate();
      if (errs && errs.length) {
        throw new Error(`AssetRegistry: detailPass failed validation:\n${errs.join('\n')}`);
      }
    }

    this._palette = bundle.palette;
    this._models = bundle.models || {};
    // (US-011, 7.5 item 2) Numeric variants: a model whose `variants[]` are
    // themselves full billboard sub-models (`rubble`, `rope`) get packed by
    // the sprite atlas under `${key}#${n}` so `sprite.model = 'rubble#1'`
    // resolves like any other model key. A `variants[]` of plain strings
    // (`lantern`, `relay` - the anim-name kind, README 4) is left alone.
    // Idempotent (checked before writing) since `bundle.models` is the same
    // object across every `AssetRegistry` built from the same globals.
    for (const key of Object.keys(this._models)) {
      const def = this._models[key];
      const variants = def && def.variants;
      if (Array.isArray(variants) && variants.length && variants[0] && typeof variants[0] === 'object' && variants[0].billboard) {
        variants.forEach((v, i) => {
          const vk = `${key}#${i}`;
          if (!(vk in this._models)) this._models[vk] = v;
        });
      }
    }
    this._levels = bundle.levels || {};
    this._terrain = bundle.terrain || {};
    this._worlds = bundle.worlds || {};
    this._uiStyle = bundle.uiStyle || null;
    // US-028: the designer's v2 detail-pass proposal (design/detail-pass.js
    // `ASSETS.detailPass`), read through the registry like every other
    // content pack - optional (older bundles / tests without it get the v1
    // look everywhere, same as `?detail=0`).
    this._detailPass = bundle.detailPass || null;
    // US-027a (architecture.md 21.7): null for a registry built with
    // `fromGlobals` - only `fromJSON` sets this to the manifest's value.
    this._contentVersion = bundle.contentVersion != null ? bundle.contentVersion : null;
  }

  get palette() {
    return this._palette;
  }

  get contentVersion() {
    return this._contentVersion;
  }

  get detailPass() {
    return this._detailPass;
  }

  get uiStyle() {
    return this._uiStyle;
  }

  model(key) {
    if (!(key in this._models)) throwUnknown('model', key, this._models);
    return this._models[key];
  }

  level(key) {
    if (!(key in this._levels)) throwUnknown('level', key, this._levels);
    return this._levels[key];
  }

  terrain(key) {
    if (!(key in this._terrain)) throwUnknown('terrain', key, this._terrain);
    return this._terrain[key];
  }

  world(key) {
    if (!(key in this._worlds)) throwUnknown('world', key, this._worlds);
    return this._worlds[key];
  }

  has(kind, key) {
    const map = this._mapFor(kind);
    return key in map;
  }

  keys(kind) {
    return Object.keys(this._mapFor(kind));
  }

  _mapFor(kind) {
    switch (kind) {
      case 'model': return this._models;
      case 'level': return this._levels;
      case 'terrain': return this._terrain;
      case 'world': return this._worlds;
      default: throw new Error(`AssetRegistry: unknown kind "${kind}" (expected one of ${KINDS.join(', ')})`);
    }
  }

  /**
   * Convenience for game/js/main.js: splits `ASSETS.levels` into `levels`
   * (has `rows` - a sector-map LevelDef, e.g. test_room/tower) and `terrain`
   * (has `util.heightAt` - a TerrainRecipe, e.g. overworld_far), by shape.
   * @param {Object} globals  `window.ASSETS`, as built by the design/ classic
   *   scripts - read by the CALLER (main.js), not by the engine (check-deps
   *   rule 2); this method just takes the resulting plain object as a normal
   *   argument.
   */
  static fromGlobals(globals) {
    const allLevels = globals.levels || {};
    const levels = {};
    const terrain = {};
    for (const key of Object.keys(allLevels)) {
      const def = allLevels[key];
      if (def && def.util && typeof def.util.heightAt === 'function') {
        terrain[key] = def;
      } else {
        levels[key] = def;
      }
    }
    return new AssetRegistry({
      palette: globals.palette,
      models: globals.models,
      levels,
      terrain,
      worlds: globals.worlds,
      uiStyle: globals.uiStyle,
      detailPass: globals.detailPass || null,
    });
  }

  /**
   * US-027a (architecture.md 21.7): sync, replaces the old async stub.
   * `codeParts` has the SAME shape as `fromGlobals`'s input (the game
   * passes `window.ASSETS`) - still the source of palette/detailPass/
   * uiStyle/models and the code terrain recipe (e.g. `overworld_far`).
   * `bundle.levels`/`bundle.worlds` (a `ContentBundle` from
   * `loadContentPack`) are overlaid on top; a key present in both JS and
   * JSON throws (D-023 item 4: no dual source).
   * @param {Object} bundle  a `ContentBundle` (loadPack.js)
   * @param {Object} codeParts  same shape as `fromGlobals`'s `globals`
   */
  static fromJSON(bundle, codeParts) {
    const allLevels = codeParts.levels || {};
    const levels = {};
    const terrain = {};
    for (const key of Object.keys(allLevels)) {
      const def = allLevels[key];
      if (def && def.util && typeof def.util.heightAt === 'function') {
        terrain[key] = def;
      } else {
        levels[key] = def;
      }
    }
    for (const key of Object.keys(bundle.levels || {})) {
      if (key in levels) throw new Error(`AssetRegistry.fromJSON: level "${key}" is defined in both JS and JSON content`);
      levels[key] = bundle.levels[key];
    }
    const worlds = { ...(codeParts.worlds || {}) };
    for (const key of Object.keys(bundle.worlds || {})) {
      if (key in worlds) throw new Error(`AssetRegistry.fromJSON: world "${key}" is defined in both JS and JSON content`);
      worlds[key] = bundle.worlds[key];
    }
    return new AssetRegistry({
      palette: codeParts.palette,
      models: codeParts.models,
      levels,
      terrain,
      worlds,
      uiStyle: codeParts.uiStyle,
      detailPass: codeParts.detailPass || null,
      contentVersion: bundle.contentVersion,
    });
  }
}
