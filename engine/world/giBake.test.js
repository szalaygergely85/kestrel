// GI-PROBE-02a: sliced GI bake core on fixture worlds. Run: node engine/world/giBake.test.js
import { GIBake, bakeAll, evalSH, encodeRaw, fibonacciDirs } from './giBake.js';
import { makeOk } from '../test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

// Fixture: flat ground z=0 plus axis-aligned solid boxes [x0,y0,z0,x1,y1,z1]; slab ray test.
class Fixture {
  constructor(boxes = []) { this.boxes = boxes; }
  groundAt() { return 0; }
  raySegmentRay(s, out) {
    const dx = s[3] - s[0], dy = s[4] - s[1], dz = s[5] - s[2];
    let best = 2;
    if (dz < 0) { const t = -s[2] / dz; if (t >= 0 && t <= 1) best = t; }
    for (const b of this.boxes) {
      let t0 = 0, t1 = 1, hit = true;
      const o = [s[0], s[1], s[2]], d = [dx, dy, dz];
      for (let a = 0; a < 3 && hit; a++) {
        if (Math.abs(d[a]) < 1e-12) { if (o[a] < b[a] || o[a] > b[a + 3]) hit = false; continue; }
        let ta = (b[a] - o[a]) / d[a], tb = (b[a + 3] - o[a]) / d[a];
        if (ta > tb) { const q = ta; ta = tb; tb = q; }
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
        if (t0 > t1) hit = false;
      }
      if (hit && t0 < best) best = t0;
    }
    if (best > 1) return false;
    out.t = best; out.x = s[0] + dx * best; out.y = s[1] + dy * best; out.z = s[2] + dz * best;
    return true;
  }
}
// box surface normal for the fixture: the face nearest the hit point
function boxSurface(boxes) {
  return (x, y, z, o) => {
    if (z < 1e-6) { o.nx = 0; o.ny = 0; o.nz = 1; return; }
    for (const b of boxes) {
      const e = [[Math.abs(x - b[0]), -1, 0, 0], [Math.abs(x - b[3]), 1, 0, 0], [Math.abs(y - b[1]), 0, -1, 0],
        [Math.abs(y - b[4]), 0, 1, 0], [Math.abs(z - b[2]), 0, 0, -1], [Math.abs(z - b[5]), 0, 0, 1]];
      e.sort((p, q) => p[0] - q[0]);
      if (e[0][0] < 1e-3) { o.nx = e[0][1]; o.ny = e[0][2]; o.nz = e[0][3]; return; }
    }
    o.nx = 0; o.ny = 0; o.nz = 1;
  };
}

const base = { x0: 0, y0: 0, w: 2, h: 2, cellM: 8, layerDz: [1, 4], keyHours: [12], sunDir: (h, o) => { o[0] = 0.6; o[1] = 0; o[2] = 0.8; return o; } };
const P = (cfg, col, layer) => layer * cfg.w * cfg.h + col;

