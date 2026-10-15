// DIFF-MENU (D-083): difficulty setting persists, cycles Easy->Normal->Hard->Easy, sim receives it. Run: node game/js/ui/difficultyMenu.test.js
import assert from 'node:assert/strict';
import { loadSettings, saveSettings, DEFAULT_SETTINGS } from '../platform/web.js';
import { resolveDifficulty } from '../quest/sim/difficulty.js';
import { readFileSync } from 'node:fs';
const mem = {}; globalThis.window = { localStorage: { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } } };
assert.equal(DEFAULT_SETTINGS.difficulty, 'normal');
assert.equal(loadSettings().difficulty, 'normal');
saveSettings({ difficulty: 'hard' }); assert.equal(loadSettings().difficulty, 'hard');
saveSettings({ difficulty: 'bogus' }); assert.equal(loadSettings().difficulty, 'hard', 'invalid ignored');
saveSettings({ volume: 0.5 }); assert.equal(loadSettings().difficulty, 'hard', 'kept across other saves');
const order = ['easy', 'normal', 'hard']; let i = 0; const seen = [];
for (let n = 0; n < 4; n++) { seen.push(order[i]); i = (i + 1) % 3; }
assert.deepEqual(seen, ['easy', 'normal', 'hard', 'easy']);
const src = readFileSync(new URL('./settings.js', import.meta.url), 'utf8');
assert.ok(/values:\['easy','normal','hard'\], default:'normal'/.test(src), 'option def cycles easy/normal/hard');
assert.ok(!/Esc to close/i.test(src));
assert.ok(readFileSync(new URL('../quest/sim/beastSim.js', import.meta.url), 'utf8').includes('sim.setDifficulty'), 'sim setter');
assert.equal(resolveDifficulty('hard').name, 'hard');
console.log('difficultyMenu: ok');
