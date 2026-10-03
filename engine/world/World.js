// engine/world/World.js (US-025, D-007). Real implementation per
// docs/architecture.md section 7 (World/WorldQuery), 7.2 (structTable) and
// 10/10.1 (entities/handles). See the tech notes in docs/backlog.md US-025
// for the build order this follows.
import { loadLevel } from './Level.js';
import { Terrain } from './Terrain.js';
import { packLevel, updateAnimatedSector } from './packed.js';
import { Entity } from '../entities/Entity.js';
import { EntityHandle } from '../entities/EntityHandle.js';
import { EventRing } from '../entities/eventRing.js';
import { getBehaviour, validateBehaviours } from '../core/behaviours.js';
import { buildTriggers } from './triggers.js';
import { clamp01 } from '../core/math.js';
import { makeFrame, localToWorld, frameBBox } from '../core/transform.js';
import { gridLocal } from './gridLocal.js';
import { buildWorldColliders, refitDynCollider } from './colliders.js';
import { moveCircleMesh, moveSphereMesh, probeSupport, meshSupportSector, raycastColliders, FLOOR_NONE } from '../physics/meshCollide.js';
import { pointBlocked } from './interaction.js';
import { createWind } from './wind.js';
import { createClothSystem, collectClothDefs } from './cloths.js';
import { createWater, collectWaterDefs, SEA_STATES } from './water.js';
import { createWaterfalls, collectWaterfallDefs } from './waterfalls.js';
import { waveHeight } from './waves.js';

// Default answer for `World#outsideSector` when the world has no terrain at
// all (`def.terrain` is null - `?level=test_room`'s ephemeral world): a
// solid wall, matching `Level`'s own `outsideSector` default (D-008), so a
// terrain-less world behaves exactly like today's bare `Level`.
const SOLID_OUTSIDE = Object.freeze({
  floorH: 3, ceilH: 'sky', wallMat: 'stone', floorMat: 'floor', ceilMat: 'sky',
  solid: true, topH: 'sky', upperMat: 'stone',
});

const tmpW = { x: 0, y: 0, z: 0 }; // localToWorld scratch (load-time only)

/** ED-SCALE-1 (architecture.md 34.1): allowed per-object uniform scale range. */
export const PROP_SCALE_MIN = 0.25;
export const PROP_SCALE_MAX = 4;

/** Validates a content `scale`; returns it rounded to 0.01. Throws naming `label`. */
function readScale(v, label) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < PROP_SCALE_MIN || v > PROP_SCALE_MAX) {
    throw new Error(`World.load: ${label} scale ${v} outside [${PROP_SCALE_MIN}, ${PROP_SCALE_MAX}]`);
  }
  return Math.round(v * 100) / 100;
}
// console.info of the level-sun fallback: once per process.
let sunInfoShown = false;

function ease(kind, t) {
  if (kind === 'inOut') return t * t * (3 - 2 * t); // smoothstep
  return t; // linear (default)
}

// (US-016b) `ringHAt(x, y)`: nearest outer-ring `floorH` of a placed
// structure, wired into `recipe.structures[i]` before the terrain bakes, so
// `structureBlend` in the recipe blends against the REAL level data instead
// of the flat `ringH` fallback constant.
function makeRingHAt(placed) {
  const level = placed.level;
  const w = level.width, h = level.height;
  const g = { x: 0, y: 0, z: 0 };
  return function ringHAt(x, y) {
    gridLocal(placed, x, y, g);
    const lx = g.x, ly = g.y;
    let cx = Math.min(Math.max(lx, 0.5), w - 0.5);
    let cy = Math.min(Math.max(ly, 0.5), h - 0.5);
    const dl = cx, dr = w - cx, dt = cy, db = h - cy;
    const m = Math.min(dl, dr, dt, db);
    if (m === dl) cx = 0.5; else if (m === dr) cx = w - 0.5;
    if (m === dt) cy = 0.5; else if (m === db) cy = h - 0.5;
    const s = level.sectorAt(cx, cy);
    return s ? s.floorH + g.z : g.z;
  };
}

// ED-MESH-1d: cheap key of everything the near-band bake reads from the placed structures
// (`structureBlend`: bbox + ringHAt = outer-ring sector floorH + frame z). Perimeter cells only.
function nearBandKey(w, cx, cy) {
  let k = `${cx},${cy}`;
  for (const p of w.structures) {
    if (p.kind === 'mesh') continue;
    const lv = p.level, W = lv.width, H = lv.height, b = p.bbox;
    k += `|${p.id}:${b.x0},${b.y0},${b.x1},${b.y1},${p.origin.x},${p.origin.y},${p.origin.z},${p.yawSteps}:`; // origin = what ringHAt reads (31 amendment 2)
    const f = (x, y) => { const s = lv.sectorAt(x, y); k += (s ? s.floorH : 'n') + ','; };
    for (let x = 0.5; x < W; x++) { f(x, 0.5); f(x, H - 0.5); }
    for (let y = 1.5; y < H - 1; y++) { f(0.5, y); f(W - 0.5, y); }
  }
  return k;
}

// US-026a (architecture.md 23.1 decision 4, 23.2): `world.bounds` - the walk
// bound circle, optional (absent = unbounded, matching every world before
// this story). Validated up front like `validateHorizon` below (throws,
// never silently dropped) and returns a plain copy (content, not state -
// never mutated at runtime).
function validateBounds(b) {
  if (b == null) return null;
  if (b.shape !== 'circle') throw new Error(`World.load: bounds: unknown shape "${b.shape}"`);
  if (typeof b.x !== 'number' || !isFinite(b.x)) throw new Error('World.load: bounds.x must be a finite number');
  if (typeof b.y !== 'number' || !isFinite(b.y)) throw new Error('World.load: bounds.y must be a finite number');
  if (typeof b.r !== 'number' || !isFinite(b.r) || b.r <= 0) throw new Error('World.load: bounds.r must be a finite number > 0');
  return { shape: 'circle', x: b.x, y: b.y, r: b.r };
}

// US-016 D-011 addendum (architecture.md 14.4 item 13): `world.horizon[]`
// validation - unique `id`, a model the registry actually has, numeric
// `bearingDeg`/`elevDeg`/`angular.wDeg`/`angular.hDeg`, `fog` in [0,1], a
// `fogColor` palette key. Throws WITH the offending id (matches every other
// World.load validation in this file - never a silent drop).
function validateHorizon(list, assets) {
  if (!list) return [];
  const seen = new Set();
  for (const h of list) {
    const id = h && h.id;
    const tag = id ? `"${id}"` : '(no id)';
    if (!id || typeof id !== 'string') throw new Error(`World.load: horizon entry ${tag}: "id" is required`);
    if (seen.has(id)) throw new Error(`World.load: horizon "${id}": duplicate id`);
    seen.add(id);
    if (typeof h.model !== 'string' || !assets.has('model', h.model)) {
      throw new Error(`World.load: horizon "${id}": unknown model "${h.model}"`);
    }
    if (typeof h.bearingDeg !== 'number' || !isFinite(h.bearingDeg)) throw new Error(`World.load: horizon "${id}": "bearingDeg" must be a finite number`);
    if (typeof h.elevDeg !== 'number' || !isFinite(h.elevDeg)) throw new Error(`World.load: horizon "${id}": "elevDeg" must be a finite number`);
    if (!h.angular || typeof h.angular.wDeg !== 'number' || typeof h.angular.hDeg !== 'number') {
      throw new Error(`World.load: horizon "${id}": "angular.wDeg"/"angular.hDeg" are required`);
    }
    const fog = typeof h.fog === 'number' ? h.fog : 0;
    if (fog < 0 || fog > 1) throw new Error(`World.load: horizon "${id}": "fog" must be in [0, 1]`);
    if (h.fogColor && typeof h.fogColor !== 'string') throw new Error(`World.load: horizon "${id}": "fogColor" must be a palette key string`);
  }
  // Content, not state: kept as the caller's own objects (never mutated at
  // runtime) - `structuredClone` only at the `World.load`/`serialize`
  // boundary keeps a saved file independent of the source asset.
  return structuredClone(list);
}

