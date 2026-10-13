// tools/editor/axisGizmo.js - US-068c axis gizmo (docs/architecture.md 38.19).
// `axisGizmoEndpoints` is a pure function of camera yaw/pitch (Node-tested);
// `createAxisGizmo` is the thin DOM overlay (SVG axes + TOP/FRONT/ISO buttons).
const DEG2RAD = Math.PI / 180;
export const AXIS_COLORS = { x: '#e5534b', y: '#57ab5a', z: '#539bf5' };

/**
 * Screen endpoints of the +X/+Y/+Z unit axes (screen x right, y DOWN) for a
 * camera with compass yaw (0 = N = -y, clockwise) and pitch (+ = up):
 * R = (cos y, sin y, 0), U = (-sin y sin p, cos y sin p, cos p),
 * screen = (dot(a,R), -dot(a,U)). `depth` = dot(a,F) (> 0 points away).
 * @returns {{x:{sx:number,sy:number,depth:number}, y:{...}, z:{...}}}
 */
export function axisGizmoEndpoints(yawDeg, pitchDeg) {
  const y = yawDeg * DEG2RAD, p = pitchDeg * DEG2RAD;
  const sy = Math.sin(y), cy = Math.cos(y), sp = Math.sin(p), cp = Math.cos(p);
  const R = [cy, sy, 0], U = [-sy * sp, cy * sp, cp], F = [sy * cp, -cy * cp, sp];
  const ax = (i) => ({ sx: R[i], sy: -U[i], depth: F[i] });
  return { x: ax(0), y: ax(1), z: ax(2) };
}

/**
 * DOM overlay in `parent` (bottom-left). `getView()` -> {yawDeg,pitchDeg};
 * `onPreset(name)` fires for the TOP/FRONT/ISO buttons. Returns {update, el}.
 */
export function createAxisGizmo(parent, { getView, onPreset, onAxis }) {
  const NS = 'http://www.w3.org/2000/svg';
  const el = document.createElement('div');
  el.id = 'axis-gizmo';
  el.className = 'ed-plate';
  el.style.cssText = 'left:6px;bottom:6px;display:flex;flex-direction:column;gap:4px;align-items:center;';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', '72'); svg.setAttribute('height', '72'); svg.setAttribute('viewBox', '-36 -36 72 72');
  const parts = {};
  for (const k of ['x', 'y', 'z']) {
    const line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', '0'); line.setAttribute('y1', '0');
    line.setAttribute('stroke', AXIS_COLORS[k]); line.setAttribute('stroke-width', '3');
    const text = document.createElementNS(NS, 'text');
    text.setAttribute('fill', AXIS_COLORS[k]); text.setAttribute('font-size', '11');
    text.setAttribute('text-anchor', 'middle'); text.setAttribute('dominant-baseline', 'central');
    text.textContent = k.toUpperCase();
    text.style.cursor = 'pointer'; text.style.pointerEvents = 'all';
    text.addEventListener('click', () => { if (onAxis) onAxis(k); });
    svg.appendChild(line); svg.appendChild(text);
    parts[k] = { line, text };
  }
  el.appendChild(svg);
  const row = document.createElement('div');
  for (const [name, key] of [['TOP', '7'], ['FRONT', '1'], ['ISO', '9']]) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'ed-btn'; b.textContent = name;
    b.title = `${name} view (Numpad${key})`;
    b.addEventListener('click', () => onPreset(name));
    row.appendChild(b);
  }
  el.appendChild(row);
  parent.appendChild(el);
  const LEN = 24;
  function update() {
    const v = getView();
    const e = axisGizmoEndpoints(v.yawDeg, v.pitchDeg);
    for (const k of ['x', 'y', 'z']) {
      const a = e[k], px = a.sx * LEN, py = a.sy * LEN;
      parts[k].line.setAttribute('x2', px.toFixed(1)); parts[k].line.setAttribute('y2', py.toFixed(1));
      parts[k].text.setAttribute('x', (a.sx * (LEN + 8)).toFixed(1)); parts[k].text.setAttribute('y', (a.sy * (LEN + 8)).toFixed(1));
      const op = a.depth > 0.05 ? 0.45 : 1; // pointing away = dimmer
      parts[k].line.setAttribute('opacity', String(op)); parts[k].text.setAttribute('opacity', String(op));
    }
  }
  update();
  return { el, update };
}
