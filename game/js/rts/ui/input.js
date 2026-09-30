// game/js/rts/ui/input.js - RTS-01a mouse/keyboard -> camera input + selection actions (28.8). Reads DOM events,
// never writes sim arrays. Coordinates: CSS px relative to the canvas; `cellCol/cellRow` are fractional cell
// coordinates in the screenRay convention (an integer = the centre of that cell).
// Left click / left drag box = select, right click (press + release without moving) = move order (both resolved by
// rtsMain after the camera update); middle or right DRAG = pan (right press only becomes a pan once it moves);
// wheel = zoom; WASD / arrows = pan; cursor within 2 cells of the canvas edge = edge scroll.

const KEYS = {
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down',
};
export const ACT_NONE = 0, ACT_CLICK = 1, ACT_BOX = 2, ACT_MOVE = 3;
const CLICK_PX = 4;        // a left press that moves less than this (px) is a click, not a box
const ZOOM_PER_NOTCH = 0.05; // RtsCamera zoom units per wheel notch (range is ~0.33 wide)

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{cols:number, rows:number}} rt live render target (cols/rows may change on a grid switch)
 */
export function createRtsInput(canvas, rt) {
  const keys = { left: false, right: false, up: false, down: false };
  const cam = { // RtsCameraInput, reused every frame
    left: false, right: false, up: false, down: false,
    mouseX: undefined, mouseY: undefined, screenW: 0, screenH: 0,
    dragging: false, dragCol0: 0, dragRow0: 0, dragCol1: 0, dragRow1: 0, zoomDelta: 0,
  };
  const s = {
    cam,
    hasMouse: false, mx: 0, my: 0, cellCol: 0, cellRow: 0, // latest cursor
    leftDown: false, leftX0: 0, leftY0: 0,                 // left press origin (css px)
    boxActive: false, boxC0: 0, boxR0: 0, boxC1: 0, boxR1: 0, // integer cells, for the rect overlay
    panButton: -1, lastCol: 0, lastRow: 0,
    rightDown: false, rightX0: 0, rightY0: 0, rightCol0: 0, rightRow0: 0, // right press origin (css px / cell)
    wheel: 0,
    /** pending selection action, consumed by rtsMain once per frame */
    act: ACT_NONE, actShift: false, actCol: 0, actRow: 0, actC0: 0, actR0: 0, actC1: 0, actR1: 0,
    /** edge-scroll band in css px (2 cells) - set by beginFrame */
    edgePx: 0,
    f3Pressed: false,
    /** Fills and returns the RtsCameraInput for this frame. */
    beginFrame() {
      const r = canvas.getBoundingClientRect();
      const cw = r.width / rt.cols;
      cam.left = keys.left; cam.right = keys.right; cam.up = keys.up; cam.down = keys.down;
      cam.screenW = r.width; cam.screenH = r.height;
      cam.mouseX = s.hasMouse ? s.mx : undefined; cam.mouseY = s.hasMouse ? s.my : undefined;
      s.edgePx = 2 * cw;
      cam.zoomDelta = s.wheel; s.wheel = 0;
      cam.dragging = s.panButton >= 0 && s.hasMouse;
      if (cam.dragging) {
        cam.dragCol0 = s.lastCol; cam.dragRow0 = s.lastRow;
        cam.dragCol1 = s.cellCol; cam.dragRow1 = s.cellRow;
      }
      s.lastCol = s.cellCol; s.lastRow = s.cellRow;
      return cam;
    },
    dispose() { for (const [t, n, f] of listeners) t.removeEventListener(n, f); },
  };

  /** css px -> cell coordinates, from the canvas' current rect. */
  function locate(e) {
    const r = canvas.getBoundingClientRect();
    s.mx = e.clientX - r.left; s.my = e.clientY - r.top;
    const cw = r.width / rt.cols, ch = r.height / rt.rows;
    s.cellCol = s.mx / cw - 0.5; s.cellRow = s.my / ch - 0.5;
    s.hasMouse = s.mx >= 0 && s.my >= 0 && s.mx <= r.width && s.my <= r.height;
    return { cw, ch };
  }
  const cellIdx = (px, size) => Math.floor(px / size);

  const listeners = [];
  const on = (t, n, f, o) => { t.addEventListener(n, f, o); listeners.push([t, n, f]); };

  on(window, 'mousemove', (e) => {
    const { cw, ch } = locate(e);
    if (s.rightDown && s.panButton < 0 && Math.abs(s.mx - s.rightX0) + Math.abs(s.my - s.rightY0) >= CLICK_PX) {
      s.panButton = 2; s.lastCol = s.rightCol0; s.lastRow = s.rightRow0; // grab the ground point under the press
    }
    if (s.leftDown) {
      s.boxActive = Math.abs(s.mx - s.leftX0) + Math.abs(s.my - s.leftY0) >= CLICK_PX;
      if (s.boxActive) s.boxC1 = cellIdx(s.mx, cw), s.boxR1 = cellIdx(s.my, ch);
    }
  });
  on(canvas, 'mousedown', (e) => {
    const { cw, ch } = locate(e);
    if (e.button === 0) {
      s.leftDown = true; s.leftX0 = s.mx; s.leftY0 = s.my;
      s.boxC0 = s.boxC1 = cellIdx(s.mx, cw); s.boxR0 = s.boxR1 = cellIdx(s.my, ch); s.boxActive = false;
    } else if (e.button === 2) {
      s.rightDown = true; s.rightX0 = s.mx; s.rightY0 = s.my; s.rightCol0 = s.cellCol; s.rightRow0 = s.cellRow;
      e.preventDefault();
    } else if (e.button === 1) {
      s.panButton = e.button; s.lastCol = s.cellCol; s.lastRow = s.cellRow;
      e.preventDefault();
    }
  });
  on(window, 'mouseup', (e) => {
    const { cw, ch } = locate(e);
    if (e.button === 0 && s.leftDown) {
      s.leftDown = false;
      s.actShift = e.shiftKey;
      if (s.boxActive) {
        s.act = ACT_BOX;
        s.actC0 = Math.min(s.boxC0, cellIdx(s.mx, cw)); s.actC1 = Math.max(s.boxC0, cellIdx(s.mx, cw));
        s.actR0 = Math.min(s.boxR0, cellIdx(s.my, ch)); s.actR1 = Math.max(s.boxR0, cellIdx(s.my, ch));
      } else {
        s.act = ACT_CLICK; s.actCol = s.cellCol; s.actRow = s.cellRow;
      }
      s.boxActive = false;
    } else if (e.button === 2 && s.rightDown) {
      s.rightDown = false;
      if (s.panButton === 2) s.panButton = -1; // it was a drag-pan
      else { s.act = ACT_MOVE; s.actCol = s.cellCol; s.actRow = s.cellRow; }
    } else if (e.button === s.panButton) {
      s.panButton = -1;
    }
  });
  on(canvas, 'contextmenu', (e) => e.preventDefault());
  on(canvas, 'wheel', (e) => {
    e.preventDefault();
    s.wheel += (e.deltaY > 0 ? 1 : e.deltaY < 0 ? -1 : 0) * ZOOM_PER_NOTCH; // wheel down = zoom out = wider view
  }, { passive: false });
  on(document, 'mouseleave', () => { s.hasMouse = false; s.leftDown = false; s.boxActive = false; });
  on(window, 'blur', () => { for (const k in keys) keys[k] = false; s.panButton = -1; s.rightDown = false; s.leftDown = false; s.boxActive = false; });
  on(window, 'keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (KEYS[e.code]) { keys[KEYS[e.code]] = true; e.preventDefault(); }
    if (e.code === 'F3') { s.f3Pressed = true; e.preventDefault(); }
  });
  on(window, 'keyup', (e) => { if (KEYS[e.code]) keys[KEYS[e.code]] = false; });
  return s;
}