const RAY_STEP = 0.1, RAY_MAX_SAMPLES = 20, RAY_BISECT = 6;
const _rayHit = { t: 0, tri: -1, u: 0, v: 0, nx: 0, ny: 0, nz: 0, collider: -1 };

export class World {
  constructor() {
    this.terrain = null;
    this.terrainKey = null;
    // ME-11a (docs/architecture.md 27.18): 'grid' (default, unchanged
    // behaviour) or 'mesh'. Content, not state - never goes through
    // `structuredClone(def.state)`/`serialize.js`, set once by `World.load`
    // from `opts.physics` and never touched afterward.
    this.physicsMode = 'grid';
    // `MeshCollider[]` (engine/physics/meshCollide.js 27.17 shape), built by
    // `colliders.js`'s `buildWorldColliders` when `physicsMode === 'mesh'`;
    // stays `[]` on 'grid' (derived data - never serialized, always rebuilt
    // fresh on load).
    this.colliders = [];
    // US-026a (architecture.md 23.1 decision 4): the walk-bound circle, or
    // `null` (unbounded - every world before this story). Content, not
    // state; set once by `World.load` from `def.bounds`.
    this.bounds = null;
    // US-016 D-011 addendum (architecture.md 14.4 item 13): horizon
    // billboards - plain data, content not state (never mutated at
    // runtime), not entities (they have no world position - placed by
    // angle). `World.load` copies `def.horizon` here; `serialize` writes it
    // straight back.
    this.horizon = [];
    // US-138 (architecture.md 32.5): the wind field - `World.load` builds it
    // from the optional `def.wind` block (content, not state: never in
    // `serialize.js`, same convention as `bounds`/`horizon` above). A world
    // with no `wind` block gets a calm field (speed 0), never `null`, so
    // every consumer (particles, fire, the player push) can call
    // `world.wind.sampleInto`/`pushAt` unconditionally.
    this.wind = createWind(null, 1);
    this.cloths = createClothSystem([], null, null); // CLOTH-1b3: empty until `load`
    // US-055a1 (32.2): water regions (SoA, `engine/world/water.js`), content not state. `waterDef` = the WORLD-level
    // block as authored (what `serialize` round-trips, like `horizon`); level blocks come back from the level.
    this.water = createWater([]);
    this.waterDef = [];
    this.waterfallDef = [];
    this.waterfalls = [];
    // RE-11b (architecture.md 28.3, "Save" / CO-5 extension): the sight/fog
    // grid, or `null` (default - every world before this story, and most
    // worlds even after it: `Visibility` needs grid dimensions the GAME
    // decides, not level/world content, so it is never built from `def`
    // here - the game sets this field once it knows its grid, and
    // `serialize`/`deserialize` round-trip it when non-null).
    this.visibility = null;
    // US-133 (architecture.md 32.3): the fire-spread grid (engine/world/fireGrid.js), or null; the game builds it and `serialize` saves it when set.
    this.fire = null;
    this.structures = [];
    this.structTable = new Float32Array(8 * 8);
    this.renderVersion = 0;
    // US-030a (docs/architecture.md 14.2 item 2): "world.structVersion, not
    // per frame" - a narrower signal than `renderVersion` (which also bumps
    // on `animateSector`/`spawn`/etc, i.e. every sim step of a grate
    // opening). `WorldTextures.js` needs to tell "the placed-structure LIST
    // changed shape" (full atlas rebuild) apart from "a placed structure's
    // own cells changed" (dirty-row `texSubImage2D` only, via
    // `packed.version`) - only `placeStructure` bumps this.
    this.structVersion = 0;
    this.nextId = 0;
    this.state = {};
    // US-027a (architecture.md 21.8): `null` until `load()` sets it from
    // `assets.contentVersion` - a world built with `fromGlobals` assets (or
    // a bare `new World()`) stays `null` forever, so `serialize` writes
    // nothing extra for it.
    this.contentVersion = null;
    // Runtime ids that come from content data (a level's `props[]`, keyed
    // `${placementId}.${propId}`, and a content world's `entities[].id` -
    // looked up from `assets`, NOT from whatever `def.entities` this
    // particular `load()` call was given, so a deserialize's merged
    // entity list can't mislabel a runtime-spawned entity as content).
    // `remove(id)` on one of these adds it to `_removedContent`.
    this._contentIds = new Set();
    this._removedContent = new Set();
    // (US-011) `AssetRegistry` used to resolve `sprite.model`/`anim` for
    // `EntityHandle.play`/`stepAnimations` and the prop spawn below. Set by
    // `World.load`; stays null on a bare `new World()`.
    this.assets = null;
    this.events = null;
    // (US-012) Built by `load()` from every placed structure's
    // `def.interactables`; a bare `new World()` (no `load`) gets an empty
    // list rather than `undefined`, so `findInteractTarget` never needs a
    // null check on the hot path.
    this.interactables = [];
    this.interaction = { targetKey: null, prompt: '', dist: 0, angleDeg: 0 };
    // (US-017) Built by `load()` from every placed structure's
    // `def.triggers` - see `buildTriggers` (engine/world/triggers.js).
    this.triggers = [];

    this._entities = new Map();   // id -> plain entity data
    this._grid = { x: 0, y: 0, z: 0 }; // gridLocal scratch (rule 9)
    this._handles = new Map();    // id -> EntityHandle (cached, same object until remove)
    this._listeners = new Map();  // id -> Map<event, Set<fn>>
    this._eventRing = new EventRing(256);
    // US-026a (23.3): `terrain`/`nx`/`ny`/`nz` added (from `groundNormalAt`)
    // - Level sectors have no `terrain` field, so nothing else changes.
    this._outsideScratch = { floorH: 0, ceilH: 'sky', wallMat: 'rock', floorMat: 'grass', ceilMat: 'sky', solid: false, topH: 'sky', upperMat: 'rock', terrain: false, nx: 0, ny: 0, nz: 1 };
    // Reused (rule 9) output for `groundNormalAt` inside `outsideSector`.
    this._outsideNormalScratch = { x: 0, y: 0, z: 1 };
    // ME-11a (27.18): `supportAt`'s reused scratch (same "callers must not
    // keep it across calls" contract as `_outsideScratch`/`outsideSector`).
    this._meshSupportScratch = { floorZ: 0, floorHit: false, fnx: 0, fny: 0, fnz: 0, floorCollider: -1, floorTri: -1, ceilZ: 0, ceilHit: false };
    this._meshSectorScratch = { floorH: 0, ceilH: 'sky', solid: false, terrain: false, slope: false, nx: 0, ny: 0, nz: 1 };
    this._meshTerrainNormalScratch = { x: 0, y: 0, z: 1 };
    this.eventsDropped = 0;

    // Item 5a (architect review #1): bound once here, not re-created (a
    // fresh closure) on every `flushEvents()`/sim-step call.
    this._dispatchEvent = (id, event, arg) => {
      const forId = this._listeners.get(id);
      if (!forId) return;
      const set = forId.get(event);
      if (!set || set.size === 0) return;
      const handle = this._handles.get(id); // may be null if removed since the event was queued
      if (!handle) return;
      // Iterating the Set directly (not `Array.from(set)`) is safe re-entrancy:
      // `off()` removing an entry mid-iteration, or `on()` adding one, are
      // both defined behaviour for a live JS Set (a removed-then-added same
      // key is simply visited once), and the ring's own drain already
      // snapshots which (id,event,arg) triples fire this call.
      for (const fn of set) fn(handle, event, arg);
    };
  }

