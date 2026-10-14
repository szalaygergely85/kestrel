// GI-PROBE-04: JS twin lighting with GI. ACs: gi null/off -> 3 poses byte-identical to the pre-GI code (pinned FNV),
// fixture room interior ambient < 0.3 x outdoor, 0 alloc per frame at 480x180 (allocProbe, --expose-gc), bench note.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const SELF = fileURLToPath(import.meta.url);
if (typeof global.gc !== 'function') process.exit(spawnSync(process.execPath, ['--expose-gc', SELF], { stdio: 'inherit' }).status ?? 1);
const { LightSet, lightSurfaces, lightAt, makeLightBuffer } = await import('./lighting.js');
const old = process.env.GI_OLD === '1' ? await import('./_oldLighting.js') : null;
const { createGIState } = await import('./giProbe.js');
const { allocProbe } = await import('../../tools/allocProbe.mjs');
let bad = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) bad++; };

const { makeGI, mkLS, makeFb, POSES, fnv } = await import('./giFixture.js');
const gi = makeGI(), field = gi.field;
// AC2: interior vs outdoor ambient through lightAt (z up, floor normal +z), no sun, no points
{
  const ls = mkLS(); ls.gi = gi; const o = new Float32Array(3), i = new Float32Array(3);
  ls.count = 0; ls.sun.on = false; gi.emisK = 0; // sky/bounce only (the fixture room also glows)
  lightAt(ls, null, 4, 4, 0.2, 0, 0, 1, o, null, 0, true, null);
  lightAt(ls, null, 28, 28, 0.2, 0, 0, 1, i, null, 0, true, null);
  gi.emisK = 1; const ratio = i[1] / o[1];
  ok(ratio < 0.3 && ratio > 0, `room interior ambient / outdoor = ${ratio.toFixed(3)} (< 0.3)`);
  ls.gi = null; lightAt(ls, null, 4, 4, 0.2, 0, 0, 1, i, null, 0, true, null);
  ok(Math.abs(i[0] - 0.3) < 1e-6, 'gi null -> flat ambient');
}
// AC1: 3 poses x (gi null, gi attached but off) byte-identical to the pre-GI lighting (pinned FNV from _oldLighting.js = HEAD)
const cols = 480, rows = 180, n = cols * rows;
const fb = makeFb(cols, rows), lb = fb.light, poses = POSES, hash = () => fnv(lb.rgb);
if (process.env.DBG) { const ls = mkLS(); for (const p of poses) { lightSurfaces(fb, ls, p, null); console.log(Array.from(lb.rgb.slice(40000*3, 40000*3+6)), ls.count, ls.sun.on); } }
if (old) { const ls = new old.LightSet(); ls.ambient.set([0.3, 0.35, 0.4]); ls.count = 2; for (let i = 0; i < 2; i++) { ls.on[i] = 1; ls.visW[i] = 0; ls.visH[i] = 0; ls.pos.set([4 + 6 * i, 3, 8, 40], i * 4); ls.col.set([1, 0.8, 0.5, 1], i * 4); } ls.sun.on = true; ls.sun.dir[0] = 0.3; ls.sun.dir[1] = 0.2; ls.sun.dir[2] = 0.9; ls.sun.col.set([1, 0.9, 0.8]); ls.update(0, null); console.log('PIN', poses.map((p) => { old.lightSurfaces(fb, ls, p, null); return hash(); })); process.exit(0); }
const PINNED = [421707674, 421707674, 421707674]; // FNV of the pre-GI (HEAD) lightSurfaces output
{
  const ls = mkLS(); const off = createGIState(); off.field = field; off.on = false;
  for (const variant of ['null', 'off']) { ls.gi = variant === 'null' ? null : off;
    poses.forEach((p, k) => { lightSurfaces(fb, ls, p, null); ok(hash() === PINNED[k], `pose ${k} gi ${variant} hash 0x${hash().toString(16)} == pinned 0x${PINNED[k].toString(16)}`); }); }
}
// AC1b: gi ON hashes pinned (non-uniform fixture: GI must change the image, and a regression must flip the hash)
{
  const ls = mkLS(); ls.gi = gi; const PIN_ON = [3649665323, 950581559, 483134966];
  poses.forEach((p, k) => { lightSurfaces(fb, ls, p, null); const h = hash(); if (process.env.DBG) console.log('ON', h);
    ok(h !== PINNED[k], `pose ${k} gi on differs from gi null`); ok(h === PIN_ON[k], `pose ${k} gi on hash 0x${h.toString(16)} pinned`); });
}
// AC3: 0 alloc per frame with GI on (+ AO on), bench delta
{
  const ls = mkLS(); ls.gi = gi; lightSurfaces(fb, ls, poses[0], null);
  const r = allocProbe((k) => { for (let i = 0; i < k; i++) lightSurfaces(fb, ls, poses[i % 3], null); }, { n: 6, warm: 3, windows: 5 });
  ok(r.bytes < 4096, `gi on lightSurfaces 480x180: ${r.bytes} B per ${r.n} frames`);
  const t = (on) => { ls.gi = on ? gi : null; for (let i = 0; i < 5; i++) lightSurfaces(fb, ls, poses[0], null); const t0 = performance.now(); for (let i = 0; i < 20; i++) lightSurfaces(fb, ls, poses[0], null); return (performance.now() - t0) / 20; };
  const a = t(false), b = t(true), a2 = t(false), b2 = t(true);
  console.log(`BENCH lightSurfaces 480x180 (base, no sun/points): off ${Math.min(a, a2).toFixed(2)} ms, on ${Math.min(b, b2).toFixed(2)} ms`);
}
process.exit(bad ? 1 : 0);
