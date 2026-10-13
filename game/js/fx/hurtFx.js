// HURT-FX-01 (lane B1), trimmed after the de-dup vs US-080a2: the hurt vignette (drawHurtEdge) and the pitch kick (kickDeg)
// already live in quest/vitalsView.js (owner-tested) and are NOT repeated here. What US-080a2 lacks and this keeps:
// the low-hearts (<= 1 heart) slow red pulse on the outer 2 cells at 1.2 Hz. No allocation per step/draw.
// Hearts: vitals counts hp (30 max); one heart = `hpPerHeart` hp (default 5).

export const HURT_FX = Object.freeze({ pulseHz: 1.2, pulseAlpha: 0.28, lowHearts: 1, vignetteCells: 2 });

export function createHurtFx(opts = {}) {
  const hpPerHeart = opts.hpPerHeart || 5;
  const enabled = opts.enabled !== false;
  const reduced = typeof opts.reduceMotion === 'function' ? opts.reduceMotion : () => false; // SETTINGS-APPLY-01: static tint
  let pulseT = 0, lowHp = false;
  const C = HURT_FX;

  const fx = {
    /** dtMs real/sim ms; hp current hp; alive false disables the pulse. Call once per tick. */
    step(dtMs, hp, alive = true) {
      if (!enabled) return;
      pulseT += dtMs;
      lowHp = alive && hp > 0 && hp <= C.lowHearts * hpPerHeart;
    },
    reset() { pulseT = 0; lowHp = false; },
    /** 0..pulseAlpha: slow cosine pulse while at <= 1 heart, else 0. */
    pulse() { return lowHp && reduced() ? C.pulseAlpha * 0.5 : lowHp ? C.pulseAlpha * (0.5 - 0.5 * Math.cos(2 * Math.PI * C.pulseHz * pulseT / 1000)) : 0; },
    /** Outer `vignetteCells` ring of the ui layer: ragged red cells, density follows the pulse. */
    draw(ui) {
      const a = fx.pulse();
      if (a < 0.01) return;
      const cols = ui.cols, rows = ui.rows, n = C.vignetteCells;
      const cov = Math.min(1, a / C.pulseAlpha) * 0.9;
      const g = (170 * a / C.pulseAlpha) | 0;
      for (let r = 0; r < n; r++) {
        const dens = cov * (r === 0 ? 1 : 0.55);
        for (let x = 0; x < cols; x++) { cell(ui, x, r, dens, g); cell(ui, x, rows - 1 - r, dens, g); }
        for (let y = n; y < rows - n; y++) { cell(ui, r, y, dens, g); cell(ui, cols - 1 - r, y, dens, g); }
      }
    },
    get active() { return enabled; },
  };
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
