// SPELL-R4 (D-021, D-115; docs/architecture.md 38.80): Teleport (blink). A collision-safe target along the camera aim; no engine API added.
// cast(level, eye, aim): eye = Float64Array(3) [x, y, feetZ], aim = Float64Array(3) unit look vector. -> 0 ok (blink hook called, mana spent) | 1 refused.
// Search: aim ray (raySegmentRay) -> back off in 0.5 m steps; each candidate is checked for bounds, floor/rise, headroom, swim-depth water,
// capsule fit (same collideCircle / moveCapsule branch as integrate.js step 4) and an eye-to-eye ray. First pass wins. Cold path, 0 allocation.
// Numbers: spellDefs.js only. No i-frames (D-113): this module never touches a damage flag.
import { PHYSICS, SIM_STEP, moveCapsule, sectorOrOutside, boundsOvershoot } from '../../../../engine/index.js';
import { SPELL_DEFS } from '../spellDefs.js';

export const BACKOFF_M = 0.5, MIN_D = 1.0, NO_ROOM = 'No room to blink.';
const GROUND_BELOW = 1.5, EPS = 0.05;
const tiers = SPELL_DEFS.teleport.tiers;

/** @param {any} world @param {{spendMana?:(n:number)=>boolean, blink:(x:number,y:number,z:number)=>void, loseTrack?:(x:number,y:number,r:number,sec:number)=>void, say?:(t:string)=>void}} hooks */
export function createTeleport(world, hooks) {
  const seg = new Float64Array(6), io = new Float64Array(10), hit = { t: 0, x: 0, y: 0, z: 0 };
  const wScratch = { surfaceZ: 0, flatZ: 0, depth: 0, region: '', index: -1, look: 0 };
  const mv = { x: 0, y: 0, blockedX: false, blockedY: false, nx: 0, ny: 0, overflow: false };
  const opts = { height: PHYSICS.height, stepUpMax: PHYSICS.stepUpMax, airStepUp: PHYSICS.stepUpMax, walkCos: Math.cos(PHYSICS.maxSlopeDeg * Math.PI / 180), maxSlopeDeg: PHYSICS.maxSlopeDeg };
  const R = PHYSICS.radius, EYE = PHYSICS.eyeHeight, H = PHYSICS.height;
  const st = new Float64Array(8); // 0 startFoot, 1 rise, 2 rayEyeZ, 3 slope az/h, 4 sx, 5 sy, 6 floor out, 7 target eye z
  let lastX = 0, lastY = 0, lastZ = 0, casts = 0, refused = 0, cooldown = 0;

  /** floor z -> io[3] (NaN-free: Infinity = none), ceiling -> io[9] (NaN = sky), steep -> io[8]. */
  function support(x, y, probeZ) {
    io[0] = x; io[1] = y; io[2] = probeZ;
    if (world.physicsMode === 'mesh') { world.supportAtOut(false, null, io); return; }
    const s = sectorOrOutside(world, x, y);
    io[3] = s.solid ? Infinity : s.floorH; io[8] = 0; io[9] = s.ceilH === 'sky' ? NaN : s.ceilH;
  }
  function fits(x, y, fz) {
    const m = world.physicsMode === 'mesh' ? world.collideCircle(x, y, 0, 0, R, fz, true, opts, mv) : moveCapsule(world, x, y, 0, 0, R, fz, true, opts, mv);
    const ex = m.x - x, ey = m.y - y;
    return ex * ex + ey * ey < 1e-6 && !m.blockedX && !m.blockedY;
  }
  function ok(x, y) {
    if (world.bounds && boundsOvershoot(world.bounds, x, y, R) > -0.05) return false; // a
    support(x, y, st[0] + st[1] + EPS); // b
    const fz = io[3], ceil = io[9];
    if (!(fz <= st[0] + st[1]) || fz < st[2] - EYE - GROUND_BELOW || io[8] !== 0) return false;
    if (!(ceil !== ceil || ceil - fz >= H + EPS)) return false; // c
    if (world.waterAt(x, y, wScratch) && wScratch.depth >= PHYSICS.swim.swimIn) return false; // d (io read first, waterAt may reuse the mesh scratch)
    if (!fits(x, y, fz)) return false; // e
    seg[0] = st[4]; seg[1] = st[5]; seg[2] = st[0] + EYE; seg[3] = x; seg[4] = y; seg[5] = fz + EYE; // f
    if (world.raySegmentRay(seg, hit)) return false;
    st[6] = fz;
    return true;
  }

  return {
    get cooldown() { return cooldown; },
    /** once per sim step (cd in steps). */
    step() { if (cooldown > 0) cooldown--; },
    get casts() { return casts; }, get refused() { return refused; },
    get lastX() { return lastX; }, get lastY() { return lastY; }, get lastZ() { return lastZ; },
    /** @param {number} level 1..3 @param {Float64Array} eye [x,y,feetZ] @param {Float64Array} aim unit look vector -> 0 ok | 1 refused */
    cast(level, eye, aim) {
      if (cooldown > 0) return 1; // busy: no toast, no mana
      const row = tiers[(level < 1 ? 1 : level > 3 ? 3 : level | 0) - 1];
      const hz = Math.sqrt(aim[0] * aim[0] + aim[1] * aim[1]);
      st[0] = eye[2]; st[1] = row.rise; st[4] = eye[0]; st[5] = eye[1];
      let found = false;
      if (hz > 1e-6) {
        seg[0] = eye[0]; seg[1] = eye[1]; seg[2] = eye[2] + EYE; seg[3] = eye[0] + aim[0] * row.dist; seg[4] = eye[1] + aim[1] * row.dist; seg[5] = eye[2] + EYE + aim[2] * row.dist;
        let len = row.dist;
        if (world.raySegmentRay(seg, hit)) len = hit.t * row.dist - (R + EPS);
        const ux = aim[0] / hz, uy = aim[1] / hz, slope = aim[2] / hz;
        for (let d = len * hz; d >= MIN_D - 1e-9; d -= BACKOFF_M) {
          st[2] = eye[2] + EYE + slope * d; // ray eye z at this horizontal distance; floor must not be > 1.5 m below the ray foot
          if (ok(eye[0] + ux * d, eye[1] + uy * d)) { found = true; lastX = eye[0] + ux * d; lastY = eye[1] + uy * d; lastZ = st[6]; break; }
        }
      }
      if (!found) { refused++; if (hooks.say) hooks.say(NO_ROOM); return 1; }
      if (hooks.spendMana && !hooks.spendMana(row.mana)) return 1; // no mana: nothing happens (the caller shows its own hint)
      casts++; cooldown = Math.round(row.cd / SIM_STEP);
      if (hooks.loseTrack && row.loseTrack > 0) hooks.loseTrack(eye[0], eye[1], row.loseTrackR, row.loseTrack);
      hooks.blink(lastX, lastY, lastZ);
      return 0;
    },
    /** cd/mana bookkeeping lives in the caller (spellCast / quickbar); only counters here. */
    hashInto(h) { h.u32(casts); h.u32(refused); h.u32(cooldown); },
  };
}