  /**
   * @param {Object} def - WorldDef (design/levels/world_m1.js shape) or an ephemeral equivalent (`?level=test_room`).
   * @param {import('../core/assets.js').AssetRegistry} assets
   * @param {{events?: import('../core/events.js').Events, terrain?: import('./Terrain.js').Terrain}} [opts]
   * @returns {World}
   */
  static load(def, assets, opts = {}) {
    const w = new World();
    w.events = opts.events || null;
    w.def = def;
    // ME-11a (27.18): default 'grid' (unchanged behaviour when `opts.physics`
    // is omitted - every existing caller/suite stays bit-identical).
    w.physicsMode = opts.physics === 'mesh' ? 'mesh' : 'grid';
    // (US-011) Kept for `EntityHandle.play`/`stepAnimations`/the prop-spawn
    // block below to resolve `sprite.model`/`anim` through - a bare `new
    // World()` (no `load`) has `assets === null`, and every consumer treats
    // that as "skip, warn, never throw" (7.5 item 3).
    w.assets = assets;
    w.state = structuredClone(def.state || {});
    // US-027a (architecture.md 21.8): `assets` may be `null` on a bare
    // ephemeral load (7.5 item 3 convention - never throw, just skip).
    w.contentVersion = assets ? (assets.contentVersion ?? null) : null;

    if (def.terrain) {
      w.terrainKey = def.terrain;
      // ED-MESH-1a (31.2): reuse a passed Terrain baked from the same recipe (a prop-only editor reload keeps the bake).
      const recipe = assets.terrain(def.terrain);
      w.terrain = opts.terrain && opts.terrain.recipe === recipe ? opts.terrain : new Terrain(recipe);
    }
    w.bounds = validateBounds(def.bounds);
    // US-138 (32.5): built once here, after bounds, before the sun block
    // below (order doesn't matter to wind itself - it reads nothing else off
    // `w`). `def.wind` may be absent -> `createWind(null, ...)` -> calm.
    w.wind = createWind(def.wind, 1);

    // CO-2 (coordinates.md 4): the sun is a world property. `def.sun` wins;
    // an ephemeral `?level=` world (no world file) falls back to the first
    // structure's level `sun` (announced once); `null` = palette default.
    w.sun = def.sun || null;
    w.sunSource = w.sun ? 'world' : null;

    // US-016 D-011 addendum (architecture.md 14.4 item 13): `world.horizon[]`
    // - validated up front (throws WITH the offending id, never silently
    // dropped) so a bad level def fails fast at load, same as everything
    // else in this function.
    w.horizon = validateHorizon(def.horizon, assets);
    w.waterDef = structuredClone(def.water || []);
    w.waterfallDef = structuredClone(def.waterfalls || []);

    for (const s of def.structures || []) {
      const placed = s.mesh
        ? w.placeMesh(assets.mesh(s.mesh), s.origin, s.id, s.yawDeg ?? 0)
        : w.placeStructure(assets.level(s.level), s.origin, s.id, s.yawSteps || 0);
      if (placed.kind !== 'mesh' && s.dynamics) {
        for (const tag of Object.keys(s.dynamics)) {
          w._restoreDynamics(placed, tag, s.dynamics[tag]);
        }
      }
    }

    // ME-11a (27.18): built AFTER structures are placed and dynamics are
    // restored above - `buildWorldColliders`'s dyn colliders read each tag's
    // CURRENT (already-restored) `ceilH`, so a save taken mid-animation
    // loads with the right collider. Colliders are derived data: never in
    // `serialize`, always rebuilt fresh here.
    if (w.physicsMode === 'mesh') {
      w.colliders = buildWorldColliders(w);
    }

    // (US-016b, moved by CO-8) Wire each placed structure's real ring height
    // into the terrain recipe's own `structures[i]` entry (matched by id),
    // BEFORE `bakeNearBand` runs below - `structureBlend` inside the recipe
    // reads real level data (not its flat `ringH` fallback) even on the
    // FIRST bake. This block only needs `w.structures` (already placed
    // above, each with `.bbox`/`.frame` set by `placeStructure`) and
    // `w.terrain.recipe.structures` - nothing computed later (`w.triggers`,
    // entities) - so running it here is safe. Previously this ran after
    // `bakeNearBand` (docs/backlog.md CO-2 row), so the first bake read the
    // recipe's stale/fallback `ringHAt`/`bbox` instead of the real placed
    // data.
    if (w.terrain && w.terrain.recipe.structures) {
      for (const rs of w.terrain.recipe.structures) {
        const placed = w.structures.find((p) => p.id === rs.id);
        if (placed && placed.kind !== 'mesh') {
          rs.ringHAt = makeRingHAt(placed);
          // CO-2/CO-9: the placement has ONE source (the world file); the recipe
          // no longer carries its own x/y/w/h/ringH copy at all (that literal
          // fallback was removed by CO-9) - `bbox`/`ringHAt` injected here are the
          // only path `structureBlend` reads.
          rs.bbox = { x0: placed.bbox.x0, y0: placed.bbox.y0, x1: placed.bbox.x1, y1: placed.bbox.y1 };
        }
      }
    }

    // US-026a (architecture.md 23.1 decision 1, 23.7 S2): bake the near
    // terrain band synchronously, BEFORE any prop/entity spawns below (a
    // `z: 'ground'` prop/entity needs `terrain.groundAt` ready). Centered on
    // the chunk containing the combined bbox center of every placed
    // structure (no hard-coded world position here - 23's "do not" list -
    // this reads straight off the structures `World.load` just placed).
    // Skipped when the world has no terrain, or no structures to center on
    // (`?level=`-only ephemeral worlds).
    if (w.terrain && w.structures.length) {
      let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
      for (const s of w.structures) {
        if (s.bbox.x0 < bx0) bx0 = s.bbox.x0;
        if (s.bbox.y0 < by0) by0 = s.bbox.y0;
        if (s.bbox.x1 > bx1) bx1 = s.bbox.x1;
        if (s.bbox.y1 > by1) by1 = s.bbox.y1;
      }
      const cx = Math.floor((bx0 + bx1) / 2 / w.terrain.chunkSize);
      const cy = Math.floor((by0 + by1) / 2 / w.terrain.chunkSize);
      // ED-MESH-1d: a reused Terrain whose band was baked for the same centre and the same
      // structure footprints (bbox + z + outer-ring floorH, all `ringHAt` can read) is still valid.
      const key = nearBandKey(w, cx, cy);
      if (!(w.terrain.nearReady && w.terrain._nearKey === key)) {
        w.terrain.bakeNearBand(cx, cy);
        w.terrain._nearKey = key;
      }
    }

    if (!w.sun) {
      const first = w.structures.find((s) => s.kind !== 'mesh');
      const lsun = first && first.level && first.level.def && first.level.def.sun;
      if (lsun) {
        w.sun = lsun;
        w.sunSource = 'level';
        if (!w.terrain && !sunInfoShown) {
          sunInfoShown = true;
          console.info('[World] no world sun: using the first structure level sun (ephemeral ?level= world, coordinates.md 4)');
        }
      }
    }

    // (US-012, 7.4) `world.interactables`: every placed structure's
    // `def.interactables`, in world coords (level x,y,z + origin).
    // `usedKey` is precomputed here (not in the hot `findInteractTarget`
    // loop, rule 9) so a `once` entry's used flag never needs a per-call
    // string concatenation.
    w.interactables = [];
    for (const s of w.structures) {
      if (s.kind === 'mesh') continue;
      const def = s.level.def;
      for (const it of (def && def.interactables) || []) {
        localToWorld(s.frame, it.x, it.y, it.z, tmpW);
        w.interactables.push({
          key: `${s.id}.${it.id}`,
          structId: s.id,
          id: it.id,
          name: it.interact,
          x: tmpW.x,
          y: tmpW.y,
          z: tmpW.z,
          radius: it.radius,
          prompt: it.prompt || '',
          once: !!it.once,
          requires: it.requires || null,
          propId: it.prop ? `${s.id}.${it.prop}` : null,
          def: it,
          usedKey: it.once ? `used.${s.id}.${it.id}` : null,
        });
      }
    }
    w.interaction = { targetKey: null, prompt: '', dist: 0, angleDeg: 0 }; // reused (rule 9)

    // (US-011, 7.5 item 1) Props from level data -> generic prop entities,
    // right after `interactables`. A decal (`model` starting `decal:`,
    // US-021) or a chain (`from`/`to`, e.g. tower.js's "chains") is
    // level-authored, engine-agnostic visual data with no entity yet -
    // skipped without a warning. A saved id already present in
    // `def.entities` (the deserialize path) wins: the prop spawn is
    // skipped here so the entities loop below restores its saved state
    // instead of `spawn` throwing on a duplicate id; ids stay stable
    // (`${structId}.${propId}`) either way.
    {
      const savedIds = new Set((def.entities || []).map((ed) => ed.id));
      for (const s of w.structures) {
        if (s.kind === 'mesh') continue;
        const sdef = s.level.def;
        for (const p of (sdef && sdef.props) || []) {
          if (typeof p.model === 'string' && p.model.indexOf('decal:') === 0) continue;
          if (p.from || p.to) continue;
          const entId = `${s.id}.${p.id}`;
          // US-027a (21.8): a content id regardless of whether it's spawned
          // THIS call (saved/removed ones are skipped below but stay content).
          w._contentIds.add(entId);
          if (savedIds.has(entId) || (opts.skipIds && opts.skipIds.has(entId))) continue;
          // Animation names (7.5 item 2): a string `variant` (or legacy
          // `pose`) is the anim name; unknown -> the model's first anim,
          // warned once. A numeric `variant` selects `model.variants[n]`,
          // packed by the atlas as `${model}#${n}` (AssetRegistry).
          const variantRaw = p.variant !== undefined ? p.variant : p.pose;
          const modelKey = typeof variantRaw === 'number' ? `${p.model}#${variantRaw}` : p.model;
          if (!assets.has('model', modelKey)) throw new Error(`World.load: prop "${entId}" references unknown model "${modelKey}"`);
          const model = assets.model(modelKey);
          // US-041a (15.3 item 1, architect delta): "spawn picks `voxel` when
          // `registry.model(key).voxel` exists" - swapping a prop's art from
          // billboard to voxel needs no level edit and no save-format change,
          // since this is the ONLY place that decides which component a prop
          // gets, keyed purely on the model def the level already names.
          const isVoxel = !!model.voxel;
          const animsDict = (isVoxel ? model.voxel.animations : model.animations) || {};
          const animNames = Object.keys(animsDict);
          let anim;
          if (typeof variantRaw === 'string') {
            if (animsDict[variantRaw]) {
              anim = variantRaw;
            } else {
              console.warn(`World.load: prop "${entId}" model "${modelKey}" has no animation "${variantRaw}" - using "${animNames[0]}"`);
              anim = animNames[0];
            }
          } else {
            anim = animNames[0];
          }
          localToWorld(s.frame, p.x, p.y, 0, tmpW);
          const x = tmpW.x, y = tmpW.y;
          let z;
          if (p.z === 'ground') {
            if (w.terrain) {
              // US-026a (23.1 decision 2): physics/renderer read the near
              // band once it's ready, not the analytic function directly.
              z = w.terrain.groundAt(x, y);
            } else {
              console.warn(`World.load: prop "${entId}" z: 'ground' but the world has no terrain - using 0`);
              z = 0;
            }
          } else {
            z = localToWorld(s.frame, p.x, p.y, p.z || 0, tmpW).z;
          }
          // ED-SCALE-1 (34.1): optional uniform scale, voxel models only.
          let scale = 1;
          if (p.scale !== undefined) {
            scale = readScale(p.scale, `prop "${entId}"`);
            if (!isVoxel && scale !== 1) {
              console.warn(`World.load: prop "${entId}" is a sprite/billboard - scale ${scale} ignored (voxel models only)`);
              scale = 1;
            }
          }
          const comps = isVoxel
            ? { voxel: { model: modelKey, anim, loop: !!(anim && animsDict[anim].loop) } }
            : { sprite: { model: modelKey, anim, loop: !!(anim && animsDict[anim].loop) } };
          // `dynamic: true` (the boulder): body + roller, exactly as
          // boulder.test.js built them by hand before this story (US-013
          // tech note); `transform.z` is the feet position, same as `x`/`y`.
          if (p.dynamic) {
            comps.body = { radius: p.radius * scale, vx: 0, vy: 0, vz: 0, grounded: true };
            comps.roller = {};
          }
          // `facing` stays unrotated until CO-4 (yawSteps != 0 still throws).
          const pt = { x, y, z, yawDeg: p.facing || 0, pitchDeg: 0 };
          if (scale !== 1) pt.scale = scale;
          w.spawn('prop', pt, comps, entId, s.id);
        }
      }
    }

    // (US-017) `world.triggers`: every placed structure's `def.triggers`
    // (buildTriggers, engine/world/triggers.js). Rebuilt fresh on every
    // load/deserialize, same as `interactables` above - `inside` always
    // starts at 0, so standing inside a trigger right after a load counts
    // as a fresh enter on the next `updateTriggers` call (7.4).
    w.triggers = buildTriggers(w);

    // US-027a (21.8): world-entity content ids come from the ASSET's own
    // canonical `entities[]` (looked up by `def.name`), not from this
    // call's `def.entities` - deserialize passes a merged saved+content
    // list there, which must not be mistaken for "all content".
    if (assets && def.name && typeof assets.has === 'function' && assets.has('world', def.name)) {
      for (const ce of assets.world(def.name).entities || []) {
        if (ce && ce.id) w._contentIds.add(ce.id);
      }
    }

    for (const ed of def.entities || []) {
      let transform;
      let parent = null; // CO-2: structId when spawned from a structure (record, not a live frame)
      let components = ed.components ? structuredClone(ed.components) : undefined;
      if (ed.transform) {
        transform = { ...ed.transform };
      } else if (typeof ed.x === 'number' && typeof ed.y === 'number') {
        // Inline world position (architecture.md 14.4 item 7 shape, e.g. the
        // `farTower` billboard in world_m1.js): a transform shorthand.
        // US-026a (23.2): `z: 'ground'` (e.g. the endMarker waystone)
        // resolves through the terrain, same rule as a level prop above.
        let edZ;
        if (ed.z === 'ground') {
          if (w.terrain) {
            edZ = w.terrain.groundAt(ed.x, ed.y);
          } else {
            console.warn(`World.load: entity "${ed.id}" z: 'ground' but the world has no terrain - using 0`);
            edZ = 0;
          }
        } else {
          edZ = typeof ed.z === 'number' ? ed.z : 0;
        }
        transform = { x: ed.x, y: ed.y, z: edZ, yawDeg: ed.yawDeg || 0, pitchDeg: ed.pitchDeg || 0 };
        // US-016 (architecture.md 14.4 item 7): a `type: 'billboard'` entity
        // carries its sprite/billboard fields at the TOP level (model, unlit,
        // fogModel, fogMax, sizeM, minCells, detailRows), not under
        // `components` (design/README.md 4.1 - the level-data shape). Fold
        // them into `components.sprite`/`components.billboard` here, once,
        // so `SpritePool` (which only ever reads `components`) and
        // `serialize`/`deserialize` (which only ever round-trip
        // `components`) need no special case for this entity type.
        if (ed.type === 'billboard' && !components && typeof ed.model === 'string') {
          components = {
            sprite: { model: ed.model, anim: 'idle', frame: 0 },
            billboard: {
              unlit: !!ed.unlit,
              fogModel: ed.fogModel || 'interior',
              fogMax: typeof ed.fogMax === 'number' ? ed.fogMax : 1,
              minCells: ed.minCells || null,
              detailRows: typeof ed.detailRows === 'number' ? ed.detailRows : 0,
            },
          };
        }
      } else if (ed.spawn) {
        const st = w.structures.find((s) => s.id === ed.spawn.structure);
        if (!st) throw new Error(`World.load: entity "${ed.id}" spawn.structure "${ed.spawn.structure}" not placed`);
        const local = ed.spawn.from === 'start' && st.kind !== 'mesh' ? st.level.start : null;
        if (!local) throw new Error(`World.load: entity "${ed.id}" spawn.from "${ed.spawn.from}" not supported`);
        localToWorld(st.frame, local.x, local.y, st.level.floorAt(local.x, local.y) ?? 0, tmpW);
        transform = {
          x: tmpW.x, y: tmpW.y, z: tmpW.z,
          yawDeg: local.facingDeg || 0, pitchDeg: local.pitchDeg || 0,
        };
        parent = st.id; // spawned FROM this structure - always its parent, takes priority over ed.parent
      } else {
        throw new Error(`World.load: entity "${ed.id}" needs "transform" or "spawn"`);
      }
      // CO-5 follow-up: a restored entity (transform/inline-xyz branch, not
      // `ed.spawn`) carries its own live `parent` on the def when it came
      // through `deserialize` - use it instead of leaving `null`.
      if (parent === null && typeof ed.parent === 'string') parent = ed.parent;
      // ED-SCALE-1 (34.1): `scale` inline shorthand or `transform.scale`;
      // stored only when != 1, voxel entities only (sprite/billboard: warn).
      const rawScale = ed.scale !== undefined ? ed.scale : transform.scale;
      if (rawScale === undefined) {
        delete transform.scale;
      } else {
        let sc = readScale(rawScale, `entity "${ed.id}"`);
        if (sc !== 1 && !(components && components.voxel)) {
          console.warn(`World.load: entity "${ed.id}" is not a voxel entity - scale ${sc} ignored (voxel models only)`);
          sc = 1;
        }
        if (sc === 1) delete transform.scale; else transform.scale = sc;
      }
      w.spawn(ed.type, transform, components || {}, ed.id, parent);
    }

    // US-055a1 (32.2): world + level `water` blocks (validated; throws naming the region).
    // US-143a (35.1): world key `seaState` (default "calm") seeds the "sea" regions' amplitude at load.
    const seaState = typeof def.seaState === 'string' ? def.seaState : 'calm';
    if (!SEA_STATES.has(seaState)) throw new Error(`World.load: "seaState" must be "calm" | "breezy" | "storm" (got "${seaState}")`);
    w.water = createWater(collectWaterDefs(def, w.structures), seaState);
    w.waterfalls = createWaterfalls(collectWaterfallDefs(def, w.structures));

    // CLOTH-1b3 (33.5): world + level `cloths` blocks (content, not state: never saved, never hashed). Terrain is baked above.
    w.cloths = createClothSystem(collectClothDefs(def, w.structures), w, assets && assets.clothPresets);

    if (typeof def.nextId === 'number') w.nextId = def.nextId;

    // (US-010 tech note 2) Data/registration agreement check, warned once
    // per load. The game (`?strict=1`) and the tests throw on the same list.
    const missing = validateBehaviours(w);
    if (missing.length) console.warn(`[World] ${missing.length} behaviour(s) referenced by level data but not registered: ${missing.join(', ')}`);

    if (w.events) w.events.emit('world:loaded', { world: w });
    return w;
  }

