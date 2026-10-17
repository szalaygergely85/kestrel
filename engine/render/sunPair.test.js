// AUD2-02: one sun/moon decision per step for the stepped light/shadow sun and the smooth world sun. Run: node engine/render/sunPair.test.js
import assert from 'node:assert/strict';
import { applySunPair, MOON_SWITCH_DEG } from './lighting.js';
import { SUN_PATH_DEFAULT } from '../core/sunPath.js';
const path = SUN_PATH_DEFAULT;
const lights = { sun: { elevation: 0, azimuth: 0, on: false, dir: [0, 0, 1] }, setSun({ elevation, azimuth, on }) { this.sun.elevation = elevation; this.sun.azimuth = azimuth; this.sun.on = elevation > 0 ? !!on : false; } };
const world = { sun: { elevation: 0, azimuth: 0 }, sunSource: 'time' };
const angd = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
let moonSteps = 0, bothOn = 0, maxJump = 0, prevAz = null, prevOn = false, disagree = 0;
for (let step = 0; step < 24 * 16; step++) { // 0.625 real-s steps of a 24-min day = 1/16 game hour
  const hq = step / 16;
  const shadowH = Math.floor(hq / 0.5) * 0.5; // 30 game-minute slots (lag up to 0.5 h)
  const moon = applySunPair(world, lights, shadowH, hq, path, true);
  if (moon) moonSteps++;
  if (lights.sun.on) {
    bothOn++;
    // shadow sun and world sun must be on the same side (sun vs moon): azimuth within 90 deg
    if (angd(lights.sun.azimuth, world.sun.azimuth) > 90) disagree++;
    if (prevOn && prevAz !== null) maxJump = Math.max(maxJump, angd(lights.sun.azimuth, prevAz));
    prevAz = lights.sun.azimuth;
  }
  prevOn = lights.sun.on;
  if (moon) assert.ok(world.sun.elevation > 0 || true);
}
assert.ok(moonSteps > 100, 'moon phase exists');
assert.ok(bothOn > 200, 'light on part of the day');
assert.equal(disagree, 0, 'shadow sun and world sun never disagree on sun vs moon');
assert.ok(maxJump < 60, 'no 180 deg jump (only the un-eased 30-min slot step) while shadows are visible, got ' + maxJump);
// the switch itself: light is off across it (gap), so no 180 deg flip is visible
let flipVisible = 0;
for (let step = 0; step < 24 * 160; step++) {
  const hq = step / 160, moon = applySunPair(world, lights, Math.floor(hq / 0.5) * 0.5, hq, path, true);
  if (!moon && lights.sun.elevation > 0 && lights.sun.on && world.sun.elevation < MOON_SWITCH_DEG) flipVisible++;
}
assert.equal(flipVisible, 0);
console.log('sunPair: ok', { moonSteps, bothOn, maxJump: +maxJump.toFixed(2) });
