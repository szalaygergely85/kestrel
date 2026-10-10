// WS1-07b (D-057 / D-060, architecture 38.36 item 4): travel from the map card. Pure fixed-step state machine:
// idle -> out (fade to black, input locked) -> [teleport once at black] -> in (fade up) -> idle.
// Host callbacks do the world work (transform, hzb, beasts, targeting, vitals, respawn point); this file owns timing + gates.
// Per step: no allocation (the draw/step results are reused fields).

export const TRAVEL_FADE_SEC = 0.35;
export const TRAVEL_MIN_DIST_M = 6;
export const TOAST_HERE = 'Already here.'; // docs/story.md toast.travel.here
export const TOAST_SEC = 2.5;

const smooth = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

/**
 * @param {object} o
 * @param {() => boolean} o.canTravel  alive, no dialogue / inventory / quest log, wake intro done
 * @param {(id:string) => ({x:number,y:number,z:number,yawDeg:number}|null)} o.anchorOf  stored travel anchor or null
 * @param {() => ({x:number,y:number})} o.playerPos
 * @param {(pose) => void} o.teleport  at black: transform, zero velocity, re-ground, hzb/beasts/targeting/vitals resets
 * @param {(id:string, pose) => void} o.arrive  at black, after teleport: target becomes the respawn point (touch = heal + save)
 * @param {() => boolean} [o.bandReady]  WS2-05: false while the target's terrain band is still baking; the fade-in waits (screen stays black)
 * @param {(pose) => boolean} [o.inBounds]  target must be inside the walk bounds (else refused)
 */
export function createTravel(o) {
  const fadeSec = o.fadeSec ?? TRAVEL_FADE_SEC, minDist = o.minDistM ?? TRAVEL_MIN_DIST_M;
  let phase = 'idle', t = 0, targetId = null, targetPose = null, toastLeft = 0, teleports = 0;
  const st = {
    get phase() { return phase; },
    get alpha() { return phase === 'out' ? smooth(t / fadeSec) : phase === 'in' ? 1 - smooth(t / fadeSec) : 0; },
    get inputLocked() { return phase !== 'idle'; },
    get toastLeft() { return toastLeft; },
    get teleports() { return teleports; },
    /** @returns {'ok'|'busy'|'blocked'|'unknown'|'bounds'|'here'} */
    request(id, force = false) { // force = dev/test hook only (headless has no wake/pointer lock)
      if (phase !== 'idle') return 'busy';
      if (!force && !o.canTravel()) return 'blocked';
      const a = o.anchorOf(id);
      if (!a) return 'unknown';
      if (o.inBounds && !o.inBounds(a)) return 'bounds';
      const p = o.playerPos();
      if (Math.hypot(p.x - a.x, p.y - a.y) <= minDist) { toastLeft = TOAST_SEC; return 'here'; }
      phase = 'out'; t = 0; targetId = id; targetPose = a;
      return 'ok';
    },
    /** fixed or frame step, dt seconds */
    step(dt) {
      if (toastLeft > 0) toastLeft -= dt;
      if (phase === 'out') {
        t += dt;
        if (t >= fadeSec) { // black: do the jump exactly once, then fade in
          o.teleport(targetPose); o.arrive(targetId, targetPose); teleports++;
          phase = 'in'; t = 0;
        }
      } else if (phase === 'in') {
        if (o.bandReady && !o.bandReady()) return; // black until the band is ready
        t += dt;
        if (t >= fadeSec) { phase = 'idle'; t = 0; targetId = null; targetPose = null; }
      }
    },
    /** Dither the ui layer dark by alpha (ui cells have no alpha; same idea as deathFade) + the "here" toast. */
    draw(ui, cols = ui.cols, rows = ui.rows) {
      const a = st.alpha;
      if (a > 0.004) {
        const solid = a >= 0.996;
        for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
          if (!solid) { const h = (((x * 73856093) ^ (y * 19349663)) >>> 0) % 1000; if (h >= a * 1000) continue; }
          ui.setCellRGB(x, y, 0, 0, 0, 0, 0, 0, 0);
        }
      }
      if (toastLeft > 0 && a < 0.5) {
        const s = TOAST_HERE;
        for (let j = -1; j <= s.length; j++) {
          const c = j < 0 || j >= s.length ? 0 : s.charCodeAt(j) - 32;
          if (2 + j >= 0 && 2 + j < cols) ui.setCellRGB(2 + j, 3, c, 236, 226, 190, 10, 11, 16);
        }
      }
    },
  };
  return st;
}
