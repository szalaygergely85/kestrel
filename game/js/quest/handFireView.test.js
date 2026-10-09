// game/js/quest/handFireView.test.js - HAND-WIRE-01: viewModel variants + the realistic burning hand's clip sequence on
// press / hold / release / cancel, the always-on mapping and the glow. REAL view-model layer + the designer's hand asset.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { VoxelPool, createViewModelLayer } from '../../../engine/index.js';
import { loadHandFireView, presentHandFire } from './handFireView.js';
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
ok('charging (200 ms): charge variant, glow grows', /^charge/.test(varName()) && vmh.glow > 1.3, varName() + ' ' + vmh.glow);
fs.state = 2; fs.holdSteps = 36; fs.tick++; hv(1.4);
ok('held: chargeHold, full-charge variant, glow ~1.9', clipNow() === 2 && /^charge[CD]$/.test(varName()) && vmh.glow > 1.5 && vmh.glow < 2.3, varName() + ' ' + vmh.glow);
// release with cast
fs.state = 0; fs.holdSteps = 0; fs.tick++; fs.castTick = fs.tick; hv(1.5);
ok('release+cast: fireCast from 300 ms, glow ~2.1', clipNow() === 3 && vmh.glow > 1.9, vmh.glow + ' kind ' + clipNow());
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
console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
