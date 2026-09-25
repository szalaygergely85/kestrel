// game/js/dev/worldTestMain.js (moved from game/js/world/worldTestMain.js,
// US-024 Phase C).
//
// Standalone top-down test harness for the US-003 sector map format (v2).
// Not part of the game's own entry point (game/js/main.js) - loaded only by
// game/world-test.html. Draws the loaded level on a plain 2D canvas (no
// dependency on engine/render/*), color-coding floor height and flagging
// solid cells (now shaded/labelled by their v2 wall-top height and material),
// sky-ceiling cells, void/gap cells (negative floorH), doorway/lintel cells
// (topH != ceilH) and the player start (with v2 facing/pitch/eye/pose).
//
// Imports only engine/index.js (check-deps rule 3). test_room is now
// content/levels/test_room.level.json (US-027b) - this module loads it
// itself via loadContentPack (top-level await), instead of world-test.html
// loading design/levels/test_room.js as a classic script first.

import { loadLevel, loadContentPack } from '../../../engine/index.js';

const bundle = await loadContentPack('../content/manifest.json');
const testRoom = bundle.levels.test_room;

const CELL_PX = 28;

const LEVELS = {
  test_room: testRoom,
};

const canvas = document.getElementById('map');
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status');
const cellInfoEl = document.getElementById('cell-info');

const params = new URLSearchParams(window.location.search);
const levelName = params.get('level') || 'test_room';
const def = LEVELS[levelName];

if (!def) {
  fail(`Unknown level "${levelName}". Known levels: ${Object.keys(LEVELS).join(', ')}`);
} else {
  run(def);
}

function run(def) {
  const consoleErrors = [];
  const originalError = console.error;
  console.error = (...args) => {
    consoleErrors.push(args.join(' '));
    originalError(...args);
  };
  const level = loadLevel(def);
  console.error = originalError;

  if (!level) {
    fail(`loadLevel("${def.name}") failed - see console.\n\n` + consoleErrors.join('\n'));
    return;
  }

  const s = level.start;
  statusEl.textContent =
    `OK: "${level.name}" loaded - ${level.width}x${level.height} cells, ` +
    `start (${s.x.toFixed(2)}, ${s.y.toFixed(2)}) facing ${s.facingDeg}deg (compass, 0=N/90=E), ` +
    `pitch ${s.pitchDeg}deg, eye ${s.eyeH}m, pose ${s.pose}`;
  statusEl.className = 'ok';

  draw(level);
  wireHover(level);
}

function fail(message) {
  statusEl.textContent = message;
  statusEl.className = 'error';
  cellInfoEl.textContent = '';
}

// --- rendering -------------------------------------------------------

