// CONTACT-AO-01a (38.78): contact blob AO - formula, list build, lightSurfaces twin, alloc, cost.
// Run: node engine/render/contactAO.test.js
import assert from 'node:assert/strict';
import { createContactAO, buildContactBlobs, setDynamicBlobs, contactAOAt, contactOcclAt, contactAOQ, caoFactor, CAO_MAX } from './contactAO.js';
import { LightSet, lightSurfaces, makeLightBuffer } from './lighting.js';
import { FACE_U } from './GBuffer.js';

const mk = (items) => { const n = items.length, f = (k) => Float32Array.from(items.map((b) => b[k]));
  return { count: n, x: f('x'), y: f('y'), zBase: f('z'), rx: f('rx'), ry: f('ry'), h: f('h'), k: f('k'), id: Int32Array.from(items.map((b, i) => b.id ?? i)) }; };
const crate = (x, y, id) => ({ x, y, z: 0, rx: 0.5, ry: 0.5, h: 1, k: 0.6, id });
const cam = { x: 0, y: 0 };
let pass = 0; const ok = (name, fn) => { fn(); pass++; };

ok('flat ground ring: dark at centre (1-k), none at dE>=1.6, none above 0.5h', () => {
  const c = createContactAO(); buildContactBlobs(c, cam, mk([crate(0, 0, 1)]), {});
  assert.equal(c.n, 1);
  assert.ok(Math.abs(contactAOAt(c, 0, 0, 0, 1) - 0.4) < 1e-6);
  assert.equal(contactAOAt(c, 0.8, 0, 0, 1), 1); // dE = 1.6 exactly
  assert.equal(contactAOAt(c, 3, 0, 0, 1), 1);
  assert.equal(contactAOAt(c, 0, 0, 0.5, 1), 1); // Pz - zBase = 0.5h
  const mid = contactAOAt(c, 0.5, 0, 0, 1); assert.ok(mid > 0.4 && mid < 1); // inside the ring, partial
  assert.ok(contactAOAt(c, 0, 0, 0, 0) > contactAOAt(c, 0, 0, 0, 1)); // vertical walls darken less (0.5 factor)
  assert.ok(Math.abs(contactAOAt(c, 0, 0, 0, 0) - (1 - 0.6 * 0.5)) < 1e-6);
});
ok('max-combine is order-free', () => {
  const A = [crate(0, 0, 1), crate(0.3, 0, 2), crate(-0.4, 0.2, 3)];
  const a = createContactAO(), b = createContactAO();
  buildContactBlobs(a, cam, mk(A), {}); buildContactBlobs(b, cam, mk([A[2], A[0], A[1]]), {});
  for (const p of [[0, 0], [0.2, 0.1], [-0.3, 0], [0.9, 0.2]]) assert.equal(contactAOAt(a, p[0], p[1], 0, 1), contactAOAt(b, p[0], p[1], 0, 1));
  const solo = createContactAO(); buildContactBlobs(solo, cam, mk([A[0]]), {});
  assert.ok(contactAOAt(a, 0, 0, 0, 1) <= contactAOAt(solo, 0, 0, 0, 1) + 1e-9); // never lighter than the strongest single; not a product
  assert.ok(contactAOAt(a, 0, 0, 0, 1) >= 0.4 - 1e-6);
});
ok('list: sorted (distance, id), capped at 32, radius culled, ties by id', () => {
  const items = []; for (let i = 0; i < 100; i++) items.push(crate(1 + (i % 10), Math.floor(i / 10) * 0.5, 1000 - i));
  items.push(crate(500, 0, 7)); // out of radius
  const c = createContactAO(); buildContactBlobs(c, cam, mk(items), { radius: 24 });
  assert.equal(c.n, CAO_MAX);
  let prev = -1, prevId = -1;
  for (let i = 0; i < c.n; i++) { const d = c.data[i * 8] ** 2 + c.data[i * 8 + 1] ** 2; assert.ok(d >= prev); prev = d; }
  const c2 = createContactAO(); buildContactBlobs(c2, cam, mk(items.slice().reverse()), { radius: 24 });
  assert.deepEqual(Array.from(c.data), Array.from(c2.data)); // deterministic regardless of source order
  const t = createContactAO(); buildContactBlobs(t, cam, mk([crate(2, 0, 9), crate(0, 2, 3)]), {}); // equal distance: id 3 first
  assert.equal(t.data[0], 0); assert.equal(t.data[1], 2);
});
ok('dynamics merge, version bumps only on change', () => {
  const c = createContactAO(); const src = mk([crate(5, 0, 1)]);
  setDynamicBlobs(c, { count: 1, x: [0], y: [0], zBase: [0], rx: [0.4], ry: [0.4], h: [1.8], k: [0.5], id: [900] });
  buildContactBlobs(c, cam, src, {}); const v = c.version; assert.equal(c.n, 2); assert.equal(c.data[0], 0);
  buildContactBlobs(c, cam, src, {}); assert.equal(c.version, v);
  setDynamicBlobs(c, { count: 1, x: [0.1], y: [0], zBase: [0], rx: [0.4], ry: [0.4], h: [1.8], k: [0.5], id: [900] });
  buildContactBlobs(c, cam, src, {}); assert.equal(c.version, v + 1);
});
ok('no occluders -> lightSurfaces byte-identical to cao=null (3 poses)', () => {
  const run = (cao, pitch) => {
    const ls = new LightSet(); ls.ambient[0] = 0.2; ls.ambient[1] = 0.25; ls.ambient[2] = 0.3; ls.cao = cao; ls.update(0, null);
    const n = 400, g = { kind: new Uint8Array(n).fill(1), face: new Uint8Array(n).fill(FACE_U), aoD: new Float32Array(n), cols: 20, rows: 20 };
    const lb = makeLightBuffer(20, 20);
    lightSurfaces({ gbuf: g, depth: { depth: new Float32Array(n).fill(4) }, rt: { pxCellW: 1, pxCellH: 1 }, light: lb }, ls, { x: 0, y: 0, z: 2, yawDeg: 0, pitchDeg: pitch }, {});
    return Buffer.concat([Buffer.from(lb.rgb.buffer), Buffer.from(lb.caoQ.buffer)]);
  };
  for (const p of [-80, -45, -10]) assert.ok(run(null, p).equals(run(createContactAO(), p)));
});
ok('lightSurfaces darkens ambient under a blob only', () => {
  const ls = new LightSet(); ls.ambient[0] = 0.4; ls.ambient[1] = 0.4; ls.ambient[2] = 0.4;
  const c = createContactAO(); buildContactBlobs(c, { x: 0, y: 0 }, mk([{ x: 0, y: 0, z: 0, rx: 1.5, ry: 1.5, h: 3, k: 0.5, id: 1 }]), {}); ls.cao = c; ls.update(0, null);
  const n = 400, g = { kind: new Uint8Array(n).fill(1), face: new Uint8Array(n).fill(FACE_U), aoD: new Float32Array(n), cols: 20, rows: 20 };
  const lb = makeLightBuffer(20, 20);
  lightSurfaces({ gbuf: g, depth: { depth: new Float32Array(n).fill(2) }, rt: { pxCellW: 1, pxCellH: 1 }, light: lb }, ls, { x: 0, y: 0, z: 2, yawDeg: 0, pitchDeg: -80 }, {});
  let dark = 0, plain = 0; const ref = 0.4; // ambient only, no lights
  for (let i = 0; i < n; i++) { if (lb.caoQ[i] > 0) { dark++; assert.ok(Math.abs(lb.rgb[i * 3] - 0.4 * (127 - lb.caoQ[i]) / 127) < 1e-5); } else { plain++; assert.ok(Math.abs(lb.rgb[i * 3] - ref) < 1e-6); } }
  assert.ok(dark > 0 && plain > 0, `dark ${dark} plain ${plain}`);
  assert.equal(caoFactor(0), 1);
});

