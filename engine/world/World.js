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

// Default answer for `World#outsideSector` when the world has no terrain at
// all (`def.terrain` is null - `?level=test_room`'s ephemeral world): a
// solid wall, matching `Level`'s own `outsideSector` default (D-008), so a
// terrain-less world behaves exactly like today's bare `Level`.
const SOLID_OUTSIDE = Object.freeze({
  floorH: 3, ceilH: 'sky', wallMat: 'stone', floorMat: 'floor', ceilMat: 'sky',
  solid: true, topH: 'sky', upperMat: 'stone',
});

function clamp01(t) { return t < 0 ? 0 : t > 1 ? 1 : t; }
function ease(kind, t) {
  if (kind === 'inOut') return t * t * (3 - 2 * t); // smoothstep
  return t; // linear (default)
}

// (US-016b) `ringHAt(x, y)`: nearest outer-ring `floorH` of a placed
// structure, wired into `recipe.structures[i]` before the terrain bakes, so
// `structureBlend` in the recipe blends against the REAL level data instead
// of the flat `ringH` fallback constant.
function makeRingHAt(level, origin) {
  const w = level.width, h = level.height;
  return function ringHAt(x, y) {
    const lx = x - origin.x, ly = y - origin.y;
    let cx = Math.min(Math.max(lx, 0.5), w - 0.5);
    let cy = Math.min(Math.max(ly, 0.5), h - 0.5);
    const dl = cx, dr = w - cx, dt = cy, db = h - cy;
    const m = Math.min(dl, dr, dt, db);
    if (m === dl) cx = 0.5; else if (m === dr) cx = w - 0.5;
    if (m === dt) cy = 0.5; else if (m === db) cy = h - 0.5;
    const s = level.sectorAt(cx, cy);
    return s ? s.floorH + origin.z : origin.z;
  };
}

