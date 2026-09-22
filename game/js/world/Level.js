// game/js/world/Level.js
//
// Sector map format + loader (US-003). See game/js/world/MAP_FORMAT.md for the
// full authoring spec. Summary:
//
//   A level is a plain data object { name, legend, rows, start? }.
//   `rows` is a rectangular array of equal-length strings: one character per
//   cell, one row per line, top-down. `legend` maps each character to a
//   *sector definition*: { floorH, ceilH, wallMat, floorMat, ceilMat, solid }.
//   1 cell = 1 world meter; cell (col, row) occupies world space
//   [col, col+1) x [row, row+1), so x = column (east), y = row (south).
//
// loadLevel(def) validates the raw data and returns a Level instance with
// the query API (sectorAt/floorAt/ceilAt) used by the raycaster (US-004),
// physics (US-008) and everything downstream. On a validation error it
// prints details (row/column where applicable) to the console and returns
// null - callers must check for that.

/**
 * @typedef {Object} Sector
 * @property {number} floorH - floor height in meters.
 * @property {number|'sky'} ceilH - ceiling height in meters, or 'sky' for an open/roofless cell.
 * @property {string} wallMat - material key (design/palette.js `materials`).
 * @property {string} floorMat - material key.
 * @property {string} ceilMat - material key (ignored when ceilH === 'sky').
 * @property {boolean} solid - true if this cell blocks movement (a wall/pillar).
 */

/**
 * Load and validate a raw level definition into a queryable Level.
 * @param {{name: string, legend: Object<string, Sector & {start?: boolean, facingDeg?: number}>, rows: string[], start?: {x:number,y:number,facingDeg?:number}}} def
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

  // 2. Every char is in the legend. Also collect declared start markers.
  const startMarkers = []; // { x, y, facingDeg }
  if (legend) {
    for (let row = 0; row < height; row++) {
      const line = rows[row];
      if (typeof line !== 'string') continue;
      for (let col = 0; col < line.length; col++) {
        const ch = line[col];
        const sector = legend[ch];
        if (!sector) {
          errors.push(`${tag} unknown legend character '${ch}' at row ${row}, col ${col}.`);
          continue;
        }
        if (sector.start) {
          startMarkers.push({
            x: col + 0.5,
            y: row + 0.5,
            facingDeg: typeof sector.facingDeg === 'number' ? sector.facingDeg : 0,
          });
        }
      }
    }
  }

  // 3. Player start defined: either an explicit def.start, or exactly one
  //    legend-flagged start marker in the grid.
  let start = null;
  if (def.start && typeof def.start.x === 'number' && typeof def.start.y === 'number') {
    start = {
      x: def.start.x,
      y: def.start.y,
      facingDeg: typeof def.start.facingDeg === 'number' ? def.start.facingDeg : 0,
    };
    if (startMarkers.length) {
      errors.push(
        `${tag} both an explicit "start" and ${startMarkers.length} legend start marker(s) ` +
        `are present; remove one. Legend marker(s) at: ` +
        startMarkers.map((m) => `(${Math.floor(m.y)},${Math.floor(m.x)})`).join(', ')
      );
    }
  } else if (startMarkers.length === 1) {
    start = startMarkers[0];
  } else if (startMarkers.length === 0) {
    errors.push(
      `${tag} no player start defined - set an explicit "start: {x, y}" on the level, ` +
      `or flag one legend entry with "start: true".`
    );
  } else {
    errors.push(
      `${tag} multiple player starts defined (${startMarkers.length} legend cells flagged ` +
      `"start: true"): ` + startMarkers.map((m) => `row ${Math.floor(m.y)}, col ${Math.floor(m.x)}`).join('; ')
    );
  }

  if (errors.length) {
    errors.forEach((e) => console.error(e));
    return null;
  }

  return new Level({ name, legend, rows, width, height, start });
}

export class Level {
  constructor({ name, legend, rows, width, height, start }) {
    this.name = name;
    this.legend = legend;
    this.rows = rows;
    this.width = width;   // cells, x axis (columns)
    this.height = height; // cells, y axis (rows)
    this.cellSize = 1;    // meters per cell (fixed at 1 per US-003)
    this.start = start;   // { x, y, facingDeg } in world meters
  }

  /** True if (col, row) is inside the grid. */
  inBounds(col, row) {
    return col >= 0 && row >= 0 && col < this.width && row < this.height;
  }

  /**
   * Sector definition at a world position (meters). Returns null outside
   * the grid. The returned object is the shared legend entry - treat it as
   * read-only.
   * @param {number} x world meters (column axis)
   * @param {number} y world meters (row axis)
   * @returns {Sector|null}
   */
  sectorAt(x, y) {
    const col = Math.floor(x);
    const row = Math.floor(y);
    if (!this.inBounds(col, row)) return null;
    const ch = this.rows[row][col];
    return this.legend[ch] || null;
  }

  /** Floor height in meters at a world position, or null outside the grid. */
  floorAt(x, y) {
    const s = this.sectorAt(x, y);
    return s ? s.floorH : null;
  }

  /** Ceiling height in meters (or 'sky') at a world position, or null outside the grid. */
  ceilAt(x, y) {
    const s = this.sectorAt(x, y);
    return s ? s.ceilH : null;
  }
}
