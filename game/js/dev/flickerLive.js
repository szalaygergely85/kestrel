// AA-01 (docs/architecture.md 38.82): `?flickerlive=1&at=<x,y,0,yaw,pitch>` = measure flicker on the LIVE overworld.
// Per pose: 30 steps of 5 cm strafe + 5 cm forward in a static scene (wind speed 0, fb.timeSec 0, clock frozen by ?at),
// after each step the N vs N-1 frame is compared with flickerStep -> totalPct + colourPct, averaged over the steps.
// main.js calls `beforeRender(cam, world)` before the frame is drawn and `afterPresent()` after rt.present().
import { flickerStep } from '../../../engine/index.js';

export const STEP_M = 0.05, STEPS = 30, EYE_H = 1.6;

// Poses (groundEye: z = terrain ground + EYE_H). wallNear = the tower wall pose of the spec; wallFar = 14 m further back
// along the view axis (~20 m); bushes = Burl's bush (world_m1 burlBush 1470.6,1030.9) from 3.6 m; crown / grassFar are
// provisional spots (crown: Northwood canopy looked up at; grassFar: meadow outside the tower, grass carpet + decor,
// looking over grass 10-40 m away) - the main session may retune them.
export const POSES = [
  { slug: 'wallNear', x: 1496.91, y: 1026.06, yawDeg: 333, pitchDeg: 1, groundEye: true },
  { slug: 'wallFar', x: 1503.27, y: 1038.53, yawDeg: 333, pitchDeg: 1, groundEye: true },
  { slug: 'bushes', x: 1474.2, y: 1030.9, yawDeg: 270, pitchDeg: 0, groundEye: true },
  { slug: 'crown', x: 1550.75, y: 550.66, yawDeg: 155, pitchDeg: 25, groundEye: true },
  { slug: 'grassFar', x: 1496, y: 1040, yawDeg: 0, pitchDeg: -5, groundEye: true },
];

/** One 5 cm strafe + 5 cm forward move for a camera with yawDeg (forward = (sin, -cos), right = (cos, sin)). */
export function stepCam(cam, m = STEP_M) {
  const r = cam.yawDeg * Math.PI / 180;
  return { ...cam, x: cam.x + (Math.sin(r) + Math.cos(r)) * m, y: cam.y + (-Math.cos(r) + Math.sin(r)) * m };
}

export function createFlickerLive() {
  let waiters = [];
  const h = {
    cam: null, // when set, beforeRender overwrites the game's camera with it
    beforeRender(cam, world) {
      if (!h.cam) return;
      if (world && world.wind && world.wind.params) world.wind.params.speed = 0; // static scene
      cam.x = h.cam.x; cam.y = h.cam.y; cam.z = h.cam.z; cam.yawDeg = h.cam.yawDeg; cam.pitchDeg = h.cam.pitchDeg;
    },
    afterPresent() { if (waiters.length) { const w = waiters; waiters = []; for (const f of w) f(); } },
    nextFrame() { return new Promise((r) => waiters.push(r)); },
    async frames(k) { for (let i = 0; i < k; i++) await h.nextFrame(); },
  };
  return h;
}

/** Runs every pose; `capture()` -> { GI, fg, bg } of the frame just presented. Returns { poses: {slug: {totalPct, colourPct}}, ... }. */
export async function runLivePoses(h, { world, wg, cols, rows, capture, poses = POSES, steps = STEPS, settle = 30 }) {
  const out = {}, res = { poses: {}, steps, stepM: STEP_M };
  let sumT = 0, sumC = 0;
  for (const p of poses) {
    const gz = p.groundEye && world.terrain ? world.terrain.groundAt(p.x, p.y) + EYE_H : EYE_H;
    let cam = { x: p.x, y: p.y, z: gz, yawDeg: p.yawDeg, pitchDeg: p.pitchDeg };
    h.cam = cam;
    if (wg && wg.invalidateHistory) wg.invalidateHistory(); // each pose starts with a camera cut
    await h.frames(settle); // streaming (meshes, carpet, shadows) settles
    let prev = await capture();
    let t = 0, c = 0;
    for (let s = 0; s < steps; s++) {
      cam = stepCam(cam); h.cam = cam;
      await h.frames(2); // the first may be a frame already past beforeRender; the second certainly drew `cam`
      const cur = await capture();
      flickerStep(prev.GI, prev.fg, cur.GI, cur.fg, cols, rows, out, prev.bg, cur.bg);
      t += out.totalPct; c += out.colourPct; prev = cur;
    }
    res.poses[p.slug] = { totalPct: t / steps, colourPct: c / steps };
    sumT += t / steps; sumC += c / steps;
  }
  h.cam = null;
  res.avgTotalPct = sumT / poses.length; res.avgColourPct = sumC / poses.length;
  return res;
}
