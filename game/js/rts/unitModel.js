// game/js/rts/unitModel.js - RTS-01a placeholder unit (docs/architecture.md 28.8).
// A small upright voxel figure: 1.0 m wide (incl. the spear), 0.5 m deep, 1.6 m tall (cellM 0.1, 10 x 5 x 16).
// The body, shoulders and arms use ONE slot material ('linen') that `engine.setTeamMaterials` repaints per team
// (RTS_TEAM_SPEC below); legs, belt, head, helmet and spear keep their own materials. Moves to design/ when the
// designer takes over. Pure data + helpers, no engine import.

export const UNIT_MODEL_KEY = 'rtsUnit';
export const UNIT_SLOT_MAT = 'linen';   // the team remap slot (neutral in team 0)

// Letter -> material (all exist in palette.materials with a v2 detail record, so the GPU gate stays open).
const MATS = { T: UNIT_SLOT_MAT, I: 'iron_dark', H: 'canvas', W: 'wood', M: 'iron_light' };

/**
 * Team colours as a `setTeamMaterials` spec: team 1 = own (teal crystal, bright), team 2 = enemy (red gore).
 * Placeholder until the designer adds `team.*` palette entries.
 */
export const RTS_TEAM_SPEC = {
  slots: [UNIT_SLOT_MAT],
  teams: [null, { [UNIT_SLOT_MAT]: 'crystal_lit' }, { [UNIT_SLOT_MAT]: 'gore_red' }],
};

const SX = 10, SY = 5, SZ = 16;

/** Voxel letter at (x, y, z), or '.' for empty. */
function voxelAt(x, y, z) {
  const inY = (a, b) => y >= a && y <= b;
  if (z <= 4) { // legs: x 2-3 and 6-7, y 1-3
    return inY(1, 3) && ((x >= 2 && x <= 3) || (x >= 6 && x <= 7)) ? 'I' : '.';
  }
  if (z === 5) return inY(1, 3) && x >= 1 && x <= 8 ? 'I' : '.';            // belt
  if (z >= 6 && z <= 11) { // torso + arms; the shoulder row (z 11) is the widest top face
    if (inY(1, 3) && x >= 1 && x <= 8) return 'T';
    if (z <= 10 && inY(2, 3) && (x === 0 || x === 9)) return 'T';           // arms
    if (z === 11 && inY(2, 3) && (x === 0 || x === 9)) return 'T';          // shoulders
    return '.';
  }
  if (z >= 12 && z <= 14) return inY(1, 3) && x >= 3 && x <= 6 ? 'H' : '.'; // head
  if (z === 15 && inY(1, 3) && x >= 3 && x <= 6) return 'M';                 // helmet
  return '.';
}

function buildLayers() {
  const layers = [];
  for (let z = 0; z < SZ; z++) {
    const rows = [];
    for (let y = 0; y < SY; y++) {
      let row = '';
      for (let x = 0; x < SX; x++) {
        // spear: x 9, y 2 above the hand, z 11..15 (wood shaft, iron tip)
        let ch = voxelAt(x, y, z);
        if (x === 9 && y === 2 && z >= 12 && z <= 15) ch = z === 15 ? 'M' : 'W';
        row += ch;
      }
      rows.push(row);
    }
    layers.push(rows);
  }
  return layers;
}

/** The `ModelDef` (`{name, voxel}`) to register with `assets.add('model', UNIT_MODEL_KEY, ...)`. */
export function makeUnitModelDef() {
  return {
    name: UNIT_MODEL_KEY,
    desc: 'RTS-01a placeholder unit: upright 1.6 m figure, torso/arms in the team slot material.',
    voxel: {
      version: 1,
      cellM: 0.1,
      size: [SX, SY, SZ],
      anchor: [4.5, 2.5, 0],               // feet centre
      mats: { T: MATS.T, I: MATS.I, H: MATS.H, W: MATS.W, M: MATS.M },
      layers: buildLayers(),
      parts: {
        body: { box: [0, 0, 0, 10, 5, 12], pivot: [4.5, 2.5, 0] },
        head: { box: [3, 1, 12, 10, 4, 16], pivot: [4.5, 2.5, 11], parent: 'body' },
      },
    },
  };
}

/** Exposed-face stats of the model (test/measure helper): fraction of non-bottom exposed faces that are team-slot voxels. */
export function teamSurfaceFraction(def = makeUnitModelDef()) {
  const v = def.voxel, L = v.layers;
  const at = (x, y, z) => (x < 0 || y < 0 || z < 0 || x >= SX || y >= SY || z >= SZ ? '.' : L[z][y][x]);
  let team = 0, all = 0;
  const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1]]; // no bottom faces
  for (let z = 0; z < SZ; z++) for (let y = 0; y < SY; y++) for (let x = 0; x < SX; x++) {
    const c = at(x, y, z);
    if (c === '.') continue;
    for (const d of dirs) {
      if (at(x + d[0], y + d[1], z + d[2]) !== '.') continue;
      all++;
      if (c === 'T') team++;
    }
  }
  return { team, all, fraction: all ? team / all : 0 };
}