  // ---- structures -----------------------------------------------------------

  /**
   * @param {Object} levelDef
   * @param {{x:number,y:number,z:number}} origin
   * @param {string} [id]
   * @param {number} [yawSteps]
   */
  placeStructure(levelDef, origin, id, yawSteps = 0) {
    if (yawSteps) throw new Error('World.placeStructure: yawSteps != 0: not in M1');
    const level = loadLevel(levelDef);
    if (!level) throw new Error(`World.placeStructure: level "${levelDef && levelDef.name}" failed to load (see console)`);
    const structSeq = this.structures.filter((q) => q.kind !== 'mesh').length; // ME-14c1: level index only (meshes have no struct slot)
    const structId = id || `struct_${structSeq}`;
    const frame = makeFrame(origin.x, origin.y, origin.z || 0, yawSteps);
    const bbox = frameBBox(frame, level.width, level.height, { x0: 0, y0: 0, x1: 0, y1: 0 });
    const packed = packLevel(level, null);
    // US-014 tech note 1: a tag -> legend-char Map built once here, instead
    // of `animateSector` scanning `Object.keys(level.legend)` on every call
    // (an interaction/save-load call, but also every `stepSectorAnims` tick
    // while a sector is mid-animation).
    const tagMap = new Map();
    for (const ch of Object.keys(level.legend)) {
      const sec = level.legend[ch];
      if (sec.dynamic && sec.tag) tagMap.set(sec.tag, ch);
    }
    // CO-2: `frame` = the authored placement (content items convert through
    // it); `origin`/`bbox` = the baked grid (equal to the frame while yawSteps = 0).
    const placed = { id: structId, level, frame, origin: { x: origin.x, y: origin.y, z: origin.z || 0 }, yawSteps, bbox, packed, structSeq, dynamics: {}, tagMap };
    this.structures.push(placed);

    if (structSeq < 8) {
      const o = structSeq * 8;
      this.structTable[o] = origin.x;
      this.structTable[o + 1] = origin.y;
      this.structTable[o + 2] = origin.z || 0;
      this.structTable[o + 3] = level.width;
      this.structTable[o + 4] = level.height;
      this.structTable[o + 5] = yawSteps;
      this.structTable[o + 6] = level.cellSize;
      this.structTable[o + 7] = structSeq;
    }

    this.renderVersion++;
    this.structVersion++; // US-030a: the placed-structure LIST changed shape - see the constructor comment.
    if (this.events) this.events.emit('world:structurePlaced', { id: structId, origin: placed.origin });
    return placed;
  }

