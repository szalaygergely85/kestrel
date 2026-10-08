// S8-B2-02: node tools/validate-mesh.test.mjs
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyzeMeshFile, openEdgePercent, colliderKind, runCli, formatTable } from './validate-mesh.mjs';

let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`ok - ${name}`); } catch (e) { console.error(`FAIL - ${name}\n${e.stack}`); process.exitCode = 1; } };

// tetrahedron soup (closed) and a single triangle (3 open edges)
const tet = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]];
const tris = [[0, 2, 1], [0, 1, 3], [1, 2, 3], [0, 3, 2]];
const flatten = (ts) => ts.flatMap((t) => t.flatMap((i) => tet[i]));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kestrel-vm-'));
function write(name, ts, extra = {}) {
  const pos = flatten(ts), V = ts.length * 3;
  const json = { kind: 'mesh', schema: 1, id: name, nextId: 1, version: 1, layout: 'static', pos, uv: new Array(V * 2).fill(0), nrm: new Array(V).fill(0), flat: new Array(V * 2).fill(0), aux: new Array(V * 8).fill(0),
    idx: null, triCount: ts.length, bbox: [0, 0, 0, 1, 1, 1], ranges: [{ start: 0, count: ts.length }], matKeys: ['stone'], matsResolved: false, meshVersion: 1, ...extra };
  const f = path.join(dir, name + '.mesh.json');
  fs.writeFileSync(f, JSON.stringify(json));
  return f;
}
try {
  const closed = write('closed', tris), open = write('open', [tris[0]], { collide: false }), multi = write('multi', tris, { ranges: Array.from({ length: 9 }, (_, i) => ({ start: 0, count: 1, part: 'p' + i })) });
  test('openEdgePercent: closed = 0, single triangle = 100', () => {
    assert.strictEqual(openEdgePercent(new Float32Array(flatten(tris)), 4), 0);
    assert.strictEqual(openEdgePercent(new Float32Array(flatten([tris[0]])), 1), 100);
  });
  test('colliderKind from the meta', () => {
    assert.strictEqual(colliderKind({}), 'render'); assert.strictEqual(colliderKind({ collide: false }), 'none');
    assert.strictEqual(colliderKind({ colliderB64: 'AA==' }), 'proxy'); assert.strictEqual(colliderKind({ colliderParts: ['a'] }), 'proxy');
  });
  test('analyzeMeshFile: numbers and budgets', () => {
    const r = analyzeMeshFile(closed);
    assert.deepStrictEqual([r.tris, r.ranges, r.collider, r.openEdgePct, r.over], [4, 1, 'render', 0, []]);
    assert.ok(r.bytes > 100);
    assert.strictEqual(analyzeMeshFile(open).collider, 'none');
    assert.ok(analyzeMeshFile(multi).over[0].startsWith('ranges 9 > 8'));
    assert.ok(analyzeMeshFile(closed, { maxTris: 3 }).over[0].startsWith('tris 4 > 3'));
    assert.ok(analyzeMeshFile(closed, { maxBytes: 10 }).over[0].startsWith('bytes'));
  });
  test('runCli exit codes: report-only by default, --strict 1 over, table has a row per mesh', () => {
    const log = console.log; let out = '';
    console.log = (s) => { out += s + '\n'; };
    try { assert.strictEqual(runCli([dir, '--max-ranges', '9']), 0); assert.strictEqual(runCli([dir]), 0, 'report-only by default'); assert.strictEqual(runCli([dir, '--strict']), 1, '--strict exits 1 over budget'); assert.strictEqual(runCli([dir, '--strict', '--max-ranges', '9']), 0); } finally { console.log = log; }
    assert.ok(/closed/.test(out) && /OVER: ranges 9 > 8/.test(out) && /3 meshes/.test(out));
    assert.ok(formatTable([analyzeMeshFile(closed)]).split('\n').length === 2);
  });
  test('the committed content passes the default budget', () => {
    const log = console.log; console.log = () => {};
    try { assert.strictEqual(runCli([]), 0); } finally { console.log = log; }
  });
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
console.log(`${passed} passed`);