function draw(level) {
  canvas.width = level.width * CELL_PX;
  canvas.height = level.height * CELL_PX;

  for (let row = 0; row < level.height; row++) {
    for (let col = 0; col < level.width; col++) {
      const sector = level.sectorAt(col + 0.5, row + 0.5);
      drawCell(col, row, sector);
    }
  }

  // Player start marker.
  ctx.fillStyle = '#ffe08a';
  ctx.beginPath();
  ctx.arc(level.start.x * CELL_PX, level.start.y * CELL_PX, CELL_PX * 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#3a2a00';
  ctx.lineWidth = 2;
  ctx.stroke();
  // Facing tick. facingDeg is compass (0=N,90=E,clockwise); screen/math angle
  // 0 = east, increasing clockwise (since canvas y grows down), so subtract 90.
  const rad = (level.start.facingDeg - 90) * Math.PI / 180;
  ctx.beginPath();
  ctx.moveTo(level.start.x * CELL_PX, level.start.y * CELL_PX);
  ctx.lineTo(
    level.start.x * CELL_PX + Math.cos(rad) * CELL_PX * 0.5,
    level.start.y * CELL_PX + Math.sin(rad) * CELL_PX * 0.5
  );
  ctx.strokeStyle = '#ffe08a';
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawCell(col, row, sector) {
  const x = col * CELL_PX;
  const y = row * CELL_PX;

  ctx.fillStyle = cellColor(sector);
  ctx.fillRect(x, y, CELL_PX, CELL_PX);

  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.strokeRect(x + 0.5, y + 0.5, CELL_PX - 1, CELL_PX - 1);

  // Solid cells and non-solid cells both always print floorH now: on a solid
  // cell it's the wall-TOP height (v2), so it varies (low wall vs pillar vs
  // tower wall) and is worth showing even at "typical" heights.
  if (sector.solid) {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = `${CELL_PX * 0.32}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(sector.floorH.toFixed(1), x + CELL_PX / 2, y + CELL_PX / 2);
  } else if (sector.ceilH === 'sky') {
    ctx.fillStyle = 'rgba(140, 200, 255, 0.55)';
    ctx.font = `${CELL_PX * 0.5}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('^', x + CELL_PX / 2, y + CELL_PX / 2);
  } else if (sector.floorH !== 0) {
    ctx.fillStyle = sector.floorH < 0 ? 'rgba(255,190,190,0.85)' : 'rgba(0,0,0,0.65)';
    ctx.font = `${CELL_PX * 0.3}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(sector.floorH.toFixed(1), x + CELL_PX / 2, y + CELL_PX / 2);
  }

  // topH != ceilH (a real lintel/doorway, not the zero-thickness default):
  // small corner marker, since the top-down color can't show it.
  if (!sector.solid && sector.ceilH !== 'sky' && sector.topH !== sector.ceilH) {
    ctx.fillStyle = 'rgba(255, 224, 138, 0.9)';
    ctx.font = `${CELL_PX * 0.28}px monospace`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('D', x + 2, y + 1);
  }
}

function clamp01(t) {
  return Math.max(0, Math.min(1, t));
}

function cellColor(sector) {
  if (sector.solid) {
    // Wall column: tint by wallMat, shade by height (floorH = wall top, v2).
    const base =
      sector.wallMat === 'stone_moss' ? [70, 105, 75] :
      sector.wallMat === 'stone_scorched' ? [95, 65, 55] :
      sector.wallMat === 'iron' ? [90, 95, 105] :
      [95, 95, 105]; // stone / default
    const shade = 1 - clamp01(sector.floorH / 9) * 0.45; // taller = a bit darker
    return `rgb(${Math.round(base[0] * shade)},${Math.round(base[1] * shade)},${Math.round(base[2] * shade)})`;
  }
  if (sector.ceilH === 'sky') return '#274a63';
  if (sector.floorH < 0) return '#3a1c1c'; // void / pit (a real gap you can fall into)
  // Brighter floor = higher. Base stone-floor blue-gray, scaled by floorH.
  const t = clamp01(sector.floorH / 1.2);
  const r = Math.round(60 + t * 140);
  const g = Math.round(70 + t * 130);
  const b = Math.round(80 + t * 90);
  return `rgb(${r},${g},${b})`;
}

// --- hover inspector ---------------------------------------------------

function wireHover(level) {
  canvas.addEventListener('mousemove', (ev) => {
    const rect = canvas.getBoundingClientRect();
    const x = (ev.clientX - rect.left) / CELL_PX;
    const y = (ev.clientY - rect.top) / CELL_PX;
    const sector = level.sectorAt(x, y);
    if (!sector) {
      cellInfoEl.textContent = `(${x.toFixed(2)}, ${y.toFixed(2)}) - out of bounds`;
      return;
    }
    const extra = ['zone', 'tag', 'desc', 'dynamic']
      .filter((k) => sector[k] !== undefined)
      .map((k) => `${k}=${typeof sector[k] === 'object' ? JSON.stringify(sector[k]) : sector[k]}`)
      .join(' ');
    cellInfoEl.textContent =
      `(${x.toFixed(2)}, ${y.toFixed(2)}) cell(${Math.floor(x)},${Math.floor(y)}) -> ` +
      `floorH=${sector.floorH} ceilH=${sector.ceilH} topH=${sector.topH} wallMat=${sector.wallMat} ` +
      `floorMat=${sector.floorMat} ceilMat=${sector.ceilMat} upperMat=${sector.upperMat} solid=${sector.solid}` +
      (extra ? ` | ${extra}` : '');
  });
}
