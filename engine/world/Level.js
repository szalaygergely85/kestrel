// game/js/world/Level.js
//
// Sector map format + loader (US-003 v2). See game/js/world/MAP_FORMAT.md for
// the full authoring spec. Summary:
//
//   A level is a plain data object { name, legend, rows, start?, layers?, ...anything }.
//   `rows` is a rectangular array of equal-length strings: one character per
//   cell, one row per line, top-down. `legend` maps each character to a
//   *sector definition*: { floorH, ceilH, wallMat, floorMat, ceilMat, solid,
//   topH?, upperMat? }, plus any number of unknown/extension fields (zone,
//   tag, desc, dynamic, ...) that pass through untouched.
//
//   1 cell = 1 world meter; cell (col, row) occupies world space
//   [col, col+1) x [row, row+1). col grows EAST (+x), row grows SOUTH (+y).
//   `facingDeg` is COMPASS degrees: 0 = north (-y), 90 = east (+x), clockwise
//   - the same convention as the palette sun azimuth.
//
// loadLevel(def) validates the raw data and returns a Level instance with
// the query API (sectorAt/floorAt/ceilAt) used by the raycaster (US-004),
// physics (US-008) and everything downstream. On a validation error it
// prints details (row/column, or legend character) to the console and
// returns null - callers must check for that.

/**
 * @typedef {Object} Sector
 * @property {number} floorH - floor height in meters. On a `solid` cell this
 *   is the height of the WALL TOP (see "Solid cells" below), not a floor you
 *   can stand on.
 * @property {number|'sky'} ceilH - ceiling height in meters, or 'sky' for an
 *   open/roofless cell (ignored on solid cells - they render as a column up
 *   to floorH regardless).
 * @property {string} wallMat - material key (design/palette.js `materials`),
 *   used for wall faces and (as the default) the upper face above ceilH.
 * @property {string} floorMat - material key. Also the material of a solid
 *   cell's TOP FACE (the flat cap you see looking down on a broken wall).
 * @property {string} ceilMat - material key, or 'sky' exactly when
 *   ceilH === 'sky'.
 * @property {boolean} solid - true if this cell blocks movement, AT ANY
 *   HEIGHT (a full-height collider), regardless of floorH. For rendering it
 *   is a column with a floorMat-textured top face at floorH; rays continue
 *   past it above that height (so you can see over a low wall or a broken
 *   parapet against the sky).
 * @property {number|'sky'} [topH] - height where the overhead mass above
 *   ceilH ends (a lintel/doorway's stone, a grate's frame). Only meaningful
 *   when ceilH is a number. Defaults to ceilH (a zero-thickness slab) when
 *   omitted, so a level that never sets it behaves exactly as MAP_FORMAT v1.
 * @property {string} [upperMat] - material of the face between ceilH and
 *   topH (grate bars, stone lintel). Defaults to wallMat when omitted.
 */

const START_FIELDS = ['facingDeg', 'pitchDeg', 'eyeH', 'pose'];
const START_DEFAULTS = { facingDeg: 0, pitchDeg: 0, eyeH: 1.6, pose: 'standing' };

// Default answer for Level#outsideSector (D-008) - a solid wall, so a
// fully-enclosed level (test_room, the tower) blocks movement past its own
// border without physics ever special-casing "no sector = wall" itself.
const OUTSIDE_SECTOR = Object.freeze({
  floorH: 3, ceilH: 'sky', wallMat: 'stone', floorMat: 'floor', ceilMat: 'sky',
  solid: true, topH: 'sky', upperMat: 'stone',
});

/**
 * Load and validate a raw level definition into a queryable Level.
 * @param {Object} def - { name, legend, rows, start?, layers?, ... }. Any
 *   field besides name/legend/rows/start is passed through unread as
 *   `level.def` for later stories (props, lights, triggers, markers, sun,
 *   route, layers, ...).
 * @returns {Level|null} null if validation failed (errors are logged to console.error).
 */
