// Run: node engine/render/entityTint.test.js (re-spawns with --expose-gc). Architecture 38.23 (01a: API + twin).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createEntityTintTable, clearEntityTints, pushEntityTint, entityTintAt, tintChannel } from './entityTint.js';
import { CellBuffer } from './CellBuffer.js';
import { DepthBuffer } from './DepthBuffer.js';
import { GBuffer } from './GBuffer.js';
import { bindShading } from './MaterialTable.js';
import { shadeSurfaces } from './detailShade.js';
import paletteMod from '../../design/palette.js';
import detailPassMod from '../../design/detail-pass.js';
import { loadTestAssets } from '../../tools/testing/content-node.mjs';
globalThis.window = globalThis.window || globalThis;
paletteMod; detailPassMod;
if (typeof globalThis.gc !== 'function') {
  const r = spawnSync(process.execPath, ['--expose-gc', ...process.argv.slice(1)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m); } };
const o = new Float32Array(4);

// --- table API
const t = createEntityTintTable();
ok(t.ids.length === 8 && t.rgbk.length === 32 && t.count === 0, 'layout');
ok(!pushEntityTint(t, 5, 1, 0, 0, 0) && !pushEntityTint(t, 5, 1, 0, 0, -1) && t.count === 0, 'k<=0 ignored');
ok(pushEntityTint(t, 7, 1, 0.5, 0, 3) && t.rgbk[3] === 1, 'k clamped to 1');
ok(entityTintAt(t, 7, o) && o[1] === 0.5 && o[3] === 1 && !entityTintAt(t, 8, o) && o[3] === 0, 'lookup');
pushEntityTint(t, 7, 0, 0, 0, 0.5);
ok(entityTintAt(t, 7, o) && o[0] === 1, 'first match wins');
for (let i = 0; i < 20; i++) pushEntityTint(t, 100 + i, 1, 1, 1, 0.5);
ok(t.count === 8, 'full table caps at 8');
clearEntityTints(t); ok(t.count === 0 && !entityTintAt(t, 7, o), 'clear');
ok(tintChannel(100, 1, 0) === 100 && tintChannel(100, 1, 1) === 255 && tintChannel(100, 0, 1) === 0, 'tintChannel k=0/1');

// --- zero alloc
for (let i = 0; i < 1e4; i++) { clearEntityTints(t); pushEntityTint(t, i, 1, 0, 0, 0.5); entityTintAt(t, i, o); }
gc(); const h0 = process.memoryUsage().heapUsed;
for (let i = 0; i < 1e5; i++) { clearEntityTints(t); pushEntityTint(t, i, 1, 0, 0, 0.5); entityTintAt(t, i, o); tintChannel(i & 255, 0.3, 0.4); }
gc(); const d = process.memoryUsage().heapUsed - h0;
ok(d < 200000, 'zero alloc (delta ' + d + ')');

// --- shadeSurfaces twin
const { assets } = await loadTestAssets();
const COLS = 16, ROWS = 8, N = COLS * ROWS;
const matTable = bindShading(assets.palette, assets.detailPass, 1);
const gbuf = new GBuffer(COLS, ROWS), depth = new DepthBuffer(COLS, ROWS);
gbuf.objectId = new Uint32Array(N);
let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
for (let i = 0; i < N; i++) {
  gbuf.kind[i] = 1; gbuf.mat[i] = 1; gbuf.u[i] = rnd() * 4; gbuf.v[i] = rnd() * 4; gbuf.z[i] = rnd() * 2;
  depth.depth[i] = 2 + rnd() * 20; gbuf.objectId[i] = i % 4; // 0 = world, 1..3 entities
}
const light = { uniform: true, rgb: new Float32Array([0.9, 0.8, 0.7]) };
function run(tints, withIds = true) {
  const rt = new CellBuffer(COLS, ROWS);
  const g = gbuf; const save = g.objectId; if (!withIds) g.objectId = undefined;
  shadeSurfaces({ rt, depth, palette: assets.palette, entityTints: tints }, g, matTable, null, light);
  g.objectId = save;
  return rt;
}
const hash = (rt) => createHash('sha1').update(rt.fg).update(rt.bg).update(rt.glyphIdx).digest('hex');
const base = run(null);
const empty = createEntityTintTable();
ok(hash(base) === hash(run(empty)) && hash(base) === hash(run(null, false)), 'no active tints -> bit-identical');
ok(hash(base) === '8b76b96a0b18bdd5a5b9aa56a506d2c9f847fb42', 'pinned tint-off shade hash ' + hash(base));
const tt = createEntityTintTable(); pushEntityTint(tt, 2, 1, 0.25, 0, 0.5);
const r2 = run(tt); let changed = 0, wrong = 0;
for (let i = 0; i < N; i++) {
  const same = [0, 1, 2, 3].every((c) => r2.fg[i * 4 + c] === base.fg[i * 4 + c] && r2.bg[i * 4 + c] === base.bg[i * 4 + c]);
  if (gbuf.objectId[i] === 2) { if (!same) changed++; const e = Math.round(base.fg[i * 4] + (255 - base.fg[i * 4]) * 0.5); if (Math.abs(r2.fg[i * 4] - e) > 1) wrong++; }
  else if (!same) wrong++;
}
ok(changed > 0 && wrong === 0, 'only tinted objectId cells change, formula within 1 (changed ' + changed + ', wrong ' + wrong + ')');
console.log(fail ? 'entityTint: ' + fail + ' FAILED' : 'entityTint: all ok');
process.exit(fail ? 1 : 0);
