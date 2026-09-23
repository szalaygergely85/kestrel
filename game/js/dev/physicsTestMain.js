// game/js/dev/physicsTestMain.js (moved from game/js/physics/physicsTestMain.js,
// US-024 Phase C).
//
// Standalone top-down, playable test harness for US-008/US-009 physics
// (player capsule, gravity, walk/run, collision, jump/coyote/buffer,
// landing feel) on test_room. Loaded only by game/physics-test.html - not
// part of the game's own entry point (game/js/main.js). Imports only
// engine/index.js (check-deps rule 3); its own tiny fixed-step loop and
// keyboard listener are self contained.
//
// Controls: WASD move (relative to facing), Shift run, Space jump,
// Left/Right arrows turn (120 deg/s, same rate as the US-005 fallback spec)
// since there is no mouse-look yet, R resets to the level start. This is a
// debug harness, not the real camera controls (US-005) - main.js drives
// Player from real mouse/keyboard input (see the integration note at the
// bottom of engine/entities/Player.js). `controls.jump` mirrors main.js's
// convention (isDown OR the just-this-frame edge) even though this harness
// has no separate "pressed" concept - a plain key Set already only reports
// "down", which is exactly the HELD level `Player.update` expects.
//
// test_room comes off `window.ASSETS` - physics-test.html loads
// design/levels/test_room.js as a classic script before this module.

import { loadLevel, Player, PHYSICS } from '../../../engine/index.js';

const testRoom = window.ASSETS.levels.test_room;

const CELL_PX = 26;
const TURN_RATE_DEG = 120; // deg/s, matches US-005's arrow-key fallback rate

const canvas = document.getElementById('map');
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status');
const hudEl = document.getElementById('hud');

const level = loadLevel(testRoom);
if (!level) {
  statusEl.textContent = 'loadLevel("test_room") failed - see console.';
  statusEl.className = 'error';
  throw new Error('level failed to load');
}
statusEl.textContent = `"${level.name}" loaded - ${level.width}x${level.height} cells. WASD move, Shift run, Space jump, arrows turn, R reset.`;
statusEl.className = 'ok';

canvas.width = level.width * CELL_PX;
canvas.height = level.height * CELL_PX;

let player = new Player(level);
let yawDeg = player.yawDeg;

// --- tiny self-contained keyboard state (not engine/input.js - see header) ---
const GAME_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight', 'Space', 'ArrowLeft', 'ArrowRight', 'KeyR']);
const down = new Set();
window.addEventListener('keydown', (e) => {
  if (GAME_KEYS.has(e.code)) e.preventDefault();
  down.add(e.code);
  if (e.code === 'KeyR') resetPlayer();
});
window.addEventListener('keyup', (e) => down.delete(e.code));
window.addEventListener('blur', () => down.clear());

function resetPlayer() {
  player = new Player(level);
  yawDeg = player.yawDeg;
}

// --- fixed 60 Hz update / decoupled render, minimal accumulator loop ---
const FIXED_DT = PHYSICS.fixedDt;
let acc = 0;
let last = performance.now();
let fps = 0, fpsAcc = 0, fpsFrames = 0;

// Fall-tracking for the HUD (useful when eyeballing US-009 landing-dip work later).
let maxFallDropThisAir = 0;
let lastZWhileAirborne = null;
let lastFallDistance = 0; // US-009 HUD: the most recent landing's fallDistance (peakZ - landZ)

function tick(now) {
  requestAnimationFrame(tick);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.25) dt = 0.25; // avoid a spiral of death after a tab was hidden
  acc += dt;

  let steps = 0;
  while (acc >= FIXED_DT && steps < 5) {
    update(FIXED_DT);
    acc -= FIXED_DT;
    steps++;
  }

  fpsAcc += dt; fpsFrames++;
  if (fpsAcc >= 0.5) { fps = fpsFrames / fpsAcc; fpsAcc = 0; fpsFrames = 0; }

  render();
}

