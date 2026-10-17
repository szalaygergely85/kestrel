// CUR-02 (D-121): coin display. Pure helpers (text, fade timer) + a tiny HUD view. "Coin N" shows for COIN_HUD_SEC
// after each 'wallet:changed', then fades over COIN_FADE_SEC. COIN_HUD_SEC = 0 means always on (owner may ask for it).
export const COIN_HUD_SEC = 3.0;
export const COIN_FADE_SEC = 0.5;
export const COIN_FG = [226, 214, 176];

/** "Coin 12" - plain text shared by the HUD and the inventory screen. */
export const coinLabel = (n) => 'Coin ' + (Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0);

/** Brightness 0..1 of the HUD line `age` seconds after the last change (age < 0 = never changed). */
export function coinAlpha(age, holdSec = COIN_HUD_SEC, fadeSec = COIN_FADE_SEC) {
  if (holdSec === 0) return 1;
  if (!(age >= 0) || age >= holdSec + fadeSec) return 0;
  if (age <= holdSec) return 1;
  return 1 - (age - holdSec) / fadeSec;
}

/** HUD view. `value` is read via get(); `touch()` (call on wallet:changed) restarts the timer. Draw is a no-op when hidden. */
export function createCoinHud({ get, holdSec = COIN_HUD_SEC, fadeSec = COIN_FADE_SEC } = {}) {
  let age = -1;
  return {
    touch() { age = 0; },
    step(dt) { if (age >= 0) age += dt; },
    alpha() { return coinAlpha(age, holdSec, fadeSec); },
    /** Draw next to the hearts: row `y`, column `x`. Fades the text colour toward the bar background. */
    draw(ui, x, y, bg, visible) {
      const a = visible ? this.alpha() : 0;
      if (a <= 0) return;
      const s = coinLabel(get());
      const f = (c, i) => (bg[i] + (c - bg[i]) * a) | 0;
      for (let i = 0; i < s.length + 1; i++) {
        const code = i < s.length ? s.charCodeAt(i) - 32 : 0;
        ui.setCellRGB(x + i, y, code, f(COIN_FG[0], 0), f(COIN_FG[1], 1), f(COIN_FG[2], 2), bg[0] | 0, bg[1] | 0, bg[2] | 0);
      }
    },
  };
}
