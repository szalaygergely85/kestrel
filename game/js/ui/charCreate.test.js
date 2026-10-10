import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createUiLayer, randomRecipe, validateRecipe } from '../../../engine/index.js';
import { createCharCreate, buildPlayerModel } from './charCreate.js';
import { createTitleMenuHost } from '../titleMenuHost.js';
import { createMemoryAdapter } from '../quest/save/saveState.js';

const kit = JSON.parse(readFileSync(new URL('../../../content/chargen/human.charkit.json', import.meta.url)));
const ctx = vm.createContext({});
vm.runInContext(readFileSync(new URL('../../../design/models/menu_ui.js', import.meta.url), 'utf8'), ctx);
const style = JSON.parse(JSON.stringify(ctx.ASSETS.uiStyle.menu));
const keys = (...c) => { const q = new Set(c); return (x) => q.has(x); };

// rows come from the kit: skin/eyes/height/age, one item + colour pair per slot with items (CHARGEN-25 kit: clothes + hair),
// then Random/Confirm/Back. Navigation below goes by row id, so it does not depend on how many slots the kit fills.
let cc = createCharCreate({ kit, style, seed: 7 });
assert.deepEqual(cc.snapshot().rows, ['skin', 'eyes', 'height', 'age', 'legs', 'legsRamp', 'feet', 'feetRamp', 'top', 'topRamp',
  'outer', 'outerRamp', 'hair', 'hairRamp', 'random', 'confirm', 'back']);
const ROWS = cc.snapshot().rows, rowOf = (id) => ROWS.indexOf(id);
cc.handleKey('KeyD'); assert.equal(cc.snapshot().look.skin, 'brown');
for (let i = 0; i < 4; i++) cc.handleKey('KeyA'); assert.equal(cc.snapshot().look.skin, 'dark', 'wraps');
cc.handleKey('KeyS'); cc.handleKey('ArrowRight'); assert.equal(cc.snapshot().look.eyes, 'grey');
cc.handleKey('KeyS'); for (let i = 0; i < 9; i++) cc.handleKey('KeyD'); assert.equal(cc.snapshot().look.height, 4, 'height clamps');
cc.handleKey('KeyS'); cc.handleKey('Enter'); assert.equal(cc.snapshot().look.age, 'elder');
cc.handleKey('KeyW'); assert.equal(cc.snapshot().selected, 2);
// Random is deterministic from the seed and valid
const rnd = (seed) => { const c = createCharCreate({ kit, seed }); for (let i = 0; i < rowOf('random'); i++) c.handleKey('KeyS'); c.handleKey('Enter'); return c.snapshot().look; };
assert.deepEqual(rnd(5), rnd(5)); assert.deepEqual(rnd(5), randomRecipe(kit, 5)); assert.equal(validateRecipe(kit, rnd(5)).errors.length, 0);
// draw (no throw, styled and plain)
const ui = createUiLayer({ cols: 160 });
cc.draw(ui); createCharCreate({ kit, colorOf: () => '#aabbcc' }).draw(ui); createCharCreate({ kit, style, colorOf: () => '#aabbcc' }).draw(ui);
// Confirm registers char.player and emits the look; Back/Escape emit back
const reg = []; cc = createCharCreate({ kit, style, register: (d) => reg.push(d) });
cc.handleKey('KeyD'); for (let i = 0; i < rowOf('confirm'); i++) cc.handleKey('KeyS');
cc.handleKey('Enter'); const a = cc.takeAction();
assert.equal(a.type, 'confirm'); assert.equal(a.look.skin, 'brown'); assert.equal(reg.length, 1); assert.ok(reg[0].voxel);
assert.deepEqual(buildPlayerModel(kit, a.look).voxel.size, reg[0].voxel.size);
cc = createCharCreate({ kit }); cc.handleKey('KeyW'); cc.handleKey('Enter'); assert.equal(cc.takeAction().type, 'back');
cc = createCharCreate({ kit }); cc.handleKey('Escape'); assert.equal(cc.takeAction().type, 'back');
// a kit with items grows hair/clothes rows (+ colour rows)
const kit2 = { ...kit, shells: [], attachments: [{ id: 'short', slot: 'hair' }] };
assert.deepEqual(createCharCreate({ kit: kit2 }).snapshot().rows.slice(4, 6), ['hair', 'hairRamp']);

// host flow: New game -> creation screen (menu stays active) -> Back -> menu; New game -> Confirm -> onNewGame(slot, look)
const log = []; let regd = 0;
const mk = (extra = {}) => createTitleMenuHost({ adapter: createMemoryAdapter(), onNewGame: (s, l) => log.push(['new', s, l && l.skin]), onContinue() {}, onSettings() {},
  createCharCreate: () => createCharCreate({ kit, style, seed: 3, register: () => regd++ }), ...extra });
let h = mk();
h.step(keys('Enter')); h.step(keys('Enter')); // New game -> slot list -> first empty slot
assert.equal(h.createOpen, true); assert.equal(h.active, true); assert.deepEqual(log, []);
assert.equal(h.pointer(5, 5, true), false);
h.draw(ui);
h.step(keys('Escape')); assert.equal(h.createOpen, false); assert.equal(h.active, true, 'Back returns to the menu');
h.step(keys('Enter')); h.step(keys('Enter')); assert.equal(h.createOpen, true);
h.step(keys('KeyD')); for (let i = 0; i < rowOf('confirm'); i++) h.step(keys('KeyS')); h.step(keys('Enter'));
assert.deepEqual(log, [['new', 0, 'brown']]); assert.equal(h.active, false); assert.equal(regd, 1);
// without a creator New game starts at once (capture/bench paths)
log.length = 0; h = mk({ createCharCreate: null }); h.step(keys('Enter')); h.step(keys('Enter'));
assert.deepEqual(log, [['new', 0, undefined]]);
console.log('charCreate.test: ok');
