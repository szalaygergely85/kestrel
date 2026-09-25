// engine/world/triggers.js (US-017, D-006/D-008). Generic trigger-zone
// mechanism, mirroring engine/world/interaction.js's split: the engine only
// knows `world.triggers` (built by `World.load` from every placed
// structure's `def.triggers`) and named behaviours (`engine/core/
// behaviours.js`) - it has no idea what "the end" or "a hint" is. Normative
// API: docs/architecture.md 7.4 (Triggers).
//
// Allocation rule (9): `updateTriggers` runs every fixed step (7.4 order
// item 4) and must not allocate. `TriggerRec.usedKey`/`mask` are built once
// in `buildTriggers` (called from `World.load`), never in the hot loop.

/**
 * @typedef {{key:string, structId:string|null, id:string, name:string, once:boolean,
 *   shape:'cells'|'circle'|'terrain'|'bounds', mask:Uint8Array|null, x:number, y:number, r:number,
 *   zMin:number, def:Object, inside:number, usedKey:string|null,
 *   levelW:number, levelH:number}} TriggerRec
 */

const warnedMismatch = new Set();

// US-026a (architecture.md 23.2/23.5): world-level trigger shapes, on top
// of the per-structure 'circle'/'cells' above. `structId: null`, absolute
// world coordinates (no structure origin to add).
const WORLD_TRIGGER_SHAPES = new Set(['circle', 'terrain', 'bounds']);

/**
 * `world.def.triggers` -> `TriggerRec[]` (structId: null, key `world.<id>`).
 * Validates ids (unique) and shapes (known) up front - throws WITH the
 * offending id, same convention as `validateHorizon` (World.js). Called
 * once from `buildTriggers` (not per step - rule 9).
 * @param {import('./World.js').World} world
 * @returns {TriggerRec[]}
 */
function buildWorldTriggers(world) {
  const defs = (world.def && world.def.triggers) || [];
  const seen = new Set();
  const out = [];
  for (const tr of defs) {
    const id = tr && tr.id;
    if (!id || typeof id !== 'string') throw new Error('buildTriggers: world trigger entry needs a string "id"');
    if (seen.has(id)) throw new Error(`buildTriggers: world trigger "${id}": duplicate id`);
    seen.add(id);
    if (!WORLD_TRIGGER_SHAPES.has(tr.shape)) {
      throw new Error(`buildTriggers: world trigger "${id}": unknown shape "${tr.shape}"`);
    }
    out.push({
      key: `world.${id}`,
      structId: null,
      id,
      name: tr.trigger,
      once: !!tr.once,
      shape: tr.shape,
      mask: null,
      x: typeof tr.x === 'number' ? tr.x : 0,
      y: typeof tr.y === 'number' ? tr.y : 0,
      r: typeof tr.r === 'number' ? tr.r : 0,
      zMin: typeof tr.zMin === 'number' ? tr.zMin : -Infinity,
      def: tr,
      inside: 0,
      usedKey: tr.once ? `used.world.${id}` : null,
      levelW: 0,
      levelH: 0,
    });
  }
  return out;
}

/**
 * Every placed structure's `def.triggers` -> `TriggerRec[]`, world coords
 * (level x,y + origin for a circle trigger; a cell trigger's mask stays
 * level-local, tested against `actor - origin`), plus `world.def.triggers`
 * (world-level, `structId: null` - see `buildWorldTriggers` above). Called
 * once from `World.load` (not per step - rule 9).
 * @param {import('./World.js').World} world
 * @returns {TriggerRec[]}
 */
