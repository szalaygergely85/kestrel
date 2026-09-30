// game/js/rts/ui/hud.js - RTS-01a/b DOM HUD: the F3 stats block (b6) and the how-to-play text (b8). Text only;
// the game view itself stays on the canvas. Percentiles come from small preallocated ring buffers.

const RING = 240; // frames

export function createStatRing() {
  const buf = new Float32Array(RING), tmp = new Float32Array(RING);
  let n = 0, head = 0;
  return {
    push(v) { buf[head] = v; head = (head + 1) % RING; if (n < RING) n++; },
    /** @param {number} p 0..1 */
    pct(p) {
      if (!n) return NaN;
      const t = tmp.subarray(0, n);
      t.set(buf.subarray(0, n));
      t.sort();
      return t[Math.min(n - 1, Math.floor(p * n))];
    },
  };
}

const HOWTO = [
  'RTS-01 spike - LEFT click = select, LEFT drag = box (shift adds), click ground = deselect',
  'RIGHT click = move the selection (on an enemy = go to it)   pan: WASD / arrows / screen edge / middle or right DRAG',
  'zoom: mouse wheel   F3: stats (sim / JS / GPU ms)   ?n=200 units  ?grid=400x150|240x90',
];

export function createHud(visibleF3) {
  const howto = document.createElement('div');
  howto.style.cssText = 'position:fixed;left:8px;bottom:8px;color:#dfe6cf;font:12px "Courier New",monospace;' +
    'background:rgba(0,0,0,0.55);padding:4px 8px;white-space:pre;pointer-events:none;z-index:10';
  howto.textContent = HOWTO.join('\n');
  const f3 = document.createElement('pre');
  f3.style.cssText = 'position:fixed;left:8px;top:8px;margin:0;color:#b8ffb0;font:12px "Courier New",monospace;' +
    'background:rgba(0,0,0,0.6);padding:4px 8px;pointer-events:none;z-index:10;white-space:pre';
  f3.style.display = visibleF3 ? 'block' : 'none';
  document.body.append(howto, f3);
  return {
    f3El: f3, howtoEl: howto,
    get f3Visible() { return f3.style.display !== 'none'; },
    toggleF3() { f3.style.display = f3.style.display === 'none' ? 'block' : 'none'; },
    setF3Text(t) { f3.textContent = t; },
  };
}
