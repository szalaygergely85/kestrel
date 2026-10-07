// game/js/quest/spellHandView.test.js - HANDS-01c: the spell hand shows/hides with the inventory, follows the hand side
// and swaps, allocates nothing per frame. Uses the REAL view-model layer + the designer's spellHand asset.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { VoxelPool, createViewModelLayer } from '../../../engine/index.js';
import { createHands } from './sim/hands.js';
import { ensureInventory } from './sim/inventory.js';
import { loadSpellHandView, presentSpellHand, SPELL_HAND_ITEM } from './spellHandView.js';
import { makeOk } from '../../../engine/test/assert.js';
import '../../../design/palette.js';
import '../../../design/detail-pass.js';
import '../../../design/models/spell.js';

if (typeof global.gc !== 'function') { // zero-alloc check needs gc
  const res = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

const A = globalThis.ASSETS;
const MODELS = { spellHandL: { voxel: { ...A.voxelModels.spellHandL.voxel, meshOnly: true } } };
const registry = { keys(kind) { return kind === 'model' ? Object.keys(MODELS) : []; }, model(k) { return MODELS[k]; } };
const idMap = new Map();
const table = { idFor(key) { if (!idMap.has(key)) idMap.set(key, idMap.size + 1); return idMap.get(key); } };
const pool = new VoxelPool();
pool.bind(registry, table);

const vm = createViewModelLayer();
const vmh = loadSpellHandView(vm, A.viewModels.spellHand, pool);
const visible = () => vm._defs[vmh.h].visible;
const player = { components: {} };
const hands = createHands({ emit() {} });
hands.register(SPELL_HAND_ITEM, { cancel() {}, setHand() {} });
function frame(t = 1.0) { hands.step(player, false, false, true); present(t); }
function present(t) { presentSpellHand(vmh, hands.handOf(SPELL_HAND_ITEM), t, t, false); }

ok('authored hand is left', vm.handOf(vmh.h) === 'left');
ok('hidden before any inventory', (frame(), !visible()));

ensureInventory(player, { pack: [{ id: SPELL_HAND_ITEM, n: 1 }], left: null, right: SPELL_HAND_ITEM });
frame();
ok('item in right hand: visible, handle mirrored to right', visible() && vm.handOf(vmh.h) === 'right');
ok('mirrored = flag set (authored left)', vm._defs[vmh.h].mirror === 1);

player.components.inventory.right = null; player.components.inventory.left = SPELL_HAND_ITEM;
frame();
ok('item in left hand: visible, authored side, unmirrored', visible() && vm.handOf(vmh.h) === 'left' && vm._defs[vmh.h].mirror === 0);

hands.swap(); frame();
ok('swap moves the view to the right hand', visible() && vm.handOf(vmh.h) === 'right');
hands.swap(); frame();
ok('swap back returns to the left hand', visible() && vm.handOf(vmh.h) === 'left');

player.components.inventory.left = null; frame();
ok('item removed from hands: hidden', !visible());
player.components.inventory.left = 'sword'; frame();
ok('only another item in hand: still hidden', !visible());

ok('null view-model handle is a no-op', (presentSpellHand(null, 'left', 0, 0, false), true));

// idle clip actually plays (pose changes over the breathing loop)
player.components.inventory.left = null; player.components.inventory.right = SPELL_HAND_ITEM; frame(0);
const P = vm._defs[vmh.h].last, z0 = P[2];
frame(1.0);
ok('idle clip animates', Math.abs(P[2] - z0) > 1e-4, `${z0} -> ${P[2]}`);

// 0 allocation per frame in the view (shown left/right, hidden); hands.step has its own test
if (typeof globalThis.gc === 'function') {
  const sides = ['right', 'left', 'right', null];
  for (let i = 0; i < 4000; i++) presentSpellHand(vmh, sides[i & 3], i * 0.016, i * 0.016, (i & 8) === 0);
  let grown = Infinity;
  for (let round = 0; round < 3; round++) { // min over rounds: heapUsed also moves with JIT / GC bookkeeping
    globalThis.gc(); globalThis.gc(); const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 5000; i++) presentSpellHand(vmh, sides[i & 3], i * 0.016, i * 0.016, (i & 8) === 0);
    globalThis.gc(); globalThis.gc(); grown = Math.min(grown, process.memoryUsage().heapUsed - before);
  }
  ok('0 alloc per frame (heap growth < 32 KB over 5000 frames)', grown < 32768, grown + ' bytes');
} else ok('gc exposed', false, 'run via tools/run-tests.mjs (--expose-gc) or node --expose-gc');

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