function update(dt) {
  if (down.has('ArrowLeft')) yawDeg -= TURN_RATE_DEG * dt;
  if (down.has('ArrowRight')) yawDeg += TURN_RATE_DEG * dt;
  yawDeg = ((yawDeg % 360) + 360) % 360;

  const forward = (down.has('KeyW') ? 1 : 0) - (down.has('KeyS') ? 1 : 0);
  const strafe = (down.has('KeyD') ? 1 : 0) - (down.has('KeyA') ? 1 : 0);
  const run = down.has('ShiftLeft') || down.has('ShiftRight');
  const jump = down.has('Space');

  if (!player.grounded) {
    if (lastZWhileAirborne === null) lastZWhileAirborne = player.z;
    maxFallDropThisAir = Math.max(maxFallDropThisAir, lastZWhileAirborne - player.z);
  } else {
    lastZWhileAirborne = null;
  }

  player.update(dt, { forward, strafe, run, jump, yawDeg }, level);
  if (player.landed) lastFallDistance = player.fallDistance; // US-009 HUD ("last fallDistance")
}

// --- rendering (top-down grid, adapted from worldTestMain.js's palette) ---

function render() {
  for (let row = 0; row < level.height; row++) {
    for (let col = 0; col < level.width; col++) {
      drawCell(col, row, level.sectorAt(col + 0.5, row + 0.5));
    }
  }

  // Player: footprint circle (true collision radius) + facing tick + eye dot.
  const px = player.x * CELL_PX, py = player.y * CELL_PX;
  const r = PHYSICS.radius * CELL_PX;
  ctx.fillStyle = player.grounded ? 'rgba(255,224,138,0.9)' : 'rgba(140,220,255,0.9)';
  ctx.beginPath();
  ctx.arc(px, py, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#3a2a00';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const rad = (player.yawDeg - 90) * Math.PI / 180;
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(px + Math.cos(rad) * r * 1.8, py + Math.sin(rad) * r * 1.8);
  ctx.strokeStyle = '#ffe08a';
  ctx.lineWidth = 2;
  ctx.stroke();

  hudEl.textContent =
    `pos (${player.x.toFixed(2)}, ${player.y.toFixed(2)})  z=${player.z.toFixed(2)}  ` +
    `vel (${player.vx.toFixed(2)}, ${player.vy.toFixed(2)}, ${player.vz.toFixed(2)})  ` +
    `grounded=${player.grounded}  yaw=${player.yawDeg.toFixed(0)}deg  fps=${fps.toFixed(0)}\n` +
    `coyote=${player.coyote.toFixed(3)}s  buffer=${player.buffer.toFixed(3)}s  ` +
    `eyeOffset=${player.feel.offset.toFixed(3)}m  last fallDistance=${lastFallDistance.toFixed(2)}m\n` +
    `last fall drop: ${maxFallDropThisAir.toFixed(2)} m  (eyeH ${PHYSICS.eyeHeight} m, radius ${PHYSICS.radius} m, ` +
    `walk ${PHYSICS.walkSpeed} m/s, run ${PHYSICS.runSpeed} m/s, gravity ${PHYSICS.gravity} m/s^2)`;
}

function drawCell(col, row, sector) {
  const x = col * CELL_PX, y = row * CELL_PX;
  ctx.fillStyle = cellColor(sector);
  ctx.fillRect(x, y, CELL_PX, CELL_PX);
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.strokeRect(x + 0.5, y + 0.5, CELL_PX - 1, CELL_PX - 1);
}

function clamp01(t) { return Math.max(0, Math.min(1, t)); }

function cellColor(sector) {
  if (sector.solid) {
    const base = sector.wallMat === 'stone_moss' ? [70, 105, 75] : [95, 95, 105];
    const shade = 1 - clamp01(sector.floorH / 9) * 0.45;
    return `rgb(${Math.round(base[0] * shade)},${Math.round(base[1] * shade)},${Math.round(base[2] * shade)})`;
  }
  if (sector.ceilH === 'sky') return '#274a63';
  if (sector.floorH < 0) return '#3a1c1c';
  const t = clamp01(sector.floorH / 1.2);
  return `rgb(${Math.round(60 + t * 140)},${Math.round(70 + t * 130)},${Math.round(80 + t * 90)})`;
}

// Manual/automated smoke-testing hook only - not part of the game's own UI
// (same pattern as main.js's window.__debug).
window.__physicsDebug = { level, get player() { return player; }, set player(p) { player = p; }, down };

requestAnimationFrame(tick);