// 0 alloc + cost at 240x90
const items = []; for (let i = 0; i < 500; i++) items.push({ x: (i * 37 % 100) - 50, y: (i * 53 % 100) - 50, z: 0, rx: 0.5, ry: 0.5, h: 1, k: 0.6, id: i });
const BO = {}, src = mk(items), c = createContactAO();
setDynamicBlobs(c, { count: 1, x: [0], y: [0], zBase: [0], rx: [0.4], ry: [0.4], h: [1.8], k: [0.5], id: [9999] });
for (let i = 0; i < 300; i++) { cam.x = i * 0.01; buildContactBlobs(c, cam, src, BO); }
const used = () => { globalThis.gc && gc(); return process.memoryUsage().heapUsed; };
let m0 = used(), t0 = performance.now(); const NB = 20000;
const camA = { x: 0, y: 0 }, camB = { x: 3.5, y: 1 }; // pre-made cams: assigning fresh doubles to a property would box
for (let i = 0; i < NB; i++) buildContactBlobs(c, (i & 1) ? camA : camB, src, BO);
const buildMs = (performance.now() - t0) / NB, buildB = Math.max(0, used() - m0) / NB;
const cells = 240 * 90; let acc = 0; m0 = used(); t0 = performance.now(); const NE = 20;
for (let r = 0; r < NE; r++) for (let i = 0; i < cells; i++) acc += contactAOQ(c, (i % 240) * 0.2 - 24, ((i / 240) | 0) * 0.5 - 22, 0, 1);
const evalMs = (performance.now() - t0) / NE, evalB = Math.max(0, used() - m0) / NE;
console.log(`contactAO bench: build(500 placements) ${buildMs.toFixed(4)} ms, ${buildB.toFixed(1)} B/frame; eval 240x90 (n=${c.n}) ${evalMs.toFixed(3)} ms, ${evalB.toFixed(0)} B/frame (acc ${acc})`);
assert.ok(buildB < 16 && evalB < 64, 'alloc');
console.log(`contactAO.test: ${pass} groups OK`);