export class World {
  constructor() {
    this.terrain = null;
    this.terrainKey = null;
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
    this.events = null;
    // (US-012) Built by `load()` from every placed structure's
    // `def.interactables`; a bare `new World()` (no `load`) gets an empty
    // list rather than `undefined`, so `findInteractTarget` never needs a
    // null check on the hot path.
    this.interactables = [];
    this.interaction = { targetKey: null, prompt: '', dist: 0, angleDeg: 0 };

    this._entities = new Map();   // id -> plain entity data
    this._handles = new Map();    // id -> EntityHandle (cached, same object until remove)
    this._listeners = new Map();  // id -> Map<event, Set<fn>>
    this._eventRing = new EventRing(256);
    this._outsideScratch = { floorH: 0, ceilH: 'sky', wallMat: 'rock', floorMat: 'grass', ceilMat: 'sky', solid: false, topH: 'sky', upperMat: 'rock' };
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
   * @param {{events?: import('../core/events.js').Events}} [opts]
   * @returns {World}
   */
  static load(def, assets, opts = {}) {
    const w = new World();
    w.events = opts.events || null;
    w.def = def;
    w.state = structuredClone(def.state || {});

    if (def.terrain) {
      w.terrainKey = def.terrain;
      w.terrain = new Terrain(assets.terrain(def.terrain));
    }

    for (const s of def.structures || []) {
      const placed = w.placeStructure(assets.level(s.level), s.origin, s.id, s.yawSteps || 0);
      if (s.dynamics) {
        for (const tag of Object.keys(s.dynamics)) {
          w._restoreDynamics(placed, tag, s.dynamics[tag]);
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
      const def = s.level.def;
      for (const it of (def && def.interactables) || []) {
        w.interactables.push({
          key: `${s.id}.${it.id}`,
          structId: s.id,
          id: it.id,
          name: it.interact,
          x: it.x + s.origin.x,
          y: it.y + s.origin.y,
          z: it.z + s.origin.z,
          radius: it.radius,
          prompt: it.prompt,
          once: !!it.once,
          requires: it.requires || null,
          propId: it.prop ? `${s.id}.${it.prop}` : null,
          def: it,
          usedKey: it.once ? `used.${s.id}.${it.id}` : null,
        });
      }
    }
    w.interaction = { targetKey: null, prompt: '', dist: 0, angleDeg: 0 }; // reused (rule 9)

    // (US-016b) Wire each placed structure's real ring height into the
    // terrain recipe's own `structures[i]` entry (matched by id), BEFORE any
    // bake/sample happens - `structureBlend` inside the recipe then reads
    // real level data instead of its flat `ringH` fallback.
    if (w.terrain && w.terrain.recipe.structures) {
      for (const rs of w.terrain.recipe.structures) {
        const placed = w.structures.find((p) => p.id === rs.id);
        if (placed) rs.ringHAt = makeRingHAt(placed.level, placed.origin);
      }
    }

    for (const ed of def.entities || []) {
      let transform;
      if (ed.transform) {
        transform = { ...ed.transform };
      } else if (typeof ed.x === 'number' && typeof ed.y === 'number') {
        // Inline world position (architecture.md 14.4 item 7 shape, e.g. the
        // `farTower` billboard in world_m1.js): a transform shorthand.
        transform = { x: ed.x, y: ed.y, z: typeof ed.z === 'number' ? ed.z : 0, yawDeg: ed.yawDeg || 0, pitchDeg: ed.pitchDeg || 0 };
      } else if (ed.spawn) {
        const st = w.structures.find((s) => s.id === ed.spawn.structure);
        if (!st) throw new Error(`World.load: entity "${ed.id}" spawn.structure "${ed.spawn.structure}" not placed`);
        const local = ed.spawn.from === 'start' ? st.level.start : null;
        if (!local) throw new Error(`World.load: entity "${ed.id}" spawn.from "${ed.spawn.from}" not supported`);
        transform = {
          x: local.x + st.origin.x, y: local.y + st.origin.y,
          z: (st.level.floorAt(local.x, local.y) ?? 0) + st.origin.z,
          yawDeg: local.facingDeg || 0, pitchDeg: local.pitchDeg || 0,
        };
      } else {
        throw new Error(`World.load: entity "${ed.id}" needs "transform" or "spawn"`);
      }
      w.spawn(ed.type, transform, structuredClone(ed.components || {}), ed.id);
    }

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
    const structSeq = this.structures.length;
    const structId = id || `struct_${structSeq}`;
    const bbox = { x0: origin.x, y0: origin.y, x1: origin.x + level.width, y1: origin.y + level.height };
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
    const placed = { id: structId, level, origin: { x: origin.x, y: origin.y, z: origin.z || 0 }, yawSteps, bbox, packed, structSeq, dynamics: {}, tagMap };
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

  /** Bbox test first (structures.length is tiny), then the level's own footprint. */
  structureAt(x, y) {
    for (let i = 0; i < this.structures.length; i++) {
      const s = this.structures[i];
      const b = s.bbox;
      if (x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1) return s;
    }
    return null;
  }

  sectorAt(x, y) {
    const s = this.structureAt(x, y);
    if (!s) return null;
    return s.level.sectorAt(x - s.origin.x, y - s.origin.y);
  }

  floorAt(x, y) {
    const s = this.structureAt(x, y);
    if (s) {
      const sec = s.level.sectorAt(x - s.origin.x, y - s.origin.y);
      return sec ? sec.floorH + s.origin.z : null;
    }
    return this.terrain ? this.terrain.heightAt(x, y) : null;
  }

  ceilAt(x, y) {
    const s = this.structureAt(x, y);
    if (s) {
      const sec = s.level.sectorAt(x - s.origin.x, y - s.origin.y);
      if (!sec) return null;
      return sec.ceilH === 'sky' ? 'sky' : sec.ceilH + s.origin.z;
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
    sc.floorH = this.terrain.heightAt(x, y);
    sc.ceilH = 'sky';
    sc.solid = false;
    sc.wallMat = 'rock';
    sc.floorMat = this.terrain.floorMatFor(this.terrain.typeAt(x, y));
    sc.ceilMat = 'sky';
    sc.topH = 'sky';
    sc.upperMat = 'rock';
    return sc;
  }

  /** `{s, ch, sector}` for the structure whose legend has a `dynamic` sector tagged `tag`, or null. Uses the tag Map (US-014). */
  _findDynamic(tag) {
    for (const s of this.structures) {
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
    if (typeof d.t !== 'number') return;
    const t = clamp01(d.t);
    this.animateSector(tag, t);
    const target = typeof d.target === 'number' ? clamp01(d.target) : t;
    const delay = typeof d.delay === 'number' ? d.delay : 0;
    placed.dynamics[tag] = { t, target, delay };
  }

  // ---- entities/handles (10.1) ----------------------------------------------

  spawn(type, transform, components = {}, id) {
    const entId = id || `${type}_${this.nextId++}`;
    if (this._entities.has(entId)) throw new Error(`World.spawn: id "${entId}" already exists`);
    if (components.sprite) {
      components.sprite = { t: 0, frame: 0, loop: true, speed: 1, playing: true, ...components.sprite };
    }
    const entity = Entity.create(type, transform, components, entId);
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
    return fn ? fn({ world: this, ...ctx }) : undefined;
  }

  fireTrigger(id, ctx) {
    const fn = getBehaviour(id);
    return fn ? fn({ world: this, ...ctx }) : undefined;
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
      d.t = t;
      world.renderVersion++;
      if (world.events) world.events.emit('world:sectorAnimated', { structureId: s.id, tag, t01: t });
      if (t === d.target && world.events) world.events.emit('world:sectorAnimDone', { structureId: s.id, tag, t01: t });
    }
  }
}