  /** Place content MeshData; grid sectors and dynamic tags remain level-only. */
  placeMesh(mesh, origin, id, yawDeg = 0) {
    const frame = makeFrame(origin.x, origin.y, origin.z ?? 0, 0, yawDeg);
    const bbox = { x0: Infinity, y0: Infinity, z0: Infinity, x1: -Infinity, y1: -Infinity, z1: -Infinity };
    const b = mesh.bbox;
    for (let i = 0; i < 8; i++) {
      localToWorld(frame, b[i & 1 ? 3 : 0], b[i & 2 ? 4 : 1], b[i & 4 ? 5 : 2], tmpW);
      bbox.x0 = Math.min(bbox.x0, tmpW.x); bbox.x1 = Math.max(bbox.x1, tmpW.x);
      bbox.y0 = Math.min(bbox.y0, tmpW.y); bbox.y1 = Math.max(bbox.y1, tmpW.y);
      bbox.z0 = Math.min(bbox.z0, tmpW.z); bbox.z1 = Math.max(bbox.z1, tmpW.z);
    }
    const placed = { id: id || `struct_${this.structures.length}`, kind: 'mesh', mesh,
      origin: { x: frame.x, y: frame.y, z: frame.z }, frame, bbox };
    this.structures.push(placed);
    this.renderVersion++;
    this.structVersion++;
    if (this.events) this.events.emit('world:structurePlaced', { id: placed.id, origin: placed.origin });
    return placed;
  }

  /** Authored `Frame` of a placed structure by id (`null` if unknown). */
  frameOf(id) {
    for (let i = 0; i < this.structures.length; i++) if (this.structures[i].id === id) return this.structures[i].frame;
    return null;
  }

  /** World (x, y) -> the placed structure's baked grid; see `gridLocal.js`. */
  static gridLocal(placed, x, y, out) { return gridLocal(placed, x, y, out); }

