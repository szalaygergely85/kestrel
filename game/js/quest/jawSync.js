// game/js/quest/jawSync.js (NPC-TALK-ANIM-01, architecture.md 38.28 item 7/13).
// Drives `components.voxel.partRot` (part 'jaw') from the dialogue runner's typed text:
// vowel -> open, other letter/digit -> half, space/punctuation/none -> closed.
// Zero allocation per step: partRot is created once per component and mutated in place.

export const JAW_OPEN_DEG_DEFAULT = 18; // DESIGN: bear jaw angle pending (designer: def.jawOpenDeg in voxel_bear.js)
export const JAW_ATTACK_MS = 40;
export const JAW_RELEASE_MS = 35; // 18 deg -> < 0.5 deg in ~125 ms (< 0.15 s)
export const JAW_PART = 'jaw';

/** 0 closed, 1 half, 2 open for one char code. */
export function jawLevel(c) {
  const lo = c | 0x20;
  if (lo >= 97 && lo <= 122) { // a-z / A-Z
    return lo === 97 || lo === 101 || lo === 105 || lo === 111 || lo === 117 ? 2 : 1;
  }
  return c >= 48 && c <= 57 ? 1 : 0;
}

/** Max open angle from a model def (`def.jawOpenDeg`), else the fallback. */
export function jawMaxOf(def) {
  return def && def.jawOpenDeg > 0 ? def.jawOpenDeg : JAW_OPEN_DEG_DEFAULT;
}

/** @param {{maxDeg?:number}} [opt] */
export function createJawSync(opt = {}) {
  const maxDeg = opt.maxDeg > 0 ? opt.maxDeg : JAW_OPEN_DEG_DEFAULT;
  const kA = JAW_ATTACK_MS / 1000, kR = JAW_RELEASE_MS / 1000;
  const sync = {
    maxDeg, angle: 0, target: 0,
    /** Target angle for the runner right now (typing, NPC speaker only). */
    targetOf(runner) {
      if (!runner || runner.state !== 'typing' || runner.isPlayer || runner.visibleChars <= 0) return 0;
      const lv = jawLevel(runner.line.charCodeAt(runner.visibleChars - 1));
      return lv === 2 ? maxDeg : lv === 1 ? maxDeg * 0.5 : 0;
    },
    /** Advance by dt seconds; writes into comp.partRot (created once). Returns the angle. */
    step(dt, runner, comp) {
      const t = sync.target = sync.targetOf(runner);
      const k = t > sync.angle ? kA : kR;
      sync.angle += (t - sync.angle) * (1 - Math.exp(-dt / k));
      if (sync.angle < 0.01 && t === 0) sync.angle = 0;
      if (sync.angle > maxDeg) sync.angle = maxDeg;
      if (comp) {
        let pr = comp.partRot;
        if (!pr) pr = comp.partRot = { part: JAW_PART, rx: 0, ry: 0, rz: 0 };
        pr.rx = sync.angle;
      }
      return sync.angle;
    },
  };
  return sync;
}
