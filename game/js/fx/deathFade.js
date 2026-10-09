// DEATH-FLOW-01 part 1 (lane B1): death fade-to-dark + one centred line, then fade-in after respawn.
// Pure `fadeAt` (no alloc: returns a reused object) + a tiny controller. Draws on the ui layer by dithered
// coverage (ui cells have no alpha): a cell goes black when its hash < alpha, so it works on WebGPU too.

export const DEATH_FADE = Object.freeze({ fadeOutMs: 1000, textDelayMs: 300, textFadeMs: 400, fadeInMs: 400 });
export const DEATH_LINE = 'Dark again. The light still blinks.'; // text key: death.line

const out = { alpha: 0, textAlpha: 0 };
const ease = (u) => u * u * (3 - 2 * u); // smoothstep

/** t ms since death -> {alpha: 0..1 darkness, textAlpha: 0..1}. Result object is reused (read, don't keep). */
export function fadeAt(tMs) {
  const C = DEATH_FADE;
  const u = tMs <= 0 ? 0 : tMs >= C.fadeOutMs ? 1 : tMs / C.fadeOutMs;
  const v = (tMs - C.textDelayMs) / C.textFadeMs;
  out.alpha = ease(u);
  out.textAlpha = v <= 0 ? 0 : v >= 1 ? 1 : ease(v);
  return out;
}

/** t ms since respawn -> darkness 1..0 (fade-in). */
export function fadeInAt(tMs) {
  const u = tMs <= 0 ? 0 : tMs >= DEATH_FADE.fadeInMs ? 1 : tMs / DEATH_FADE.fadeInMs;
  return 1 - ease(u);
}

export function createDeathFlow({ onRespawn, enabled = true } = {}) {
  let phase = 'idle', t0 = 0, fired = false;
  const res = { alpha: 0, textAlpha: 0, inputLocked: false };
  const flow = {
    /** player:died. Ignored when disabled or already fading. */
    died(nowMs) { if (!enabled || phase !== 'idle') return; phase = 'out'; t0 = nowMs; fired = false; },
    /** The respawn happened (vitals reset): start the fade-in. */
    respawned(nowMs) { if (phase === 'out' || phase === 'wait') { phase = 'in'; t0 = nowMs; } },
    step(nowMs) {
      if (phase === 'out' || phase === 'wait') {
        const f = fadeAt(nowMs - t0);
        res.alpha = f.alpha; res.textAlpha = f.textAlpha; res.inputLocked = true;
        if (nowMs - t0 >= DEATH_FADE.fadeOutMs && !fired) { fired = true; phase = 'wait'; if (onRespawn) onRespawn(); }
      } else if (phase === 'in') {
        const d = fadeInAt(nowMs - t0);
        res.alpha = d; res.textAlpha = 0; res.inputLocked = false;
        if (d <= 0) phase = 'idle';
      } else { res.alpha = 0; res.textAlpha = 0; res.inputLocked = false; }
      return res;
    },
    /** Dither the screen dark + centred line. Call after step(). */
    draw(ui, cols = ui.cols, rows = ui.rows) {
      const a = res.alpha;
      if (a <= 0.004) return;
      const solid = a >= 0.996;
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        if (!solid) { const h = (((x * 73856093) ^ (y * 19349663)) >>> 0) % 1000; if (h >= a * 1000) continue; }
        ui.setCellRGB(x, y, 0, 0, 0, 0, 0, 0, 0);
      }
      if (res.textAlpha > 0.01 && a > 0.5) {
        const g = (200 * res.textAlpha) | 0, s = DEATH_LINE, x0 = ((cols - s.length) >> 1), y0 = rows >> 1;
        for (let i = 0; i < s.length; i++) ui.setCellRGB(x0 + i, y0, s.charCodeAt(i) - 32, g, g, (g * 0.9) | 0, 0, 0, 0);
      }
    },
    get phase() { return phase; },
    get active() { return enabled; },
  };
  return flow;
}

/** Off in capture/bench/compare modes and under ?fx=0. */
export function deathFlowEnabled(params, captureLike) {
  return !captureLike && params.get('capture') !== '1' && params.get('fx') !== '0';
}
