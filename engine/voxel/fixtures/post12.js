// engine/voxel/fixtures/post12.js - ME-07 test fixture (docs/architecture.md
// 27.15.6, referenced by docs/backlog.md's `voxelMesh.test.js` line and
// architecture.md 1268's gpucompare pose list). A generic two-part post
// mounted on a back plate, lever-like proportions, NO GDD word in engine/
// (the designer's real lever/lantern voxel defs live in design/models/).
// 6x6x12 voxels at cellM 0.1 (0.6 x 0.6 x 1.2 m), 2 parts: `plate` (root,
// a thin slab against the y0 face) and `post` (a small square post
// standing off the plate, parented to it).
//
// Not a hot-path module - building the z-layer row strings at import time
// is fine (runs once, never per-frame).

const SX = 6, SY = 6, SZ = 12;

function makeGrid() {
  const layers = [];
  for (let z = 0; z < SZ; z++) {
    const rows = [];
    for (let y = 0; y < SY; y++) rows.push('.'.repeat(SX));
    layers.push(rows);
  }
  return layers;
}

function paintBox(layers, x0, y0, z0, x1, y1, z1, ch) {
  for (let z = z0; z < z1; z++) {
    for (let y = y0; y < y1; y++) {
      const chars = layers[z][y].split('');
      for (let x = x0; x < x1; x++) chars[x] = ch;
      layers[z][y] = chars.join('');
    }
  }
}

const layers = makeGrid();
// plate: the root part, a full slab against the back (y0..1) face.
paintBox(layers, 1, 0, 0, 5, 1, 12, '#');
// post: a 2x2 post standing off the plate (y1..3), parented to plate.
paintBox(layers, 2, 1, 2, 4, 3, 10, 'o');

/** @type {import('../VoxelModel.js').VoxelModelDef} */
const post12 = {
  version: 1,
  cellM: 0.1,
  size: [SX, SY, SZ],
  anchor: [3, 1, 0],
  mats: { '#': 'mat_a', 'o': 'mat_b' },
  layers,
  parts: {
    plate: { box: [1, 0, 0, 5, 1, 12], pivot: [3, 0, 6] },
    post: { box: [2, 1, 2, 4, 3, 10], pivot: [3, 1, 2], parent: 'plate' },
  },
};

export default post12;