  /** Bbox test first (structures.length is tiny), then the level's own footprint. */
  structureAt(x, y) {
    for (let i = 0; i < this.structures.length; i++) {
      const s = this.structures[i];
      if (s.kind === 'mesh') continue;
      const b = s.bbox;
      if (x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1) return s;
    }
    return null;
  }

  sectorAt(x, y) {
    const s = this.structureAt(x, y);
    if (!s) return null;
    const g = gridLocal(s, x, y, this._grid);
    return s.level.sectorAt(g.x, g.y);
  }

  floorAt(x, y) {
    const s = this.structureAt(x, y);
    if (s) {
      const g = gridLocal(s, x, y, this._grid);
      const sec = s.level.sectorAt(g.x, g.y);
      return sec ? sec.floorH + g.z : null;
    }
    // US-026a (23.1 decision 2): the near band once it's ready, else analytic.
    return this.terrain ? this.terrain.groundAt(x, y) : null;
  }

  ceilAt(x, y) {
    const s = this.structureAt(x, y);
    if (s) {
      const g = gridLocal(s, x, y, this._grid);
      const sec = s.level.sectorAt(g.x, g.y);
      if (!sec) return null;
      return sec.ceilH === 'sky' ? 'sky' : sec.ceilH + g.z;
    }
    return 'sky';
  }

  /** Terrain only (ignores structures) - for the terrain caster (US-016). */
  heightAt(x, y) {
    return this.terrain ? this.terrain.heightAt(x, y) : null;
  }

  /**
   * (D-008) What `sectorAt` returning null means for movement: inside no
   * structure footprint, the terrain floor (walkable), or - with no terrain
   * at all - a solid wall (Level's own default, unchanged behaviour for
   * `?level=test_room`). Written into a REUSED scratch object - callers
   * must not keep it across calls.
   */
  outsideSector(x, y) {
    if (!this.terrain) return SOLID_OUTSIDE;
    const sc = this._outsideScratch;
    // US-026a (23.1 decision 2, 23.3): the near band once it's ready, else
    // analytic - physics (`isSectorPassable`/slope rule) and the renderer
    // read this same `groundAt`/`groundNormalAt`/`groundTypeAt` trio.
    sc.floorH = this.terrain.groundAt(x, y);
    sc.ceilH = 'sky';
    sc.solid = false;
    sc.wallMat = 'rock';
    sc.floorMat = this.terrain.floorMatFor(this.terrain.groundTypeAt(x, y));
    sc.ceilMat = 'sky';
    sc.topH = 'sky';
    sc.upperMat = 'rock';
    sc.terrain = true;
    const n = this.terrain.groundNormalAt(x, y, this._outsideNormalScratch);
    sc.nx = n.x; sc.ny = n.y; sc.nz = n.z;
    return sc;
  }

  // ---- mesh physics (ME-11a, 27.18) ------------------------------------------

  /** `moveCircleMesh` over `world.colliders` (empty on 'grid' - always a well-defined, if trivial, call). */
  collideCircle(x, y, dx, dy, radius, footZ, grounded, opts, out) {
    return moveCircleMesh(this.colliders, this.colliders.length, x, y, dx, dy, radius, footZ, grounded, opts, out);
  }

  /** `moveSphereMesh` over `world.colliders` (roller.js wiring is ME-11b - not called from here yet). */
  collideSphere(x, y, dx, dy, radius, z, opts, out) {
    return moveSphereMesh(this.colliders, this.colliders.length, x, y, dx, dy, radius, z, opts, out);
  }

  /**
   * `meshSupportSector(probeSupport(...), ...)` merged with the terrain
   * floor (same trio `outsideSector` reads: `groundAt`/`groundNormalAt`, or
   * NaN/0/0/0 with no terrain) - the mesh-mode twin of `sectorOrOutside`.
   * Written into a REUSED scratch object - callers must not keep it across
   * calls (same contract as `outsideSector`).
   *
   * Terrain is only consulted OUTSIDE a placed structure's footprint - same
   * rule `sectorAt`/`floorAt` already apply (`structureAt` gates the terrain
   * fallback there). A structure occludes the ground beneath it: world_m1's
   * terrain is baked under/around the tower for the outside hillside look
   * (US-026a/BUG-OWN-008, ME-11a's colliders.test.js finding), so inside the
   * tower's own bbox `terrain.groundAt` can legitimately return a height
   * ABOVE the tower's real interior floor (e.g. ~2.4m, the hillside/hilltop
   * legend cells' `floorH`) - feeding that into `meshSupportSector`'s
   * "terrain wins ties" rule would make the mesh floor probe's correct
   * interior answer get overridden by outside terrain, exactly the ME-11c
   * parity failure this guards against. Architect confirmed 2026-09-30 (27.18): a placed
   * structure occludes terrain across its bbox, same gate as sectorAt/floorAt.
   */
  supportAt(x, y, footZ, grounded, opts) {
    probeSupport(this.colliders, this.colliders.length, x, y, footZ, grounded, opts, this._meshSupportScratch);
    let terrainZ = NaN, tnx = 0, tny = 0, tnz = 0;
    if (this.terrain && !this.structureAt(x, y)) {
      terrainZ = this.terrain.groundAt(x, y);
      const n = this.terrain.groundNormalAt(x, y, this._meshTerrainNormalScratch);
      tnx = n.x; tny = n.y; tnz = n.z;
    }
    return meshSupportSector(this._meshSupportScratch, terrainZ, tnx, tny, tnz, this._meshSectorScratch);
  }

  // ---- water query (US-055a1, architecture.md 32.2) ---------------------------

  /**
   * Water at (x, y): highest-z region containing the point. Fills `out {surfaceZ, flatZ, depth, region, look}` and
   * returns true, or returns false (out untouched). `depth = surfaceZ - floorZ`, >= 0; floorZ = `supportAt(...).floorH`
   * in mesh physics, `floorAt` in grid (no floor there, FLOOR_NONE, NaN or null -> depth 0). `region` = the id
   * string, `index` = the region slot (valid only for the current load, not a save key), `look` = look index
   * (`world.water.lookNames[look]`). Pure, zero allocation.
   * US-143a (35.2): `surfaceZ = z + h` is now LIVE (the region's wave height at `world.water.tick`); `flatZ = z`
   * is the still-water plane (what `surfaceZ` was before this story). The floor probe still starts at `flatZ + 0.01`
   * (not `surfaceZ + 0.01`) - a crest must not push the probe above a floor it would otherwise have found.
   * Known grid limitation: grid `floorAt` has no z, so under a grid-sector bridge the depth is 0.
   * Do not hold a `supportAt` result across `waterAt`: mesh mode reuses the same scratch.
   * @param {number} x @param {number} y
   * @param {{surfaceZ:number,flatZ:number,depth:number,region:string,index:number,look:number}} out
   * @returns {boolean}
   */
  waterAt(x, y, out) {
    const wt = this.water;
    const i = wt.find(x, y);
    if (i < 0) return false;
    const z = wt.z[i];
    const h = waveHeight(wt, i, x, y, wt.tick);
    const surfaceZ = z + h;
    const fz = this.physicsMode === 'mesh' ? this.supportAt(x, y, z + 0.01, false, null).floorH : this.floorAt(x, y);
    const d = fz === fz && fz !== null && fz > FLOOR_NONE ? surfaceZ - fz : 0; // NaN / null / FLOOR_NONE floor = depth 0
    out.surfaceZ = surfaceZ;
    out.flatZ = z;
    out.depth = d > 0 ? d : 0;
    out.region = wt.ids[i];
    out.index = i;
    out.look = wt.look[i];
    return true;
  }

