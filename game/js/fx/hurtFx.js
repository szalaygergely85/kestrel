// HURT-FX-01 (lane B1): pure hurt feedback. Red vignette on the outer 2 cells, render-only camera kick, low-hearts pulse.
// No allocation per step/draw. The kick is a pitch OFFSET for the render camera copy only; physics/look never see it.
// Hearts: vitals counts hp (30 max); one heart = `hpPerHeart` hp (default 5). Hurt = hp dropped since the last step.

export const HURT_FX = Object.freeze({
  vignetteAlpha: 0.6, vignetteMs: 350, vignetteCells: 2,
  kickDeg: 1.2, kickMs: 200, capHearts: 2,
  pulseHz: 1.2, pulseAlpha: 0.28, lowHearts: 1,
});

export function createHurtFx(opts = {}) {
  const hpPerHeart = opts.hpPerHeart || 5;
  const enabled = opts.enabled !== false;
  let lastHp = -1, vigAge = 1e9, kickAge = 1e9, kickAmp = 0, pulseT = 0, lowHp = false;
  const C = HURT_FX;

  const fx = {
    /** dtMs real/sim ms; hp current hp; alive false disables the pulse. Call once per tick. */
    step(dtMs, hp, alive = true) {
      if (!enabled) return;
      if (lastHp >= 0 && hp < lastHp) fx.hurt((lastHp - hp) / hpPerHeart);
      lastHp = hp;
      vigAge += dtMs; kickAge += dtMs; pulseT += dtMs;
      lowHp = alive && hp > 0 && hp <= C.lowHearts * hpPerHeart;
    },
    /** Hearts lost (fractional ok). Stacking hits restart the envelopes but never exceed the caps. */
    hurt(hearts) {
      if (!enabled || !(hearts > 0)) return;
      const k = C.kickDeg * Math.min(hearts, C.capHearts) / C.capHearts;
      kickAmp = Math.min(C.kickDeg, kickAmpNow() + k);
      kickAge = 0; vigAge = 0;
    },
    reset() { lastHp = -1; vigAge = kickAge = 1e9; kickAmp = 0; pulseT = 0; lowHp = false; },
    /** 0.6 -> 0 over 350 ms, linear; at least the low-hearts pulse. */
    vignette() {
      const env = vigAge >= C.vignetteMs ? 0 : C.vignetteAlpha * (1 - vigAge / C.vignetteMs);
      const pulse = lowHp ? C.pulseAlpha * (0.5 - 0.5 * Math.cos(2 * Math.PI * C.pulseHz * pulseT / 1000)) : 0;
      return env > pulse ? env : pulse;
    },
    /** Pitch offset (deg) for the render camera copy; linear decay over 200 ms. */
    kick() { return kickAmpNow(); },
    /** Outer `vignetteCells` ring of the ui layer: ragged red cells, density follows alpha. */
    draw(ui) {
      const a = fx.vignette();
      if (a < 0.01) return;
      const cols = ui.cols, rows = ui.rows, n = C.vignetteCells;
      const cov = Math.min(1, a / C.vignetteAlpha) * 0.9;
      const g = (170 * a / C.vignetteAlpha) | 0;
      for (let r = 0; r < n; r++) {
        const dens = cov * (r === 0 ? 1 : 0.55);
        for (let x = 0; x < cols; x++) { cell(ui, x, r, dens, g); cell(ui, x, rows - 1 - r, dens, g); }
        for (let y = n; y < rows - n; y++) { cell(ui, r, y, dens, g); cell(ui, cols - 1 - r, y, dens, g); }
      }
    },
    get active() { return enabled; },
  };
  function kickAmpNow() { return kickAge >= C.kickMs ? 0 : kickAmp * (1 - kickAge / C.kickMs); }
  return fx;
}

function cell(ui, x, y, dens, g) {
  const h = ((x * 73856093) ^ (y * 19349663)) >>> 0;
  if ((h % 100) >= dens * 100) return;
  ui.setCellRGB(x, y, 58 - 32, g, 20, 20, (g * 0.45) | 0, 0, 0); // ':' (code = char - 32)
}

/** Off in capture/bench/compare modes and under ?fx=0. */
export function hurtFxEnabled(params, captureLike) {
  return !captureLike && params.get('capture') !== '1' && params.get('fx') !== '0';
}
