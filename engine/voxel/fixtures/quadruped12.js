// engine/voxel/fixtures/quadruped12.js - US-039 test fixture (architecture.md
// 15.1, backlog US-039 tech notes item 2). A generic bear-shaped placeholder
// with NO GDD word in engine/ - the designer's real bear model comes with
// US-041. 12x8x10 voxels at cellM 0.125 (1.5 x 1.0 x 1.25 m), 6 parts:
// `body` (root), `head` and 4 legs (all parented to `body`).
//
// Not a hot-path module - building the z-layer row strings with a couple of
// small helper loops at import time is fine (this only runs once, when the
// fixture is loaded, never per-frame).

const SX = 12, SY = 8, SZ = 10;

function makeGrid() {
  const layers = [];
  for (let z = 0; z < SZ; z++) {
    const rows = [];
    for (let y = 0; y < SY; y++) rows.push('.'.repeat(SX));
    layers.push(rows);
  }
  return layers;
}

function paintBox(layers, x0, y0, z0, x1, y1, z1, ch, exceptions) {
  for (let z = z0; z < z1; z++) {
    for (let y = y0; y < y1; y++) {
      const chars = layers[z][y].split('');
      for (let x = x0; x < x1; x++) {
        const key = x + ',' + y + ',' + z;
        chars[x] = (exceptions && exceptions[key]) || ch;
      }
      layers[z][y] = chars.join('');
    }
  }
}

const layers = makeGrid();
// body: the root part, x2..10 y2..7 z3..8.
paintBox(layers, 2, 2, 3, 10, 7, 8, '#');
// head: x3..9 y0..3 z5..10, parented to body, overlaps the body box at
// z5..8 (first-part-in-index-order wins there, per the packer) - 2 eye
// voxels on its front face (y0).
paintBox(layers, 3, 0, 5, 9, 3, 10, '#', { '4,0,8': 'e', '8,0,8': 'e' });
// four legs, 2x2x3 boxes at z0..3, parented to body.
paintBox(layers, 2, 2, 0, 4, 4, 3, 'o'); // legFL (west, front)
paintBox(layers, 8, 2, 0, 10, 4, 3, 'o'); // legFR (east, front)
paintBox(layers, 2, 5, 0, 4, 7, 3, 'o'); // legBL (west, back)
paintBox(layers, 8, 5, 0, 10, 7, 3, 'o'); // legBR (east, back)

/** @type {import('../VoxelModel.js').VoxelModelDef} */
const quadruped12 = {
  version: 1,
  cellM: 0.125,
  size: [SX, SY, SZ],
  anchor: [6, 4, 0],
  mats: { '#': 'mat_a', 'o': 'mat_b', 'e': 'mat_c' },
  layers,
  parts: {
    body: { box: [2, 2, 3, 10, 7, 8], pivot: [6, 4, 3] },
    head: { box: [3, 0, 5, 9, 3, 10], pivot: [6, 3, 7], parent: 'body' },
    legFL: { box: [2, 2, 0, 4, 4, 3], pivot: [3, 3, 3], parent: 'body' },
    legFR: { box: [8, 2, 0, 10, 4, 3], pivot: [9, 3, 3], parent: 'body' },
    legBL: { box: [2, 5, 0, 4, 7, 3], pivot: [3, 6, 3], parent: 'body' },
    legBR: { box: [8, 5, 0, 10, 7, 3], pivot: [9, 6, 3], parent: 'body' },
  },
  animations: {
    idle: {
      fps: 4,
      loop: true,
      frames: [
        { head: { rot: [0, 0, 0] } },
        { head: { rot: [0, 0, 8] } },
      ],
    },
    walk: {
      fps: 8,
      loop: true,
      frames: [
        { legFL: { rot: [20, 0, 0] }, legBR: { rot: [20, 0, 0] }, legFR: { rot: [-20, 0, 0] }, legBL: { rot: [-20, 0, 0] }, body: { pos: [0, 0, 0.5] } },
        { body: { pos: [0, 0, 0] } },
        { legFL: { rot: [-20, 0, 0] }, legBR: { rot: [-20, 0, 0] }, legFR: { rot: [20, 0, 0] }, legBL: { rot: [20, 0, 0] }, body: { pos: [0, 0, -0.5] } },
        { body: { pos: [0, 0, 0] } },
      ],
      events: { step: [0, 2] },
    },
  },
};

export default quadruped12;
