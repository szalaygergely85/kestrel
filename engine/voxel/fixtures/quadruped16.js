// engine/voxel/fixtures/quadruped16.js - VOX-PARTS-16 test fixture (architecture.md 38.67).
// quadruped12 with each leg split into an upper part and a lower part `<name>2`
// plus a tail and a jaw (10 -> 12 parts, meshOnly; parts 8..11 = the lower legs). `legRig` = data block for the later runtime leg solve
// (ANIM-C-01 validates it; today the model validator ignores it).
import quadruped12 from './quadruped12.js';

// own copy of the grid + 2 extra painted boxes (tail behind the body, jaw under the head).
const layers = quadruped12.layers.map((rows) => rows.slice());
function paintBox(x0, y0, z0, x1, y1, z1, ch) {
  for (let z = z0; z < z1; z++) for (let y = y0; y < y1; y++) {
    const c = layers[z][y].split('');
    for (let x = x0; x < x1; x++) c[x] = ch;
    layers[z][y] = c.join('');
  }
}
paintBox(5, 7, 5, 7, 8, 8, '#'); // tail
paintBox(4, 0, 3, 8, 2, 5, '#'); // jaw

const legs = ['legFL', 'legFR', 'legBL', 'legBR'];
const parts = {};
const KNEE_Z = 1; // lower part = z0..1, upper = z1..3
for (const k of Object.keys(quadruped12.parts)) {
  const pd = quadruped12.parts[k];
  if (legs.indexOf(k) < 0) { parts[k] = pd; if (k === 'head') { parts.tail = { box: [5, 7, 5, 7, 8, 8], pivot: [6, 7, 6], parent: 'body' }; parts.jaw = { box: [4, 0, 3, 8, 2, 5], pivot: [6, 2, 4], parent: 'head' }; } continue; }
  const [x0, y0, , x1, y1] = pd.box;
  parts[k] = { box: [x0, y0, KNEE_Z, x1, y1, 3], pivot: pd.pivot.slice(), parent: 'body' };
}
for (const k of legs) {
  const pd = quadruped12.parts[k];
  const [x0, y0, , x1, y1] = pd.box;
  parts[k + '2'] = { box: [x0, y0, 0, x1, y1, KNEE_Z], pivot: [pd.pivot[0], pd.pivot[1], KNEE_Z], parent: k };
}

/** @type {import('../VoxelModel.js').VoxelModelDef} */
const quadruped16 = {
  version: 1,
  cellM: quadruped12.cellM,
  size: quadruped12.size.slice(),
  anchor: quadruped12.anchor.slice(),
  mats: quadruped12.mats,
  layers,
  meshOnly: true,
  parts,
  legRig: legs.map((l) => ({ upper: l, lower: l + '2', hip: quadruped12.parts[l].pivot.slice(), knee: [quadruped12.parts[l].pivot[0], quadruped12.parts[l].pivot[1], KNEE_Z] })),
  animations: {
    walk: {
      fps: 8,
      loop: true,
      frames: [
        { legFL: { rot: [20, 0, 0] }, legFL2: { rot: [-15, 0, 0] }, legBR: { rot: [20, 0, 0] } },
        { legFL: { rot: [-20, 0, 0] }, legFL2: { rot: [10, 0, 0] }, legBR: { rot: [-20, 0, 0] } },
      ],
    },
  },
};

export default quadruped16;
