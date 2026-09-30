// game/js/rts/ui/minimapView.js - RE-13 (docs/backlog.md "PC-B QUEUE 5" item
// 11, docs/architecture.md 28.4 "Display: Canvas2D overlay"). Presentation
// layer only: a `<canvas>` + `ImageData` wrapper around an
// `engine/render/minimap.js` `Minimap` instance (`mm`). No GPU texture, no
// engine UI code.
//
// This module never imports `engine/render/minimap.js` (or any other deep
// engine path) on purpose - `game/**/*.js` may only deep-import
// `engine/index.js` (tools/check-deps.mjs rule 3), which doesn't expose the
// minimap yet. Instead it drives the `mm` instance it's handed purely
// through its documented shape: `mm.width/height/rgba/x0/y0/sx/sy` and the
// bound `mm.update(...)` method (28.4's pseudocode calls it exactly that
// way) - duck typing, not a real dependency on the module that built `mm`.
//
// Simpler and less rigorously tested than the engine module: no zero-alloc
// or determinism discipline here (it's UI, not sim), see minimapView.test.js
// for what is checked (DOM/canvas stubbed, following game/js/ui/pause.js's
// convention of reading `document`/`window` off the global rather than
// importing them).

/**
 * @typedef {Object} MinimapViewOptions
 * @property {HTMLElement} [container] - defaults to `document.body`
 * @property {number} [refreshEveryNFrames] - default 3 (20 Hz at 60 fps, 28.4)
 * @property {(worldX:number, worldY:number) => void} [onDrag] - left-drag: caller sets its rtsCamera focus
 * @property {(worldX:number, worldY:number) => void} [onRightClick] - right click: caller issues an RE-14 move command
 */

/**
 * @param {import('../../../../engine/render/minimap.js').Minimap} mm
 * @param {MinimapViewOptions} [opts]
 */
export function createMinimapView(mm, opts = {}) {
  const container = opts.container || document.body;
  const refreshEveryNFrames = opts.refreshEveryNFrames || 3;
  const onDrag = opts.onDrag;
  const onRightClick = opts.onRightClick;

  const canvas = document.createElement('canvas');
  canvas.width = mm.width;
  canvas.height = mm.height;
  canvas.id = 'rts-minimap';
  Object.assign(canvas.style, {
    position: 'absolute',
    right: '8px',
    bottom: '8px',
    imageRendering: 'pixelated',
    cursor: 'crosshair',
  });
  container.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  // Wraps mm.rgba directly (no copy) - mm.update() writes into that same
  // buffer, so ctx.putImageData always draws the minimap's current contents.
  const imageData = new ImageData(mm.rgba, mm.width, mm.height);

  let frameCount = 0;
  let dragging = false;
  const _world = [0, 0];

  /** `u = offsetX*W/clientWidth` (28.4), then the minimapToWorld linear map
   * inlined from `mm`'s own fields (x0/y0/sx/sy) - see the module doc
   * comment for why this isn't a call to the engine's exported helper. */
  function pixelToWorld(offsetX, offsetY, out2) {
    const clientWidth = canvas.clientWidth || mm.width;
    const clientHeight = canvas.clientHeight || mm.height;
    const u = (offsetX * mm.width) / clientWidth;
    const v = (offsetY * mm.height) / clientHeight;
    out2[0] = mm.x0 + u * mm.sx;
    out2[1] = mm.y0 + v * mm.sy;
    return out2;
  }

  function handlePointerDown(e) {
    if (e.button === 2) return; // right button: handled by contextmenu below
    dragging = true;
    pixelToWorld(e.offsetX, e.offsetY, _world);
    if (onDrag) onDrag(_world[0], _world[1]);
  }
  function handlePointerMove(e) {
    if (!dragging) return;
    pixelToWorld(e.offsetX, e.offsetY, _world);
    if (onDrag) onDrag(_world[0], _world[1]);
  }
  function handlePointerUp() { dragging = false; }
  function handleContextMenu(e) {
    if (e.preventDefault) e.preventDefault();
    pixelToWorld(e.offsetX, e.offsetY, _world);
    if (onRightClick) onRightClick(_world[0], _world[1]);
  }

  canvas.addEventListener('pointerdown', handlePointerDown);
  canvas.addEventListener('pointermove', handlePointerMove);
  canvas.addEventListener('pointerup', handlePointerUp);
  canvas.addEventListener('pointerleave', handlePointerUp);
  canvas.addEventListener('contextmenu', handleContextMenu);

  /**
   * Call once per rendered frame. Refreshes at 20 Hz (every 3rd frame,
   * 28.4): `mm.update(...)` then `ctx.putImageData`. Returns true on a
   * frame that actually refreshed (for tests/diagnostics).
   */
  function tick(units, view, viewTeam, terms, terrain) {
    frameCount++;
    if (frameCount % refreshEveryNFrames !== 0) return false;
    mm.update(units, view, viewTeam, terms, terrain);
    ctx.putImageData(imageData, 0, 0);
    return true;
  }

  function dispose() {
    canvas.removeEventListener('pointerdown', handlePointerDown);
    canvas.removeEventListener('pointermove', handlePointerMove);
    canvas.removeEventListener('pointerup', handlePointerUp);
    canvas.removeEventListener('pointerleave', handlePointerUp);
    canvas.removeEventListener('contextmenu', handleContextMenu);
    if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
  }

  return { canvas, tick, pixelToWorld, dispose };
}