{ // open plane
  const r = bakeAll(new Fixture(), base).raw();
  const v = evalSH(r.sky, 0, 0, 0, 1);
  ok('open plane: skyVis(up) >= 0.95', v >= 0.95, `${v}`);
  ok('open plane: skyVis(down) ~ 0', evalSH(r.sky, 0, 0, 0, -1) < 0.1, `${evalSH(r.sky, 0, 0, 0, -1)}`);
}
{ // determinism, independent of slicing
  const cfg = { ...base, lights: [{ x: 3, y: 3, z: 3, r: 1, g: 1, b: 1, range: 12 }] };
  const a = bakeAll(new Fixture(), cfg).raw();
  const g = new GIBake(new Fixture(), cfg); while (!g.step(0)) { /* one probe per step */ }
  const c = g.raw();
  const same = (x, y) => Buffer.compare(Buffer.from(x.buffer, x.byteOffset, x.byteLength), Buffer.from(y.buffer, y.byteOffset, y.byteLength)) === 0;
  ok('two runs (different slicing) byte-identical', same(a.sky, c.sky) && same(a.sun, c.sun) && same(a.emis, c.emis) && same(a.valid, c.valid));
  const ea = encodeRaw(a), ec = encodeRaw(c);
  ok('encoded bytes identical', same(ea.sky.data, ec.sky.data) && same(ea.sun.data, ec.sun.data));
}
{ // 4x4 m roof over the probe at (4,4), probe z=1
  const boxes = [[2, 2, 1.6, 6, 6, 1.8]]; // canopy 0.6 m over the probe (a 4x4 roof at 2 m blocks only ~50% of cosine sky)
  const b = bakeAll(new Fixture(boxes), { ...base, surfaceAt: boxSurface(boxes) });
  const v = evalSH(b.raw().sky, 0, 0, 0, 1);
  ok('under 4x4 roof: skyVis(up) <= 0.2', v <= 0.2, `${v}`);
}
{ // flat albedo plane: bounce(down) = a * sun.z, probe layer 1 (z=4)
  const a = 0.6, cfg = { ...base, albedo: [a, a * 0.5, a * 0.25], rayLen: 200 };
  const r = bakeAll(new Fixture(), cfg).raw();
  const exp = a * 0.8, got = evalSH(r.sun, P(cfg, 0, 1) * 12, 0, 0, -1);
  ok('flat albedo plane: bounce within 5% of analytic', Math.abs(got - exp) / exp < 0.05, `${got} vs ${exp}`);
  const gotB = evalSH(r.sun, P(cfg, 0, 1) * 12 + 8, 0, 0, -1);
  ok('albedo channels scale (blue = a/4)', Math.abs(gotB - exp * 0.25) / (exp * 0.25) < 0.05, `${gotB}`);
  ok('no emissive -> emis 0', r.emis.every((x) => x === 0));
}
{ // emissive lamp over the plane lights the bounce below the probe
  const cfg = { ...base, albedo: [0.5, 0.5, 0.5], lights: [{ x: 4, y: 4, z: 2.5, r: 1, g: 0.5, b: 0, range: 8 }], rayLen: 100 };
  const r = bakeAll(new Fixture(), cfg).raw();
  const o = P(cfg, 0, 1) * 12;
  const e = evalSH(r.emis, o, 0, 0, -1), eg = evalSH(r.emis, o + 4, 0, 0, -1), eb = evalSH(r.emis, o + 8, 0, 0, -1);
  ok('emissive: red > green > 0, blue 0', e > 0.01 && eg > 0 && e > eg && Math.abs(eb) < 1e-9, `${e} ${eg} ${eb}`);
}
{ // slicing
  let t = 0;
  const g = new GIBake(new Fixture(), { ...base, now: () => (t += 1) });
  g.step(3);
  ok('step(ms) overrun <= 1 probe, not done, progress', g.next >= 1 && g.next <= 4 && !g.done && g.progress > 0, `${g.next}`);
  const d = fibonacciDirs();
  let unit = true;
  for (let i = 0; i < 64; i++) if (Math.abs(Math.hypot(d[i * 3], d[i * 3 + 1], d[i * 3 + 2]) - 1) > 1e-12) unit = false;
  ok('fibonacci dirs unit length', unit);
}
{ // inside solid -> invalid
  const boxes = [[0, 0, 0, 16, 16, 20]];
  const r = bakeAll(new Fixture(boxes), base).raw();
  ok('probe inside solid is invalid', r.valid[0] === 0, `${r.valid[0]}`);
}
{ // timing: 64x64 m = 8x8 columns x 3 layers, 6 keys
  const boxes = [[10, 10, 3, 20, 20, 3.5]];
  const t = performance.now();
  bakeAll(new Fixture(boxes), { x0: 0, y0: 0, w: 8, h: 8, keyHours: [6, 9, 12, 15, 18, 20], surfaceAt: boxSurface(boxes) });
  console.log(`bake 64x64 m fixture (192 probes, 6 keys): ${(performance.now() - t).toFixed(0)} ms`);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { console.log('FAILURES:\n' + failures.map((x) => '  - ' + x).join('\n')); process.exit(1); }
console.log('ALL PASS');
