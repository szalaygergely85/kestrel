// game/js/world/worldTestMain.js
//
// Standalone top-down test harness for the US-003 sector map format.
// Not part of the game's own entry point (game/js/main.js) - loaded only by
// game/world-test.html. Draws the loaded level on a plain 2D canvas (no
// dependency on game/js/render/*), color-coding floor height and flagging
// solid cells, sky-ceiling cells and the player start.

import { loadLevel } from './Level.js';
import testRoom from './levels/test_room.js';

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

  statusEl.textContent =
    `OK: "${level.name}" loaded - ${level.width}x${level.height} cells, ` +
    `start (${level.start.x.toFixed(2)}, ${level.start.y.toFixed(2)}) facing ${level.start.facingDeg}deg`;
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
  // Facing tick.
  const rad = (level.start.facingDeg - 90) * Math.PI / 180; // 0deg = east
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

  if (sector.ceilH === 'sky') {
    ctx.fillStyle = 'rgba(140, 200, 255, 0.55)';
    ctx.font = `${CELL_PX * 0.5}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('^', x + CELL_PX / 2, y + CELL_PX / 2);
  } else if (sector.floorH !== 0) {
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.font = `${CELL_PX * 0.32}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(sector.floorH.toFixed(1), x + CELL_PX / 2, y + CELL_PX / 2);
  }
}

function cellColor(sector) {
  if (sector.solid) return '#3a3a3a';
  if (sector.ceilH === 'sky') return '#274a63';
  // Brighter floor = higher. Base stone-floor blue-gray, scaled by floorH.
  const t = Math.min(1, sector.floorH / 1.2);
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
    cellInfoEl.textContent =
      `(${x.toFixed(2)}, ${y.toFixed(2)}) cell(${Math.floor(x)},${Math.floor(y)}) -> ` +
      `floorH=${sector.floorH} ceilH=${sector.ceilH} wallMat=${sector.wallMat} ` +
      `floorMat=${sector.floorMat} ceilMat=${sector.ceilMat} solid=${sector.solid}`;
  });
}
