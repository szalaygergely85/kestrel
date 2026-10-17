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
  let age = -1, value = -1, label = '';
  return {
    touch() { age = 0; },
    step(dt) { if (age >= 0) age += dt; },
    alpha() { return coinAlpha(age, holdSec, fadeSec); },
    /** Draw next to the hearts: row `y`, column `x`. Fades the text colour toward the bar background. */
    draw(ui, x, y, bg, visible) {
      const a = visible ? this.alpha() : 0;
      if (a <= 0) return;
      const raw = get(), next = Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
      if (next !== value) { value = next; label = coinLabel(next); }
      const r = (bg[0] + (COIN_FG[0] - bg[0]) * a) | 0;
      const g = (bg[1] + (COIN_FG[1] - bg[1]) * a) | 0;
      const b = (bg[2] + (COIN_FG[2] - bg[2]) * a) | 0;
      for (let i = 0; i < label.length + 1; i++) {
        const code = i < label.length ? label.charCodeAt(i) - 32 : 0;
        ui.setCellRGB(x + i, y, code, r, g, b, bg[0] | 0, bg[1] | 0, bg[2] | 0);
      }
    },
  };
}