export function buildTriggers(world) {
  const out = [];
  for (const s of world.structures) {
    const def = s.level.def;
    for (const tr of (def && def.triggers) || []) {
      const usedKey = tr.once ? `used.${s.id}.${tr.id}` : null;
      if (tr.shape === 'circle') {
        out.push({
          key: `${s.id}.${tr.id}`,
          structId: s.id,
          id: tr.id,
          name: tr.trigger,
          once: !!tr.once,
          shape: 'circle',
          mask: null,
          x: tr.x + s.origin.x,
          y: tr.y + s.origin.y,
          r: tr.r,
          zMin: typeof tr.zMin === 'number' ? tr.zMin + s.origin.z : -Infinity,
          def: tr,
          inside: 0,
          usedKey,
          levelW: s.level.width,
          levelH: s.level.height,
        });
        continue;
      }

      // Cell trigger (default): every cell whose legend `tag === 'trigger:'
      // + id`, unioned with `def.cells` (a mismatch between the two is
      // warned once, per key - the level data and the tag should agree).
      const w = s.level.width, h = s.level.height;
      const mask = new Uint8Array(w * h);
      const tagName = `trigger:${tr.id}`;
      let tagCount = 0;
      for (let row = 0; row < h; row++) {
        for (let col = 0; col < w; col++) {
          const ch = s.level.rows[row][col];
          const sector = s.level.legend[ch];
          if (sector && sector.tag === tagName) {
            mask[row * w + col] = 1;
            tagCount++;
          }
        }
      }
      const defCells = tr.cells || [];
      let cellCount = 0;
      for (const c of defCells) {
        const col = c[0], row = c[1];
        if (col < 0 || col >= w || row < 0 || row >= h) continue;
        if (!mask[row * w + col]) cellCount++;
        mask[row * w + col] = 1;
      }
      const mismatchKey = `${s.id}.${tr.id}`;
      if (tagCount > 0 && defCells.length > 0 && (cellCount > 0 || tagCount !== defCells.length) && !warnedMismatch.has(mismatchKey)) {
        warnedMismatch.add(mismatchKey);
        console.warn(`[triggers] "${mismatchKey}": tag "${tagName}" cells (${tagCount}) differ from def.cells (${defCells.length}) - using the union`);
      }

      out.push({
        key: `${s.id}.${tr.id}`,
        structId: s.id,
        id: tr.id,
        name: tr.trigger,
        once: !!tr.once,
        shape: 'cells',
        mask,
        x: s.origin.x,
        y: s.origin.y,
        r: 0,
        zMin: -Infinity,
        def: tr,
        inside: 0,
        usedKey,
        levelW: w,
        levelH: h,
      });
    }
  }
  out.push(...buildWorldTriggers(world));
  return out;
}

/**
 * Is `actor` (feet at `ax, ay, az`) inside this trigger right now? Pure,
 * no allocation.
 * @param {TriggerRec} rec
 * @param {import('./World.js').World} world
 * @param {Object} actor - the entity data passed to `updateTriggers` (needs `.components.body.radius` for `'bounds'`).
 */
function isInside(rec, world, ax, ay, az, actor) {
  if (rec.shape === 'circle') {
    const dx = ax - rec.x, dy = ay - rec.y;
    return (dx * dx + dy * dy <= rec.r * rec.r) && az >= rec.zMin;
  }
  // US-026a (23.5): 'terrain' - first contact with the terrain floor (inside
  // no structure footprint, and the world actually has terrain).
  if (rec.shape === 'terrain') {
    return !!(world.terrain && world.structureAt(ax, ay) === null);
  }
  // US-026a (23.3/23.5): 'bounds' - the capsule has reached (or the bound
  // shrank inside) the walk-bound circle, same edge `integrate` step 4b
  // slides against (`r - radius - 0.05`, a hair before the hard clip so the
  // hint fires on first touch, not after the slide already clipped it).
  if (rec.shape === 'bounds') {
    if (!world.bounds) return false;
    const dx = ax - world.bounds.x, dy = ay - world.bounds.y;
    const radius = (actor && actor.components && actor.components.body && actor.components.body.radius) || 0;
    return Math.hypot(dx, dy) >= world.bounds.r - radius - 0.05;
  }
  // 'cells' (default, structure-local)
  const lx = Math.floor(ax - rec.x), ly = Math.floor(ay - rec.y);
  if (lx < 0 || lx >= rec.levelW || ly < 0 || ly >= rec.levelH) return false;
  return rec.mask[ly * rec.levelW + lx] === 1;
}

/**
 * (7.4 fixed-step order item 4) actor feet -> structure-local cell (or
 * circle + `z >= zMin`); an enter edge (`inside` 0 -> 1) fires the named
 * behaviour (`world.fireTrigger(rec.name, {engine, def, entity: actor,
 * structId})`), sets the used flag (used flags rule, 7.4: only when the
 * behaviour returns anything but `false`) and emits `'trigger:fired'`
 * `{key, name}`. `inside` is runtime only (rebuilt by `buildTriggers`): a
 * `World.load`/`deserialize` right after the actor was already standing
 * inside counts as a fresh enter on the very next call, so a used trigger
 * (already-set flag) never refires and an unused one fires exactly once,
 * whether the player walked in or is restored inside it.
 * @param {import('./World.js').World} world
 * @param {import('../core/engine.js').Engine} engine
 * @param {{transform:{x:number,y:number,z:number}}} actor
 */
export function updateTriggers(world, engine, actor) {
  const list = world.triggers;
  const t = actor.transform;
  for (let i = 0; i < list.length; i++) {
    const rec = list[i];
    const cur = isInside(rec, world, t.x, t.y, t.z, actor) ? 1 : 0;
    const entered = rec.inside === 0 && cur === 1;
    rec.inside = cur;
    if (!entered) continue;
    if (rec.usedKey && world.state[rec.usedKey]) continue;

    const result = world.fireTrigger(rec.name, { engine, def: rec.def, entity: actor, structId: rec.structId });
    if (result !== false && rec.usedKey) world.state[rec.usedKey] = true;
    if (world.events) world.events.emit('trigger:fired', { key: rec.key, name: rec.name });
  }
}
