// F3 debug overlay: fps + frame time (ms) in the top-left corner. Drawn
// straight onto the DOM (not into the glyph grid) so it is always legible
// regardless of whatever the grid itself is currently showing.
//
// A "copy" button under the text copies the overlay text plus the page URL
// to the clipboard, so bug reports (pose, backend, timings) can be pasted
// as-is. The button is only clickable while the pointer is unlocked (Esc).

export class DebugOverlay {
  constructor(root = document.body) {
    this.visible = false;
    this._lastRefresh = -Infinity; // US-018: shouldRefresh() throttle state

    this.wrap = document.createElement('div');
    Object.assign(this.wrap.style, {
      position: 'fixed',
      top: '4px',
      left: '4px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-start',
      gap: '2px',
      pointerEvents: 'none',
      zIndex: 1000,
    });

    this.el = document.createElement('div');
    this.el.id = 'debug-overlay';
    Object.assign(this.el.style, {
      padding: '4px 8px',
      font: '12px "Courier New", monospace',
      color: '#7CFC7C',
      background: 'rgba(0,0,0,0.6)',
      whiteSpace: 'pre',
      pointerEvents: 'none',
      display: 'none',
    });

    this.copyBtn = document.createElement('button');
    this.copyBtn.type = 'button';
    this.copyBtn.textContent = 'copy';
    this.copyBtn.title = 'Copy debug info and URL to the clipboard (press Esc first to free the mouse)';
    Object.assign(this.copyBtn.style, {
      font: '12px "Courier New", monospace',
      color: '#7CFC7C',
      background: 'rgba(0,0,0,0.75)',
      border: '1px solid #7CFC7C',
      padding: '1px 8px',
      cursor: 'pointer',
      pointerEvents: 'auto',
      display: 'none',
    });
    this.copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.copy();
    });

    this.wrap.appendChild(this.el);
    this.wrap.appendChild(this.copyBtn);
    root.appendChild(this.wrap);

    // Report modes (?gpucompare, ?shadetest, ?bench) show `el` directly, so
    // the button follows `el`'s own display instead of `visible`.
    const sync = () => { this.copyBtn.style.display = this.el.style.display === 'none' ? 'none' : 'block'; };
    if (typeof MutationObserver !== 'undefined') {
      new MutationObserver(sync).observe(this.el, { attributes: true, attributeFilter: ['style'] });
    }
    this._sync = sync;
  }

  toggle() {
    this.visible = !this.visible;
    this.el.style.display = this.visible ? 'block' : 'none';
    this._sync();
  }

  update(fps, frameMs, extra = '') {
    if (!this.visible) return;
    this.el.textContent = `fps: ${fps.toFixed(1)}\nframe: ${frameMs.toFixed(2)} ms${extra ? '\n' + extra : ''}`;
  }

  /**
   * US-018 (architecture.md 16, "allocation rule for the overlay"): true at
   * most once every 250 ms, and only while `visible` - callers build their
   * (string-allocating) overlay text ONLY inside `if (shouldRefresh(now))`,
   * so the hidden path costs nothing beyond this one comparison.
   */
  shouldRefresh(nowMs) {
    if (!this.visible) return false;
    if (nowMs - this._lastRefresh < 250) return false;
    this._lastRefresh = nowMs;
    return true;
  }

  /** Sets the overlay text directly (bench/report modes bypass `update()`'s fps/frame prefix). */
  setText(str) {
    this.el.textContent = str;
  }

  /** Copies the current overlay text + URL + timestamp. Returns a promise. */
  copy() {
    const text = `${this.el.textContent}\nurl: ${location.href}\ntime: ${new Date().toISOString()}`;
    const done = (ok) => {
      this.copyBtn.textContent = ok ? 'copied ✓' : 'copy failed';
      setTimeout(() => { this.copyBtn.textContent = 'copy'; }, 1200);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(() => done(true), () => done(this._copyFallback(text)));
    }
    done(this._copyFallback(text));
    return Promise.resolve();
  }

  _copyFallback(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
    ta.remove();
    return ok;
  }
}
