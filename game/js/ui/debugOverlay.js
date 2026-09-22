// F3 debug overlay: fps + frame time (ms) in the top-left corner. Drawn
// straight onto the DOM (not into the glyph grid) so it is always legible
// regardless of whatever the grid itself is currently showing.

export class DebugOverlay {
  constructor(root = document.body) {
    this.visible = false;
    this.el = document.createElement('div');
    this.el.id = 'debug-overlay';
    Object.assign(this.el.style, {
      position: 'fixed',
      top: '4px',
      left: '4px',
      padding: '4px 8px',
      font: '12px "Courier New", monospace',
      color: '#7CFC7C',
      background: 'rgba(0,0,0,0.6)',
      whiteSpace: 'pre',
      pointerEvents: 'none',
      display: 'none',
      zIndex: 1000,
    });
    root.appendChild(this.el);
  }

  toggle() {
    this.visible = !this.visible;
    this.el.style.display = this.visible ? 'block' : 'none';
  }

  update(fps, frameMs, extra = '') {
    if (!this.visible) return;
    this.el.textContent = `fps: ${fps.toFixed(1)}\nframe: ${frameMs.toFixed(2)} ms${extra ? '\n' + extra : ''}`;
  }
}
