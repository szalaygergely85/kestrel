// game/js/quest/handFireView.test.js - HAND-WIRE-01: viewModel variants + the realistic burning hand's clip sequence on
// press / hold / release / cancel, the always-on mapping and the glow. REAL view-model layer + the designer's hand asset.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { VoxelPool, createViewModelLayer, createParticles } from '../../../engine/index.js';
import { loadHandFireView, presentHandFire, bindHandFx, stepHandFx, setHandFlame, pushHandFlame } from './handFireView.js';
import { createFireballSim } from './sim/fireball.js';
import { makeOk } from '../../../engine/test/assert.js';
import '../../../design/palette.js';
import '../../../design/detail-pass.js';
import '../../../design/models/particles.js';

if (typeof global.gc !== 'function') {
  const res = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}
let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

const t0 = performance.now();
await import('../../../design/models/hand.js');
const tBuild = performance.now() - t0;
const A = globalThis.ASSETS;
const def = A.viewModels.hand;
ok('26 variants', Object.keys(def.variants).length === 26, String(Object.keys(def.variants).length));
ok('handFx.validate clean', A.handFx.validate(A.palette).length === 0, A.handFx.validate(A.palette).join('; '));

const MODELS = {};
for (const mk of Object.values(def.variants)) MODELS[mk] = { voxel: { ...A.voxelModels[mk].voxel, meshOnly: true } };
const registry = { keys: (kind) => (kind === 'model' ? Object.keys(MODELS) : []), model: (k) => MODELS[k] };
const idMap = new Map();
const table = { idFor(key) { if (!idMap.has(key)) idMap.set(key, idMap.size + 1); return idMap.get(key); } };
const pool = new VoxelPool();
const t1 = performance.now();
pool.bind(registry, table);
const vm = createViewModelLayer();
const vmh = loadHandFireView(vm, def, pool);
const tLoad = performance.now() - t1;
const t2 = performance.now();
vm.warmVariants(vmh.h);
const tWarm = performance.now() - t2;
console.log(`boot cost: hand.js build ${tBuild.toFixed(0)} ms (designer, load time), pool.bind+load ${tLoad.toFixed(0)} ms, warm 26 variants ${tWarm.toFixed(0)} ms`);

// ---- engine variants
const d = vm._defs[vmh.h];
const idOpen = vm.variantId(vmh.h, 'open'), idFist = vm.variantId(vmh.h, 'chargeA');
vm.setVariant(vmh.h, idOpen); const meshOpen = d.mesh;
vm.setVariant(vmh.h, 'chargeA');
ok('setVariant swaps the mesh', d.mesh !== meshOpen && d.vCur === idFist);
ok('setVariant back restores it (cached)', (vm.setVariant(vmh.h, idOpen), d.mesh === meshOpen));
let threw = false; try { vm.variantId(vmh.h, 'nope'); } catch { threw = true; }
ok('unknown variant throws', threw);
ok('same variant = no-op', (vm.setVariant(vmh.h, idOpen), d.vCur === idOpen));

// ---- sequence via a fake sim
const fs = { state: 0, holdSteps: 0, tick: 100, castTick: -1000000 };
const hv = (t = 1) => presentHandFire(vmh, 'right', t, t, false, fs);
const varName = () => def.variants && vm._defs[vmh.h].vNames[vmh.variant];
const clipNow = () => vmh.kind;
hv();
ok('idle: always-on fire (flame cycle variant)', /^flame/.test(varName()), varName());
ok('idle glow = fireIdle 0.8', Math.abs(vmh.glow - 0.8) < 1e-6, String(vmh.glow));
ok('hand mirrored to the right', vm.handOf(vmh.h) === 'right' && d.mirror === 1);
fs.state = 1; fs.holdSteps = 1; fs.tick++; hv();
ok('press: charge clip, kind CHARGE', clipNow() === 1);
fs.holdSteps = 12; fs.tick++; hv(1.2);
ok('charging (200 ms): charge variant, glow grows', /^charge/.test(varName()) && vmh.glow > 1.0 && vmh.glow <= 1.6, // modest brightening
    varName() + ' ' + vmh.glow);
