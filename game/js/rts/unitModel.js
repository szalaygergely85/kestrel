// game/js/rts/unitModel.js - RTS-01 unit model glue (docs/architecture.md 28.8).
// The voxel data now lives in design/models/rts_unit.js (designer readability pass: 1.0 x 0.8 x 1.6 m soldier,
// cellM 0.1, 10 x 8 x 16, parts body + head). Tabard, arms, pauldrons, legs, pack and helmet use the neutral slot
// material `team.a` that `engine.setTeamMaterials` repaints per team (RTS_TEAM_SPEC below); boots, belt, skin,
// bedroll and spear keep their own materials. Pure data + helpers, no engine import (the design file is a classic
// script that only writes globalThis.ASSETS.rtsModels).
import '../../../design/models/rts_unit.js';

export const UNIT_MODEL_KEY = 'rtsUnit';
export const UNIT_SLOT_MAT = 'team.a';   // the team remap slot (neutral in team 0), design/palette.js

/**
 * Team colours as a `setTeamMaterials` spec: team 1 = own (cyan-blue), team 2 = enemy (signal red).
 * Spare targets for later teams: 'team.gold', 'team.violet' (design/palette.js).
 */
export const RTS_TEAM_SPEC = {
  slots: [UNIT_SLOT_MAT],
  teams: [null, { [UNIT_SLOT_MAT]: 'team.teal' }, { [UNIT_SLOT_MAT]: 'team.red' }],
};

function designDef() {
  const d = globalThis.ASSETS && globalThis.ASSETS.rtsModels && globalThis.ASSETS.rtsModels[UNIT_MODEL_KEY];
  if (!d) throw new Error('unitModel: design/models/rts_unit.js did not register ASSETS.rtsModels.rtsUnit');
  return d;
}

/** The `ModelDef` (`{name, voxel}`) to register with `assets.add('model', UNIT_MODEL_KEY, ...)`. Fresh copy per call. */
export function makeUnitModelDef() {
  return JSON.parse(JSON.stringify(designDef()));
}

/** Exposed-face stats of the model (test/measure helper): fraction of non-bottom exposed faces that are team-slot voxels. */
export function teamSurfaceFraction(def = makeUnitModelDef()) {
  const v = def.voxel, L = v.layers;
  const [SX, SY, SZ] = v.size;
  const slotLetters = new Set(Object.keys(v.mats).filter((k) => v.mats[k] === UNIT_SLOT_MAT));
  const at = (x, y, z) => (x < 0 || y < 0 || z < 0 || x >= SX || y >= SY || z >= SZ ? '.' : L[z][y][x]);
  let team = 0, all = 0;
  const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1]]; // no bottom faces
  for (let z = 0; z < SZ; z++) for (let y = 0; y < SY; y++) for (let x = 0; x < SX; x++) {
    const c = at(x, y, z);
    if (c === '.') continue;
    for (const d of dirs) {
      if (at(x + d[0], y + d[1], z + d[2]) !== '.') continue;
      all++;
      if (slotLetters.has(c)) team++;
    }
  }
  return { team, all, fraction: all ? team / all : 0 };
}
