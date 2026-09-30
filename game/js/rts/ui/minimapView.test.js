// game/js/rts/ui/minimapView.test.js (RE-13). Headless Node, DOM stubbed
// (same convention as game/js/ui/pause.test.js: read document/ImageData off
// globalThis, restore them afterwards). This is the presentation layer -
// light shape/behaviour checks, not the rigorous zero-alloc/determinism
// discipline of engine/render/minimap.test.js.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMinimapView } from './minimapView.js';

function makeStubDom() {
  const listenersByEl = new Map();
  function stubElement(tag) {
    const el = {
      tag, style: {}, id: '', width: 0, height: 0,
      clientWidth: 256, clientHeight: 256,
      parentNode: null,
      _listeners: {},
      addEventListener(name, fn) { (this._listeners[name] = this._listeners[name] || []).push(fn); },
      removeEventListener(name, fn) {
        const arr = this._listeners[name];
        if (!arr) return;
        const i = arr.indexOf(fn);
        if (i >= 0) arr.splice(i, 1);
      },
      dispatch(name, ev) { (this._listeners[name] || []).forEach((fn) => fn(ev)); },
      getContext() {
        return { putImageData: (...args) => { ctxCalls.push(args); } };
      },
    };
    listenersByEl.set(el, el._listeners);
    return el;
  }
  const ctxCalls = [];
  const appended = [];
  const document = {
    createElement: (tag) => stubElement(tag),
    body: {
      appendChild(el) { el.parentNode = document.body; appended.push(el); },
      removeChild(el) { el.parentNode = null; const i = appended.indexOf(el); if (i >= 0) appended.splice(i, 1); },
    },
  };
  return { document, ctxCalls, appended };
}

function makeMm(w = 8, h = 8) {
  return {
    width: w, height: h,
    x0: -10, y0: -20, x1: 10, y1: 20,
    sx: 20 / w, sy: 40 / h,
    rgba: new Uint8ClampedArray(w * h * 4),
    update(units, view, viewTeam, terms, terrain) { this._lastUpdateArgs = [units, view, viewTeam, terms, terrain]; this.updateCalls = (this.updateCalls || 0) + 1; },
  };
}

function withStubbedGlobals(fn) {
  const { document, ctxCalls, appended } = makeStubDom();
  const origDoc = globalThis.document;
  const origImageData = globalThis.ImageData;
  globalThis.document = document;
  globalThis.ImageData = class ImageData { constructor(data, width, height) { this.data = data; this.width = width; this.height = height; } };
  try {
    fn({ document, ctxCalls, appended });
  } finally {
    globalThis.document = origDoc;
    globalThis.ImageData = origImageData;
  }
}

test('createMinimapView: canvas sized to mm and appended to the container', () => {
  withStubbedGlobals(({ appended }) => {
    const mm = makeMm(16, 20);
    const view = createMinimapView(mm);
    assert.equal(view.canvas.width, 16);
    assert.equal(view.canvas.height, 20);
    assert.equal(view.canvas.id, 'rts-minimap');
    assert.ok(appended.includes(view.canvas), 'canvas appended to document.body by default');
  });
});

test('createMinimapView: appends to an explicit container when given', () => {
  withStubbedGlobals(() => {
    const mm = makeMm();
    const container = { appendChild(el) { this.child = el; } };
    const view = createMinimapView(mm, { container });
    assert.equal(container.child, view.canvas);
  });
});

test('pixelToWorld: u = offsetX*W/clientWidth, then the linear minimapToWorld map', () => {
  withStubbedGlobals(() => {
    const mm = makeMm(8, 8); // x0=-10,y0=-20,x1=10,y1=20, sx=2.5,sy=5
    const view = createMinimapView(mm);
    view.canvas.clientWidth = 256; // CSS-scaled 32x from the 8px backing store
    view.canvas.clientHeight = 256;
    const out = view.pixelToWorld(128, 64, [0, 0]); // half width, quarter height
    // u = 128*8/256 = 4, v = 64*8/256 = 2 -> x = -10+4*2.5 = 0, y = -20+2*5 = -10
    assert.ok(Math.abs(out[0] - 0) < 1e-9, `x=${out[0]}`);
    assert.ok(Math.abs(out[1] - -10) < 1e-9, `y=${out[1]}`);
  });
});

test('tick(): refreshes only every 3rd frame (20 Hz at 60 fps)', () => {
  withStubbedGlobals(({ ctxCalls }) => {
    const mm = makeMm();
    const view = createMinimapView(mm);
    const results = [];
    for (let i = 0; i < 9; i++) results.push(view.tick({}, {}, 0, {}, {}));
    assert.deepEqual(results, [false, false, true, false, false, true, false, false, true]);
    assert.equal(mm.updateCalls, 3);
    assert.equal(ctxCalls.length, 3);
  });
});

test('onDrag fires on pointerdown and while dragging on pointermove; stops after pointerup', () => {
  withStubbedGlobals(() => {
    const mm = makeMm();
    const drags = [];
    const view = createMinimapView(mm, { onDrag: (x, y) => drags.push([x, y]) });
    view.canvas.dispatch('pointerdown', { button: 0, offsetX: 0, offsetY: 0 });
    view.canvas.dispatch('pointermove', { offsetX: 4, offsetY: 4 });
    view.canvas.dispatch('pointerup', {});
    view.canvas.dispatch('pointermove', { offsetX: 8, offsetY: 8 }); // no longer dragging
    assert.equal(drags.length, 2, 'down + one move while dragging, none after pointerup');
  });
});

test('right button on pointerdown does not start a drag; contextmenu fires onRightClick', () => {
  withStubbedGlobals(() => {
    const mm = makeMm();
    const drags = [];
    const rightClicks = [];
    const view = createMinimapView(mm, { onDrag: (x, y) => drags.push([x, y]), onRightClick: (x, y) => rightClicks.push([x, y]) });
    view.canvas.dispatch('pointerdown', { button: 2, offsetX: 0, offsetY: 0 });
    view.canvas.dispatch('pointermove', { offsetX: 4, offsetY: 4 });
    assert.equal(drags.length, 0, 'right-button down does not start a drag');
    view.canvas.dispatch('contextmenu', { offsetX: 4, offsetY: 4, preventDefault() {} });
    assert.equal(rightClicks.length, 1);
  });
});

test('dispose: removes the canvas from its parent and clears listeners', () => {
  withStubbedGlobals(({ appended }) => {
    const mm = makeMm();
    const view = createMinimapView(mm);
    assert.ok(appended.includes(view.canvas));
    view.dispose();
    assert.ok(!appended.includes(view.canvas));
    assert.equal(view.canvas.parentNode, null);
  });
});