  /**
   * US-141a (architecture.md 35.1/35.4): the water flow (m/s) at (x, y) = the highest-z region's `flow` plus its radial part. Fills
   * `out[0], out[1]` and returns true; outside water `out = [0, 0]` and false. Pure, zero allocation.
   * @param {number} x @param {number} y @param {number[]|Float64Array} out
   * @returns {boolean}
   */
  flowAt(x, y, out) {
    const wt = this.water;
    const i = wt.find(x, y);
    if (i < 0) { out[0] = 0; out[1] = 0; return false; }
    wt.flowInto(i, x, y, out);
    return true;
  }

  // ---- ray / segment query (US-078b, architecture.md 30.1) -------------------

  /**
   * First blocked point on the segment a -> b. `out {t, x, y, z}`, t in 0..1.
   * mesh physics: nearest of `raycastColliders` and a terrain march
   * (`groundAt` every 0.1 m, <= 20 samples, then 6 bisections; terrain is
   * skipped inside a structure footprint, as `supportAt`). grid physics: the
   * `hasLineOfSight` sector sampling + the same bisection. Pure, zero alloc.
   * @param {number} ax @param {number} ay @param {number} az
   * @param {number} bx @param {number} by @param {number} bz
   * @param {{t:number,x:number,y:number,z:number}} out
   * @returns {boolean} true on a hit (out filled); out untouched on a miss
   */
  raySegment(ax, ay, az, bx, by, bz, out) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    let bestT = 2;
    if (len < 1e-9) return false;
    let steps = Math.ceil(len / RAY_STEP);
    if (steps > RAY_MAX_SAMPLES) steps = RAY_MAX_SAMPLES;
    const mesh = this.physicsMode === 'mesh';
    if (mesh && raycastColliders(this.colliders, this.colliders.length, ax, ay, az, dx, dy, dz, 1, _rayHit)) {
      bestT = _rayHit.t;
    }
    // March; in mesh mode only up to the collider hit (later samples cannot be nearer).
    let prevT = 0;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (prevT >= bestT) break;
      if (this._rayBlocked(mesh, ax + dx * t, ay + dy * t, az + dz * t)) {
        let lo = prevT, hi = t;
        for (let k = 0; k < RAY_BISECT; k++) {
          const m = 0.5 * (lo + hi);
          if (this._rayBlocked(mesh, ax + dx * m, ay + dy * m, az + dz * m)) hi = m; else lo = m;
        }
        if (hi < bestT) bestT = hi;
        break;
      }
      prevT = t;
    }
    if (bestT > 1) return false;
    out.t = bestT;
    out.x = ax + dx * bestT; out.y = ay + dy * bestT; out.z = az + dz * bestT;
    return true;
  }

  /** One raySegment sample: grid sector test, or (mesh) point below the terrain outside structures. */
  _rayBlocked(mesh, x, y, z) {
    if (!mesh) return pointBlocked(this, x, y, z);
    if (!this.terrain || this.structureAt(x, y)) return false;
    const g = this.terrain.groundAt(x, y);
    return g === g && z < g; // NaN-safe
  }

  /** `{s, ch, sector}` for the structure whose legend has a `dynamic` sector tagged `tag`, or null. Uses the tag Map (US-014). */
  _findDynamic(tag) {
    for (const s of this.structures) {
      if (s.kind === 'mesh') continue;
      const ch = s.tagMap && s.tagMap.get(tag);
      if (ch !== undefined) return { s, ch, sector: s.level.legend[ch] };
    }
    return null;
  }

  /**
   * Animates the tagged dynamic legend entry (every structure is searched;
   * a level-authored `dynamic: {ceilOpen, openTime, ease}` + `tag` pair, e.g.
   * the tower's grate) to `t01` (0 = closed/authored ceilH, 1 = `ceilOpen`),
   * rebuilds that structure's packed layout (not hot-path - an interaction,
   * not a per-frame call) and bumps `renderVersion`. Direct jump: used by
   * `World.load`/`deserialize` to restore a saved `t`, and by anything that
   * wants the sector at an exact position with no tween. Preserves an
   * existing `target`/`delay` on `structure.dynamics[tag]` (set by
   * `animateSectorTo`) if present, else defaults both to `t` (open/closed,
   * at rest - the shape old saves without those fields also load as).
   * @returns {boolean} false = no dynamic sector tagged `tag` anywhere.
   */
  animateSector(tag, t01) {
    const t = clamp01(t01);
    const hit = this._findDynamic(tag);
    if (!hit) return false;
    const { s, ch, sector } = hit;
    const d = sector.dynamic;
    sector.ceilH = sector.floorH + (d.ceilOpen - sector.floorH) * ease(d.ease, t);
    // Item 4 (architect review #1): update the changed cells in place
    // (bumps `packed.version`/`dirtyY0..1`) instead of reallocating a
    // fresh PackedLevel every call - this runs on every animation sim
    // step (the grate's open/close), not just once per interaction.
    updateAnimatedSector(s.packed, s.level, ch);
    // ME-11a (27.18): keeps a direct jump (interaction, `_restoreDynamics`)
    // in sync with `physicsMode === 'mesh'`. Needed in particular for
    // `serialize.js`'s `deserialize`, which calls `_restoreDynamics` AFTER
    // `World.load` returns (its own comment: "that field isn't part of
    // `def`" - so `World.load`'s inline restore-before-buildWorldColliders
    // ordering doesn't apply there) - a no-op before `world.colliders` has
    // this tag's collider yet (`structure._dynColliders` undefined,
    // `refitDynCollider` already guards that).
    if (this.physicsMode === 'mesh') refitDynCollider(this, s, tag);
    const prev = s.dynamics[tag];
    s.dynamics[tag] = { t, target: prev ? prev.target : t, delay: prev ? prev.delay : 0 };
    this.renderVersion++;
    if (this.events) this.events.emit('world:sectorAnimated', { structureId: s.id, tag, t01: t });
    return true;
  }

  /**
   * Starts (or retargets) a tween of the tagged dynamic sector toward
   * `target01`, after an optional `delay` (seconds). Does not move `t` or
   * touch the packed layout itself - `stepSectorAnims` does that, one sim
   * step at a time, so collision only ever sees committed steps (7.4 fixed
   * step order item 1). Current `t` (0 if the sector has never animated) is
   * kept as the tween's start.
   * @returns {boolean} false = no dynamic sector tagged `tag` anywhere.
   */
  animateSectorTo(tag, target01, { delay = 0 } = {}) {
    const hit = this._findDynamic(tag);
    if (!hit) return false;
    const { s } = hit;
    const cur = s.dynamics[tag];
    s.dynamics[tag] = { t: cur ? cur.t : 0, target: clamp01(target01), delay };
    return true;
  }

  /**
   * Re-applies a serialized `structure.dynamics[tag]` entry (US-014 tech
   * note 4/6): jumps the sector to `d.t` (rebuilds ceilH/packed via the
   * existing `animateSector`), then restores `target`/`delay` verbatim so a
   * save mid-open resumes exactly (missing `target`/`delay` on an older save
   * default to `d.t`/`0`, i.e. "at rest here" - old states still load).
   */
  _restoreDynamics(placed, tag, d) {
    if (placed.kind === 'mesh') return;
    if (typeof d.t !== 'number') return;
    const t = clamp01(d.t);
    this.animateSector(tag, t);
    const target = typeof d.target === 'number' ? clamp01(d.target) : t;
    const delay = typeof d.delay === 'number' ? d.delay : 0;
    placed.dynamics[tag] = { t, target, delay };
  }

  // ---- entities/handles (10.1) ----------------------------------------------

  spawn(type, transform, components = {}, id, parent = null) {
    const entId = id || `${type}_${this.nextId++}`;
    if (this._entities.has(entId)) throw new Error(`World.spawn: id "${entId}" already exists`);
    // US-041a (15.3 item 1): `voxel` is a component, not a type - same shape
    // as `sprite`, never both on one entity (an entity's animated look is
    // either a billboard or a voxel model, not both at once).
    if (components.sprite && components.voxel) {
      throw new Error(`World.spawn: entity "${entId}" has both "sprite" and "voxel" components - pick one`);
    }
    if (components.sprite) {
      // (US-011 arch review) no `loop` default: `stepAnimations` falls back to the clip's own flag.
      components.sprite = { t: 0, frame: 0, speed: 1, playing: true, ...components.sprite };
    }
    if (components.voxel) {
      components.voxel = { t: 0, frame: 0, speed: 1, playing: true, ...components.voxel };
    }
    const entity = Entity.create(type, transform, components, entId, parent);
    this._entities.set(entId, entity);
    this.renderVersion++;
    if (this.events) this.events.emit('entity:added', { id: entId, type });
    return this._handleFor(entId);
  }

  /** @returns {EntityHandle|null} the same handle object for a given id, until removed */
  get(id) {
    return this._entities.has(id) ? this._handleFor(id) : null;
  }

  remove(id) {
    // Item 5b (architect review #1): an unknown id must be a no-op, not
    // create-then-immediately-remove a handle (which used to emit a spurious
    // `entity:removed`).
    if (!this._entities.has(id)) return;
    // US-027a (21.8): removing a content id records it so a later
    // deserialize (or this same save's `serialize`) knows it stays removed.
    if (this._contentIds.has(id)) this._removedContent.add(id);
    const h = this._handleFor(id);
    h.remove();
  }

  entity(id) {
    return this._entities.get(id);
  }

  addEntity(e) {
    this._entities.set(e.id, e);
    this.renderVersion++;
  }

  removeEntity(id) {
    this._entities.delete(id);
    this._handles.delete(id);
    this._listeners.delete(id);
    this.renderVersion++;
  }

  /**
   * Allocation-free iteration over live entities (ARCH CHANGES, US-030c):
   * `fn(entity, id)` for every entity currently in the world. Public
   * replacement for reading `world._entities` directly (e.g. `SpritePool.collect`).
   */
  forEachEntity(fn) {
    for (const [id, e] of this._entities) fn(e, id);
  }

  _handleFor(id) {
    let h = this._handles.get(id);
    if (!h) {
      h = new EntityHandle(this, id);
      this._handles.set(id, h);
    }
    return h;
  }

  _addListener(id, event, fn) {
    let forId = this._listeners.get(id);
    if (!forId) { forId = new Map(); this._listeners.set(id, forId); }
    let set = forId.get(event);
    if (!set) { set = new Set(); forId.set(event, set); }
    set.add(fn);
  }

  _removeListener(id, event, fn) {
    const forId = this._listeners.get(id);
    if (!forId) return;
    const set = forId.get(event);
    if (set) set.delete(fn);
  }

  /** Queues an event for the next `flushEvents()` (safe re-entrancy - 10.1). */
  _emit(id, event, arg) {
    if (!this._eventRing.push(id, event, arg)) this.eventsDropped = this._eventRing.dropped;
  }

  /** Drains the event ring, dispatching to per-entity listeners (`handle.on`). Called by the loop after each sim step. */
  flushEvents() {
    this._eventRing.drain(this._dispatchEvent);
    this.eventsDropped = this._eventRing.dropped;
  }

  /**
   * `remove()`'s real implementation: `removed` fires SYNCHRONOUSLY (not
   * through the ring) so listeners registered before the removal always see
   * it, THEN listeners/cache are dropped and `entity:removed` fires on the
   * engine's events (10.1 order).
   */
  _removeEntityAndHandle(id, handle) {
    const forId = this._listeners.get(id);
    if (forId) {
      const set = forId.get('removed');
      if (set) for (const fn of Array.from(set)) fn(handle, 'removed', undefined);
    }
    this._entities.delete(id);
    this._listeners.delete(id);
    this._handles.delete(id);
    handle.alive = false;
    this.renderVersion++;
    if (this.events) this.events.emit('entity:removed', { id });
  }

  /** Look up (by name, via `def.interactables`/`def.triggers`) and call a registered behaviour (D-006/D-008). */
  fireInteraction(id, ctx) {
    const fn = getBehaviour(id);
    return fn ? fn({ world: this, frame: this._ctxFrame(ctx), ...ctx }) : undefined;
  }

  fireTrigger(id, ctx) {
    const fn = getBehaviour(id);
    return fn ? fn({ world: this, frame: this._ctxFrame(ctx), ...ctx }) : undefined;
  }

  /** `ctx.frame` for behaviours (coordinates.md 4): the structure's frame, `null` = def positions are already world. */
  _ctxFrame(ctx) {
    return ctx && ctx.structId != null ? this.frameOf(ctx.structId) : null;
  }
}