fs.state = 2; fs.holdSteps = 36; fs.tick++; hv(1.4);
ok('held: chargeHold, full-charge variant, glow ~1.5 (modest)', clipNow() === 2 && /^charge[CD]$/.test(varName()) && vmh.glow > 1.3 && vmh.glow < 1.8, varName() + ' ' + vmh.glow);
// release with cast
fs.state = 0; fs.holdSteps = 0; fs.tick++; fs.castTick = fs.tick; hv(1.5);
ok('release+cast: fireCast from 300 ms', clipNow() === 3, vmh.glow + ' kind ' + clipNow());
fs.tick += 6; hv(1.6); // +100 ms -> 400 ms: past the 383 release key
ok('fireCast mid: burnCast variant', /^burnCast/.test(varName()), varName());
fs.tick += 30; hv(1.9);
ok('after fireCast: back to idle fire', clipNow() === 0 && /^flame/.test(varName()), varName());
// press then cancel
fs.state = 1; fs.holdSteps = 20; fs.tick++; hv(2.0);
fs.state = 0; fs.holdSteps = 0; fs.tick++; hv(2.0); // cancel(): state idle, castTick unchanged
ok('cancel: chargeOut', clipNow() === 4, String(clipNow()));
fs.tick += 6; hv(2.1);
ok('chargeOut shows the fire spreading (flame variant after 140 ms)', clipNow() === 4 && glowOk(), varName());
function glowOk() { return vmh.glow > 0.7 && vmh.glow < 1.9; }
fs.tick += 40; hv(2.5);
ok('chargeOut ends -> idle', clipNow() === 0);
ok('hidden when the item is not in a hand', (presentHandFire(vmh, null, 1, 1, false, fs), !d.visible));
ok('every fire clip has a glow (the light never goes out)', Object.values(def.alwaysOn).every((c) => def.glow[c]));

// ---- 0 alloc
{
  const sides = ['right', 'left', 'right', null];
  const run = (n) => { for (let i = 0; i < n; i++) { fs.state = (i >> 6) & 1 ? 2 : 0; fs.holdSteps = i & 63; fs.tick++; presentHandFire(vmh, sides[(i >> 4) & 3], i * 0.016, i * 0.016, (i & 8) === 0, fs); } };
  run(4000);
  let grown = Infinity;
  for (let r = 0; r < 3; r++) { gc(); gc(); const b = process.memoryUsage().heapUsed; run(5000); gc(); gc(); grown = Math.min(grown, process.memoryUsage().heapUsed - b); }
  ok('0 alloc per frame (< 32 KB / 5000 frames)', grown < 32768, grown + ' bytes');
}
// ---- the real fireball sim drives it (smoke)
{
  const fsim = createFireballSim({ solidAt: () => false, heightAt: () => 0 }, { emit() {} }, (await import('./spellConfig.js')).FIREBALL_CFG, { n: 0, x: [], y: [], z: [], h: [], ent: [] }, { spendMana: () => true });
  ok('real sim exposes state/holdSteps/castTick/tick', ['state', 'holdSteps', 'castTick', 'tick'].every((k) => k in fsim));
}

// ---- HAND-WIRE-02: the variant voxel output is golden (HAND-FIRE-FX-01: re-baselined, voxel flames off) (golden sha1 of all 26 models)
{
  const hsh = createHash('sha1');
  for (const k of Object.keys(A.voxelModels).sort()) { hsh.update(k); hsh.update(JSON.stringify(A.voxelModels[k], (kk, v) => (ArrayBuffer.isView(v) ? Array.from(v) : v))); }
  ok('hand variant voxels unchanged (sha1)', hsh.digest('hex') === '725b021258b9d658bcdbfd12aa3a93cf8f69bedb');
  ok('HAND-FIRE-FX-01: no voxel flame blocks in any variant (FIRE_VOXELS=false)', Object.keys(A.voxelModels).filter((k) => /^hand/.test(k)).every((k) => A.voxelModels[k].stats.fire === 0));
}