export function loadLevel(def) {
  const name = (def && def.name) || '(unnamed level)';
  const tag = `[Level ${name}]`;
  const errors = [];

  if (!def || typeof def !== 'object') {
    console.error(`${tag} level definition is missing or not an object.`);
    return null;
  }
  const { legend, rows } = def;

  if (!legend || typeof legend !== 'object') {
    errors.push(`${tag} missing "legend" object.`);
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    errors.push(`${tag} missing or empty "rows" array.`);
  }

  if (errors.length) {
    errors.forEach((e) => console.error(e));
    return null;
  }

  // 1. Rectangular grid.
  const height = rows.length;
  const width = rows[0].length;
  for (let row = 0; row < height; row++) {
    if (typeof rows[row] !== 'string') {
      errors.push(`${tag} row ${row} is not a string.`);
    } else if (rows[row].length !== width) {
      errors.push(
        `${tag} row ${row} has length ${rows[row].length}, expected ${width} ` +
        `(row 0's length) - grid must be rectangular.`
      );
    }
  }

  // 2. Per-legend-char field validation + defaulting (topH/upperMat), so
  //    every consumer sees a fully-resolved Sector regardless of what the
  //    author actually wrote. Built once, reused by every cell using that
  //    character.
  const resolvedLegend = {};
  if (legend) {
    for (const ch of Object.keys(legend)) {
      const raw = legend[ch];
      const errTag = `${tag} legend '${ch}'`;
      if (!raw || typeof raw !== 'object') {
        errors.push(`${errTag}: not an object.`);
        continue;
      }

      const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v);

      if (!isFiniteNum(raw.floorH)) {
        errors.push(`${errTag}: floorH must be a finite number, got ${JSON.stringify(raw.floorH)}.`);
      }
      const ceilIsSky = raw.ceilH === 'sky';
      if (!ceilIsSky && !isFiniteNum(raw.ceilH)) {
        errors.push(`${errTag}: ceilH must be a finite number or 'sky', got ${JSON.stringify(raw.ceilH)}.`);
      }
      if (typeof raw.solid !== 'boolean') {
        errors.push(`${errTag}: solid must be a boolean, got ${JSON.stringify(raw.solid)}.`);
      }
      if (typeof raw.wallMat !== 'string' || raw.wallMat === '') {
        errors.push(`${errTag}: wallMat must be a non-empty string.`);
      }
      if (typeof raw.floorMat !== 'string' || raw.floorMat === '') {
        errors.push(`${errTag}: floorMat must be a non-empty string.`);
      }
      if (typeof raw.ceilMat !== 'string' || raw.ceilMat === '') {
        errors.push(`${errTag}: ceilMat must be a non-empty string.`);
      } else if (ceilIsSky && raw.ceilMat !== 'sky') {
        errors.push(`${errTag}: ceilH is 'sky' so ceilMat must be exactly 'sky', got '${raw.ceilMat}'.`);
      } else if (!ceilIsSky && raw.ceilMat === 'sky') {
        errors.push(`${errTag}: ceilMat is 'sky' but ceilH is not - ceilMat 'sky' is only valid when ceilH is 'sky'.`);
      }
      if (!raw.solid && isFiniteNum(raw.floorH) && !ceilIsSky && isFiniteNum(raw.ceilH) && raw.ceilH < raw.floorH) {
        errors.push(`${errTag}: ceilH (${raw.ceilH}) must be >= floorH (${raw.floorH}) on a non-solid cell (equal is allowed, e.g. a closed grate).`);
      }

      // Defaults: topH -> ceilH (zero-thickness slab), upperMat -> wallMat.
      resolvedLegend[ch] = {
        ...raw,
        topH: raw.topH !== undefined ? raw.topH : raw.ceilH,
        upperMat: raw.upperMat !== undefined ? raw.upperMat : raw.wallMat,
      };
    }
  }

  // 3. Every char used in the grid is in the legend. Also collect declared
  //    start markers (legend entries flagged start: true).
  const startMarkers = []; // { x, y, facingDeg, pitchDeg, eyeH, pose }
  if (legend) {
    for (let row = 0; row < height; row++) {
      const line = rows[row];
      if (typeof line !== 'string') continue;
      for (let col = 0; col < line.length; col++) {
        const ch = line[col];
        const sector = resolvedLegend[ch];
        if (!sector) {
          if (legend[ch] === undefined) {
            errors.push(`${tag} unknown legend character '${ch}' at row ${row}, col ${col}.`);
          }
          // else: char exists but its legend entry was already rejected above
          // (invalid fields) - already reported, don't double-report per cell.
          continue;
        }
        if (sector.start) {
          const marker = { x: col + 0.5, y: row + 0.5 };
          for (const f of START_FIELDS) {
            marker[f] = typeof sector[f] === 'number' || typeof sector[f] === 'string' ? sector[f] : START_DEFAULTS[f];
          }
          startMarkers.push(marker);
        }
      }
    }
  }

  // 4. Player start defined (v2 shape: { x, y, facingDeg, pitchDeg?, eyeH?, pose? }):
  //    either an explicit def.start, or exactly one legend-flagged start marker.
  let start = null;
  if (def.start && typeof def.start.x === 'number' && typeof def.start.y === 'number') {
    start = { x: def.start.x, y: def.start.y };
    for (const f of START_FIELDS) {
      const v = def.start[f];
      start[f] = (typeof v === 'number' || typeof v === 'string') ? v : START_DEFAULTS[f];
    }
    if (startMarkers.length) {
      errors.push(
        `${tag} both an explicit "start" and ${startMarkers.length} legend start marker(s) ` +
        `are present; remove one. Legend marker(s) at: ` +
        startMarkers.map((m) => `(row ${Math.floor(m.y)}, col ${Math.floor(m.x)})`).join(', ')
      );
    }
  } else if (startMarkers.length === 1) {
    start = startMarkers[0];
  } else if (startMarkers.length === 0) {
    errors.push(
      `${tag} no player start defined - set an explicit "start: {x, y, ...}" on the level, ` +
      `or flag one legend entry with "start: true".`
    );
  } else {
    errors.push(
      `${tag} multiple player starts defined (${startMarkers.length} legend cells flagged ` +
      `"start: true"): ` + startMarkers.map((m) => `row ${Math.floor(m.y)}, col ${Math.floor(m.x)}`).join('; ')
    );
  }

  // 5. Optional extra grids (def.layers = { layerName: [rowStrings...] }),
  //    e.g. the boulder tilt layer (US-013). Must match the main grid size.
  if (def.layers && typeof def.layers === 'object') {
    for (const layerName of Object.keys(def.layers)) {
      const layerRows = def.layers[layerName];
      if (!Array.isArray(layerRows)) {
        errors.push(`${tag} layer "${layerName}": expected an array of row strings.`);
        continue;
      }
      if (layerRows.length !== height) {
        errors.push(`${tag} layer "${layerName}" has ${layerRows.length} rows, expected ${height} (same as the main grid).`);
      }
      for (let row = 0; row < layerRows.length; row++) {
        const line = layerRows[row];
        if (typeof line !== 'string') {
          errors.push(`${tag} layer "${layerName}" row ${row} is not a string.`);
        } else if (line.length !== width) {
          errors.push(`${tag} layer "${layerName}" row ${row} has length ${line.length}, expected ${width}, col mismatch starts at ${Math.min(line.length, width)}.`);
        }
      }
    }
  }

  if (errors.length) {
    errors.forEach((e) => console.error(e));
    return null;
  }

  return new Level({ name, legend: resolvedLegend, rows, width, height, start, def });
}