/**
 * Fixed-step order item 1 (7.4, US-014): advances every `structure.dynamics`
 * entry whose `t !== target` toward `target`, at most one tween step each
 * per call - delay is consumed first (no movement while `delay > 0`), then
 * `t` moves by `dtSec / dynamic.openTime` along the ease curve, clamped so
 * it lands exactly on `target`. Rebuilds the sector's ceilH/packed in place
 * (`updateAnimatedSector`, no per-step allocation) and emits
 * `'world:sectorAnimated'` every moving step, `'world:sectorAnimDone'` once
 * on arrival. `for...in` over the plain `dynamics` object and `for...of`
 * over the (tiny, <= 8) structures array: no array allocation (rule 9).
 * @param {World} world
 * @param {number} dtSec
 */
export function stepSectorAnims(world, dtSec) {
  for (const s of world.structures) {
    if (s.kind === 'mesh') continue;
    if (!s.tagMap || s.tagMap.size === 0) continue;
    for (const tag in s.dynamics) {
      const d = s.dynamics[tag];
      if (d.t === d.target) continue;
      // Consume delay first (7.4): if the WHOLE step fits inside the
      // remaining delay, spend it all there and move nothing. Otherwise
      // spend only the leftover delay, then use the REST of dtSec to move
      // `t` this same step - not "wait one more whole step" - so a delay
      // that is an exact multiple of dtSec (e.g. 0.4 s = 24 steps @ 60 Hz)
      // still hands the following movement its full dt, instead of losing
      // one step to a delay residual left over from float subtraction
      // (0.4 - 24*(1/60) is not exactly 0 in IEEE 754).
      let dt = dtSec;
      if (d.delay > 0) {
        if (d.delay >= dt) { d.delay -= dt; continue; }
        dt -= d.delay;
        d.delay = 0;
      }
      const ch = s.tagMap.get(tag);
      if (ch === undefined) continue;
      const sector = s.level.legend[ch];
      const dyn = sector.dynamic;
      const openTime = (dyn && dyn.openTime) || 1;
      const dir = d.target > d.t ? 1 : -1;
      let t = d.t + dir * (dt / openTime);
      // Epsilon-guarded clamp (mirrors capsule.js's SKIN): float summation
      // of ~90 unequal increments (a leftover first step, then full dt
      // steps) can land a few ulps short of `target` instead of exactly on
      // it - without this, the LAST step (which should land exactly on
      // target, per the fixed step count in 7.4/US-014's own numbers) needs
      // one extra call to clamp.
      if ((dir > 0 && t >= d.target - 1e-9) || (dir < 0 && t <= d.target + 1e-9)) t = d.target;

      sector.ceilH = sector.floorH + (dyn.ceilOpen - sector.floorH) * ease(dyn.ease, t);
      updateAnimatedSector(s.packed, s.level, ch);
      if (world.physicsMode === 'mesh') refitDynCollider(world, s, tag);
      d.t = t;
      world.renderVersion++;
      if (world.events) world.events.emit('world:sectorAnimated', { structureId: s.id, tag, t01: t });
      if (t === d.target && world.events) world.events.emit('world:sectorAnimDone', { structureId: s.id, tag, t01: t });
    }
  }
}
