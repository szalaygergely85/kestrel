// node tools/editor/axisGizmo.test.mjs - US-068c presets + gizmo axis directions.
import { createCameraPose, applyViewPreset } from './camera.js';
import { axisGizmoEndpoints } from './axisGizmo.js';
let fail = 0;
const ok = (n, c) => { if (!c) { fail++; console.log('FAIL', n); } };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

const p = createCameraPose({ x: 1, y: 2, z: 3, yawDeg: 123, pitchDeg: 10 });
applyViewPreset(p, 'FRONT');
ok('FRONT 0/0', p.yawDeg === 0 && p.pitchDeg === 0 && p.x === 1);
applyViewPreset(p, 'TOP');
ok('TOP clamped to -70 in perspective', p.yawDeg === 0 && p.pitchDeg === -70);
applyViewPreset(p, 'TOP', null, 90);
ok('TOP -90 when clamp 90', p.pitchDeg === -90);
applyViewPreset(p, 'ISO');
ok('ISO 45 / -35.264', p.yawDeg === 45 && near(p.pitchDeg, -35.26438968275466, 1e-9));
// focus keeps distance and looks at focus
const q = createCameraPose({ x: 0, y: 10, z: 0 });
applyViewPreset(q, 'ISO', { x: 0, y: 0, z: 0 });
ok('focus distance kept', near(Math.hypot(q.x, q.y, q.z), 10, 1e-9));
const yr = q.yawDeg * Math.PI / 180, pr = q.pitchDeg * Math.PI / 180;
ok('eye looks at focus', near(q.x + Math.sin(yr) * Math.cos(pr) * 10, 0) && near(q.y - Math.cos(yr) * Math.cos(pr) * 10, 0) && near(q.z + Math.sin(pr) * 10, 0));
let threw = false; try { applyViewPreset(p, 'SIDE'); } catch { threw = true; }
ok('unknown preset throws', threw);
threw = false; try { applyViewPreset(p, 'toString'); } catch { threw = true; }
ok('prototype name throws', threw);

let e = axisGizmoEndpoints(0, -90);
ok('TOP: X right', near(e.x.sx, 1) && near(e.x.sy, 0));
ok('TOP: Y down', near(e.y.sx, 0) && near(e.y.sy, 1));
ok('TOP: Z toward viewer (zero screen length)', near(e.z.sx, 0) && near(e.z.sy, 0) && e.z.depth < 0);
e = axisGizmoEndpoints(0, 0);
ok('FRONT: X right, Z up', near(e.x.sx, 1) && near(e.z.sy, -1) && near(e.z.sx, 0));
ok('FRONT: Y toward viewer (north = -y)', near(e.y.depth, -1) && near(e.y.sy, 0));
const s = Math.SQRT1_2, t = Math.atan(1 / Math.SQRT2);
e = axisGizmoEndpoints(45, -35.26438968275466);
ok('ISO: X right+up', near(e.x.sx, s) && near(e.x.sy, -Math.sin(t) * s));
ok('ISO: Y right+down', near(e.y.sx, s) && near(e.y.sy, Math.sin(t) * s));
ok('ISO: Z up', near(e.z.sx, 0) && near(e.z.sy, -Math.cos(t)));
if (fail) { console.log(`axisGizmo.test: ${fail} FAILED`); process.exit(1); }
console.log('axisGizmo.test: all passed');
