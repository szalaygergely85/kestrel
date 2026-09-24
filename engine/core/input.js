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
  // US-015 (docs/architecture.md 7.6 item 5): KeyM opens/closes the map
  // card; KeyN is reserved for mute (US-020) - nothing binds it yet.
  'KeyM', 'KeyN',
]);

export class Input {
  constructor(target = window) {
    this._down = new Set();
    this._pressedThisFrame = new Set();
    this._mouseDX = 0;
    this._mouseDY = 0;
    // US-015 (7.6 item 5): codes "consumed" by `consumePressed()` this
    // frame - ignored by `isDown`/future `pressed` edges until their own
    // keyup, even through OS auto-repeat keydown events (which would
    // otherwise re-arm `_pressedThisFrame` every repeat interval).
    this._consumed = new Set();

    // `movementX/Y` are raw deltas (unclamped by screen edges once pointer
    // lock is active). Input itself doesn't know about lock state, so it
    // accumulates every mousemove unconditionally; PlayerLook (US-005) is
    // responsible for draining/discarding this every step - including while
    // unlocked, and again on the transition to locked - so stale movement
    // never applies as a single jump on resume (PO REJECT #1).
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
      if (this._consumed.has(e.code)) return; // still "ignored" until its own keyup
      if (!this._down.has(e.code)) {
        this._pressedThisFrame.add(e.code);
      }
      this._down.add(e.code);
    };
    this._onKeyUp = (e) => {
      this._down.delete(e.code);
      this._consumed.delete(e.code);
    };
    this._onMouseDown = (e) => {
      if (e.button !== 0) return; // US-015: only the left button is a game input ('Mouse0')
      if (this._consumed.has('Mouse0')) return;
      if (!this._down.has('Mouse0')) this._pressedThisFrame.add('Mouse0');
      this._down.add('Mouse0');
    };
    this._onMouseUp = (e) => {
      if (e.button !== 0) return;
      this._down.delete('Mouse0');
      this._consumed.delete('Mouse0');
    };
    this._onBlur = () => {
      // Release everything when the window loses focus so keys never get
      // "stuck" down.
      this._down.clear();
      this._consumed.clear();
      this._mouseDX = 0;
      this._mouseDY = 0;
    };

    target.addEventListener('keydown', this._onKeyDown);
    target.addEventListener('keyup', this._onKeyUp);
    target.addEventListener('mousedown', this._onMouseDown);
    target.addEventListener('mouseup', this._onMouseUp);
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

  // US-015 (7.6 item 5): true if ANY key or 'Mouse0' went down this frame -
  // used by mapCard.js's "any key or mouse click dismisses" rule.
  anyPressed() {
    return this._pressedThisFrame.size > 0;
  }

  // US-015: consumes every code pressed THIS frame - removed from `pressed`
  // (this call's `endFrame()` never re-adds it) and ignored by `isDown`
  // until its own keyup, so "the dismissing key is consumed" (it cannot
  // also move/jump/interact the same frame, nor keep firing while held via
  // OS auto-repeat).
  consumePressed() {
    for (const code of this._pressedThisFrame) {
      this._consumed.add(code);
      this._down.delete(code);
    }
    this._pressedThisFrame.clear();
  }

  // Returns accumulated raw mouse movement (device pixels) since the last
  // call, then resets it to zero - same "read once per step, then clears"
  // shape as `pressed`/`endFrame`. PlayerLook calls this every step - while
  // locked to get real look input, while unlocked purely to discard
  // whatever accumulated (see engine/playerLook.js).
  consumeMouseDelta() {
    const d = { dx: this._mouseDX, dy: this._mouseDY };
    this._mouseDX = 0;
    this._mouseDY = 0;
    return d;
  }
}