// ---- HAND-WIRE-02: quick-tap blend (fireCast starts at the matching charge pose, catches up to 300 ms)
{
  const castT = (holdSteps, afterSteps) => { // press, hold `holdSteps`, release+cast, then `afterSteps` later: the fireCast clip time
    const q = { state: 1, holdSteps: 0, tick: 1000, castTick: -1000000 };
    const v = createViewModelLayer(); const hh = loadHandFireView(v, def, pool);
    for (let i = 1; i <= holdSteps; i++) { q.holdSteps = i; q.tick++; presentHandFire(hh, 'right', q.tick / 60, 0, false, q); }
    q.state = 0; q.holdSteps = 0; q.tick++; q.castTick = q.tick;
    presentHandFire(hh, 'right', q.tick / 60, 0, false, q);
    const t0 = hh.clock.tMs, k0 = hh.clock.kind;
    q.tick += afterSteps; presentHandFire(hh, 'right', q.tick / 60, 0, false, q);
    return [t0, k0, hh.clock.tMs, hh.clock.kind];
  };
  const tap = castT(6, 0), later = castT(6, 6), full = castT(30, 0);
  ok('tap (100 ms): fireCast starts at the matching pose, not 300', tap[1] === 3 && Math.abs(tap[0] - 100) < 1e-6, String(tap));
  ok('tap catches up: 100 ms after release it is past 300', later[2] > 300 && later[2] < 420, String(later));
  ok('full hold: unchanged 300 ms start', full[1] === 3 && Math.abs(full[0] - 300) < 1e-6, String(full));
}
// ---- HAND-FIRE-FX-01: no charge-specific rule anywhere
{
  const P0 = createParticles();
  A.handFx.attach(); // defines the presets once (the particles block below reuses them)
  for (const k of Object.keys(A.handFx.particles)) { const pr = A.particles.presets[k]; if (pr.spreadDeg > 88.9) pr.spreadDeg = 88.9; P0.defineEmitter(k, A.particles.toEmitterDef(k, A.palette.rgb)); }
  const hh0 = loadHandFireView(createViewModelLayer(), def, pool); const f0 = bindHandFx(hh0, P0, { right: 0.22, fwd: 0.5, down: 0.135 });
  ok('every clip has the handFlame rule; idle has no sparks', ['idle', 'charge', 'hold', 'cast', 'out'].every((r) => f0.rulesOf[r].some((x) => x.preset === 'handFlame')) && f0.rulesOf.idle.every((x) => x.preset !== 'handChargeSparks'));
}
// ---- HAND-FIRE-FX-01: emitter side = rendered hand side (owner: 'my hand is on the right, the particles on the left')
{
  const rec = { x: 0, y: 0, z: 0 }, mock = { defIdOf: () => 1, isValid: () => true, createEmitter: (d, x, y, z) => { rec.x = x; rec.y = y; return 1; },
    setEmitterPos: (h, x, y, z) => { rec.x = x; rec.y = y; rec.z = z; }, setEmitterDir() {}, burst() {} };
  const hh = loadHandFireView(createViewModelLayer(), def, pool);
  const fx = bindHandFx(hh, mock, { right: 0.22, fwd: 0.5, down: 0.135 });
  const q = { state: 0, holdSteps: 0, tick: 1000, castTick: -1000000 };
  // yaw 0: forward (0,-1) (engine forwardOf), so the right-hand side is +x, the left -x; forward is -y
  stepHandFx(hh, 'right', q, 0, 0, 1.6, 0, -1, 0, -1, 0); const rx = rec.x, ry = rec.y;
  q.tick += 2; stepHandFx(hh, 'left', q, 0, 0, 1.6, 0, -1, 0, -1, 0); const lx = rec.x;
  ok('right hand: emitter on the +x (right) side, ahead of the eye', rx > 0.2 && ry < -0.4, rx + ' ' + ry);
  ok('left hand: emitter on the -x (left) side', lx < -0.2, String(lx));
  // yaw 90 deg: forward (1,0), right is +y
  q.tick += 2; stepHandFx(hh, 'right', q, 0, 0, 1.6, 1, 0, 1, 0, 0);
  ok('right hand at yaw 90: emitter on the +y side', rec.y > 0.2 && rec.x > 0.4, rec.x + ' ' + rec.y);
}
// ---- HAND-FIRE-FX-01: the translucent flame sprite per state, 0 alloc, never a flat single-colour quad
{
  const pushes = []; const spool = { push: (m, a, f, x, y, z) => pushes.push([m, f, x, y, z]) };
  const hh = loadHandFireView(createViewModelLayer(), def, pool);
  const q = { state: 0, holdSteps: 0, tick: 1000, castTick: -1000000 };
  setHandFlame(hh, false, 0, 0, 0, 0, 0, 0, 0); pushHandFlame(hh, spool);
  ok('no hand -> no flame sprite', pushes.length === 0);
  presentHandFire(hh, 'right', 1, 0, false, q); setHandFlame(hh, true, 0, -0.5, 1.5, 1, 0, 0, 1.6); pushHandFlame(hh, spool);
  ok('idle: handFlame sprite', pushes.length === 1 && pushes[0][0] === 'handFlame', JSON.stringify(pushes));
  ok('flame kept out of the sprite near cull (>= 0.6 m from the eye)', Math.hypot(pushes[0][2], pushes[0][3] - 0, pushes[0][4] - 1.6) >= 0.6);
  q.state = 1; q.holdSteps = 30; presentHandFire(hh, 'right', 1.5, 0, false, q); setHandFlame(hh, true, 0, -0.5, 1.5, 1.5, 0, 0, 1.6); pushes.length = 0; pushHandFlame(hh, spool);
  ok('charge: handFlameCharged sprite', pushes.length === 1 && pushes[0][0] === 'handFlameCharged', JSON.stringify(pushes));
  const nf = { n: 0 }; const pool2 = { push() { nf.n++; } };
  for (let i = 0; i < 3000; i++) { setHandFlame(hh, true, 0, -0.5, 1.5, i / 60, 0, 0, 1.6); pushHandFlame(hh, pool2); }
  gc(); gc(); const b0 = process.memoryUsage().heapUsed;
  for (let i = 0; i < 20000; i++) { setHandFlame(hh, true, 0, -0.5, 1.5, i / 60, 0, 0, 1.6); pushHandFlame(hh, pool2); }
  gc(); gc();
  ok('flame push: 0 alloc', process.memoryUsage().heapUsed - b0 < 32768, String(process.memoryUsage().heapUsed - b0));
  // art check: every frame of both sprites is glyph fire (several distinct glyphs + empty corners), not a flat filled quad
  const spr = (await import('../../../design/models/spell.js')) && A.spellSprites;
  const flat = [];
  for (const n of ['handFlame', 'handFlameCharged']) for (const tier of [spr[n], spr[n].lods.half]) for (const fr of tier.animations.fly.frames) {
    const g = fr.S.glyphs.join(''), kinds = new Set(g.replace(/ /g, '')), fgs = new Set(fr.S.fg.join('').replace(/ /g, ''));
    if (kinds.size < 4 || fgs.size < 3 || !g.includes(' ')) flat.push(n);
  }
  ok('no flat single-colour fire quad (glyph variety, >= 3 colour keys, empty corners)', flat.length === 0, flat.join());
}
// ---- HAND-WIRE-02: particles per clip
{
  const P = createParticles();
  for (const k of Object.keys(A.handFx.particles)) { const pr = A.particles.presets[k]; if (pr.spreadDeg > 88.9) pr.spreadDeg = 88.9; P.defineEmitter(k, A.particles.toEmitterDef(k, A.palette.rgb)); } // same clamp as main.js
  const v = createViewModelLayer(); const hh = loadHandFireView(v, def, pool);
  const fx = bindHandFx(hh, P, { right: 0.22, fwd: 0.5, down: 0.135 });
  const q = { state: 0, holdSteps: 0, tick: 1000, castTick: -1000000 };
  const run = (n, hand = 'right') => { const b = fx.stats.bursts; for (let i = 0; i < n; i++) { q.tick++; if (q.state) q.holdSteps++; stepHandFx(hh, hand, q, 0, 0, 1.6, 0, 1, 0, 1, 0); P.step(); } return fx.stats.bursts - b; };
  ok('idle: flame every 2 steps + embers every 12 (90 steps -> 45+7)', run(90) >= 50 && run(0) === 0, String(fx.stats.bursts));
  ok('no hand -> no particles', run(30, null) === 0);
  q.state = 1; q.holdSteps = 0;
  const nCharge = run(24); // charge clip: denser flame + a few sparks
  ok('charge: flame doubles, a few sparks', nCharge >= 18 && nCharge <= 30, String(nCharge));
  const nHold = run(60);
  ok('hold: flame every step + sparks (60 steps -> ~75)', nHold >= 70 && nHold <= 80, String(nHold));
  q.state = 0; q.holdSteps = 0; q.tick++; q.castTick = q.tick; // release with a cast
  let maxLive = 0;
  const nCast = (() => { const b = fx.stats.bursts; for (let i = 0; i < 12; i++) { run(1); if (P.stats.live > maxLive) maxLive = P.stats.live; } return fx.stats.bursts - b; })();
  ok('cast: ignite (383 ms) + at most one leftover spark in the first 200 ms', nCast >= 1 && nCast <= 2, String(nCast));
  ok('ignite particles are live (12-spark burst)', maxLive >= 10, String(maxLive));
  run(60);
  q.state = 1; q.holdSteps = 12; run(2); q.state = 0; q.holdSteps = 0; // press then cancel
  const nOut = run(40);
  ok('chargeOut: flame continues', nOut >= 18, String(nOut)); // + a few idle embers after the clip
  // 0 alloc
  const stepN = (n) => { for (let i = 0; i < n; i++) { q.tick++; q.state = (i >> 7) & 1; q.holdSteps = q.state ? i & 127 : 0; stepHandFx(hh, 'left', q, 0, 0, 1.6, 0, 1, 0, 1, 0); P.step(); } };
  stepN(3000);
  let grown = Infinity;
  for (let r = 0; r < 3; r++) { gc(); gc(); const b = process.memoryUsage().heapUsed; stepN(5000); gc(); gc(); grown = Math.min(grown, process.memoryUsage().heapUsed - b); }
  ok('particle step: 0 alloc (< 32 KB / 5000 steps)', grown < 32768, grown + ' bytes');
}
console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
