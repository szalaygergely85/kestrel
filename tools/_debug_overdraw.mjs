import { loadLevel } from '../game/js/world/Level.js';
import { castScene } from '../game/js/render/raycaster.js';
import testRoomDef from '../game/js/world/levels/test_room.js';
import paletteModule from '../design/palette.js';

const palette = paletteModule.default || paletteModule;
const COLS = 160, ROWS = 60;

class RT {
  constructor(cols, rows) {
    this.cols = cols; this.rows = rows; this.pxCellW = 9; this.pxCellH = 16;
    this.writeCount = new Int32Array(cols * rows);
  }
  setCellRGB(x, y) {
    if (x < 0 || x >= this.cols || y < 0 || y >= this.rows) return;
    this.writeCount[y * this.cols + x]++;
  }
}

const level = loadLevel(testRoomDef);
const rt = new RT(COLS, ROWS);
const camera = { x: 2.5, y: 7.5, z: 1.6, yawDeg: 0, pitchDeg: 35 };
castScene(rt, level, camera, palette, { skyFallback: true, shader: 'reference' });

// find columns with double-writes or missing writes
for (let x = 0; x < COLS; x++) {
  let total = 0, dbl = 0, missing = 0;
  const rowsDbl = [];
  for (let y = 0; y < ROWS; y++) {
    const c = rt.writeCount[y * COLS + x];
    total += c;
    if (c > 1) { dbl++; rowsDbl.push(`${y}:${c}`); }
    if (c === 0) missing++;
  }
  if (dbl > 0 || missing > 0) {
    console.log(`col ${x}: total=${total} dbl=${dbl} missing=${missing} rows=${rowsDbl.slice(0,10).join(',')}`);
  }
}