export class Level {
  constructor({ name, legend, rows, width, height, start, def }) {
    this.name = name;
    this.legend = legend; // resolved: every entry has topH/upperMat filled in
    this.rows = rows;
    this.width = width;   // cells, x axis (columns, east)
    this.height = height; // cells, y axis (rows, south)
    this.cellSize = 1;    // meters per cell (fixed at 1 per US-003)
    this.start = start;   // { x, y, facingDeg, pitchDeg, eyeH, pose } in world meters/degrees
    this.def = def;       // the original raw level definition, untouched - props/lights/
                           // triggers/markers/sun/ambient/route/layers/... for later stories.
  }

  /** True if (col, row) is inside the grid. */
  inBounds(col, row) {
    return col >= 0 && row >= 0 && col < this.width && row < this.height;
  }

  /**
   * Sector definition at a world position (meters). Returns null outside
   * the grid. The returned object is the shared, resolved legend entry
   * (topH/upperMat defaulted) - treat it as read-only.
   * @param {number} x world meters (column axis, east)
   * @param {number} y world meters (row axis, south)
   * @returns {Sector|null}
   */
  sectorAt(x, y) {
    const col = Math.floor(x);
    const row = Math.floor(y);
    if (!this.inBounds(col, row)) return null;
    const ch = this.rows[row][col];
    return this.legend[ch] || null;
  }

  /**
   * Floor height in meters at a world position, or null outside the grid.
   * On a solid cell this is the wall-top height (see Sector.solid docs),
   * not a walkable floor.
   */
  floorAt(x, y) {
    const s = this.sectorAt(x, y);
    return s ? s.floorH : null;
  }

  /** Ceiling height in meters (or 'sky') at a world position, or null outside the grid. */
  ceilAt(x, y) {
    const s = this.sectorAt(x, y);
    return s ? s.ceilH : null;
  }

  /**
   * (D-008) The sector to use for MOVEMENT/PHYSICS queries when (x, y)
   * falls outside the grid - i.e. what `sectorAt` returning `null` means
   * for something that has to decide "can I stand/walk here". Physics
   * code (game/js/physics/capsule.js, game/js/entities/Player.js) must
   * call this instead of hard-coding "outside the grid = wall", so a
   * future open-world `World` (D-007) can substitute a real terrain
   * sector here instead of a Level.
   *
   * `sectorAt`/`floorAt`/`ceilAt` themselves keep returning `null` outside
   * the grid unchanged - that null is meaningful to other consumers (e.g.
   * the raycaster, D-008: "when a ray leaves the level grid ... leave the
   * remaining open span for the next pass"), so it is not folded away here.
   *
   * This Level's default: a solid, sky-topped wall, everywhere outside the
   * grid - correct for `test_room` and the tower, both fully enclosed by
   * their own border walls, where nothing outside the authored grid is
   * ever meant to be walked on.
   * @param {number} x world meters (unused by the default; kept so a
   *   future override can vary the answer by position, e.g. terrain height)
   * @param {number} y world meters
   * @returns {Sector}
   */
  outsideSector(x, y) { // eslint-disable-line no-unused-vars
    return OUTSIDE_SECTOR;
  }

  /**
   * Character at (x, y) in an optional extra grid (`level.def.layers[name]`),
   * e.g. `layerAt('tilt', x, y)` for the boulder layer. Returns null outside
   * the grid or if the layer/def doesn't exist. Convenience only - the raw
   * rows are always available at `level.def.layers[name]`.
   */
  layerAt(layerName, x, y) {
    const col = Math.floor(x);
    const row = Math.floor(y);
    if (!this.inBounds(col, row)) return null;
    const layer = this.def && this.def.layers && this.def.layers[layerName];
    if (!layer || !layer[row]) return null;
    return layer[row][col] || null;
  }
}
