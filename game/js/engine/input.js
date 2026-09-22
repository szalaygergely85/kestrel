// Input: keyboard (US-001) + mouse delta (US-005, for pointer-lock look).
// Exposes isDown/pressed (edge-triggered) and consumeMouseDelta().

// Every key this game owns. preventDefault() is called for these (and only
// these) on keydown so the page never scrolls (arrows/space), triggers the
// browser's Find (F3), or otherwise leaks input to the browser chrome.
// Everything else (F5 reload, F12 devtools, Ctrl+... shortcuts, etc.) passes
// through untouched.
const GAME_KEYS = new Set([
  'F3', 'F6', 'F7',
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE',
  'Space', 'ShiftLeft', 'ShiftRight',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
]);

export class Input {
  constructor(target = window) {
    this._down = new Set();
    this._pressedThisFrame = new Set();
    this._mouseDX = 0;
    this._mouseDY = 0;

    // `movementX/Y` are raw deltas (unclamped by screen edges once pointer
    // lock is active); PlayerLook (US-005) only reads these while locked,
    // so accumulation while unlocked is harmless - just never consumed.
    this._onMouseMove = (e) => {
      this._mouseDX += e.movementX || 0;
      this._mouseDY += e.movementY || 0;
    };
    target.addEventListener('mousemove', this._onMouseMove);

    this._onKeyDown = (e) => {
      // Never swallow a browser/OS shortcut (Ctrl+F, Cmd+R, Alt+Tab, ...);
      // only intercept a bare game key.
      if (GAME_KEYS.has(e.code) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
      }
      if (!this._down.has(e.code)) {
        this._pressedThisFrame.add(e.code);
      }
      this._down.add(e.code);
    };
    this._onKeyUp = (e) => {
      this._down.delete(e.code);
    };
    this._onBlur = () => {
      // Release everything when the window loses focus so keys never get
      // "stuck" down.
      this._down.clear();
      this._mouseDX = 0;
      this._mouseDY = 0;
    };

    target.addEventListener('keydown', this._onKeyDown);
    target.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
  }

  isDown(code) {
    return this._down.has(code);
  }

  // Edge-triggered: true only once, on the sim step after the key went down.
  // Callers should poll this once per fixed update step and then clear via
  // endFrame().
  pressed(code) {
    return this._pressedThisFrame.has(code);
  }

  // Call once per rendered frame (after update/consumers have read
  // `pressed`) to clear the edge-triggered set.
  endFrame() {
    this._pressedThisFrame.clear();
  }

  // Returns accumulated raw mouse movement (device pixels) since the last
  // call, then resets it to zero - same "read once per step, then clears"
  // shape as `pressed`/`endFrame`. Meaningful only while pointer-locked
  // (see engine/playerLook.js); harmless to call otherwise.
  consumeMouseDelta() {
    const d = { dx: this._mouseDX, dy: this._mouseDY };
    this._mouseDX = 0;
    this._mouseDY = 0;
    return d;
  }
}
