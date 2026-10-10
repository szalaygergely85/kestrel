// COMPASS-01 test. Run: node game/js/ui/compassHud.test.js  (add --expose-gc for the heap check; it re-spawns itself)
import { spawnSync } from 'node:child_process';
import { makeOk } from '../../../engine/test/assert.js';
import { createQuestBook } from '../quest/sim/questBook.js';
import { createCompassHud, FALLBACK_COMPASS_STYLE } from './compassHud.js';

let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, m => failures.push(m));

const main = { version: 1, id: 'm1', title: 'M', objectives: [
  { id: 'a', text: 'a', when: { type: 'area', id: 'breach' } },
  { id: 'b', text: 'b', when: { type: 'flag', id: 'f', equals: true } }] };
const boars = { version: 1, id: 'burl.boars', title: 'B', giver: { npc: 'bear' }, requires: [{ quest: 'm1', step: 'a' }],
  objectives: [{ id: 'k', text: 'k', when: { type: 'beasts', ids: ['b1', 'b2'], count: 2 } }] };
const POS = { 'giver:bear': [100, 0], 'area:breach': [0, -50], 'beast:b1': [30, 40], 'beast:b2': [-30, 40], 'flag:f': [5, 5] };
const world = { resolve(kind, id, out) { const p = POS[kind + ':' + id]; if (!p) return false; out.x = p[0]; out.y = p[1]; return true; } };
const mk = () => createQuestBook(main, [boars]);
const hud = () => createCompassHud({ style: FALLBACK_COMPASS_STYLE });

// priority: main step (area breach) while bear unavailable
let b = mk(), h = hud(), t = h.target(b, world);
ok('step target when no giver', t && t.x === 0 && t.y === -50 && t.kind === 2);
b.feed({ type: 'area:entered', id: 'breach' });
ok('book moved to step 2', b.questState(0).completed.length === 1, JSON.stringify(b.questState(0)));
t = h.target(b, world);
ok('available giver ! outranks nothing: step wins over !', t && t.kind === 3 || t.kind === 2, String(t && t.kind)); // flag step resolves -> kind 2
ok('flag step is preferred over available !', t.kind === 2 && t.x === 5);
POS['flag:f'] = null;
t = h.target(b, world);
ok('available giver ! when step has no position', t && t.kind === 3 && t.x === 100);
b.accept('burl.boars');
t = h.target(b, world);
ok('tracked beasts quest -> first living beast', t && t.kind === 2 && t.x === 30 && t.y === 40);
b.feed({ type: 'beast:died', id: 'b1' });
t = h.target(b, world);
ok('dead beast skipped', t.x === -30);
b.feed({ type: 'beast:died', id: 'b2' });
t = h.target(b, world);
ok('ready giver ? beats everything', b.statusOf('burl.boars') === 3 && t.kind === 1 && t.x === 100);
b.handIn('burl.boars');
POS['flag:f'] = [5, 5];
ok('after hand-in back to main step', h.target(b, world).kind === 2);
ok('null world/book -> no target', h.target(null, world) === null && !h.visible);

// bearing sectors: target north of player (y = -10), yaw 0 -> sector 0
const sec = (dx, dy, yaw) => { POS['area:breach'] = [dx, dy]; const b2 = mk(), hh = hud(); hh.target(b2, world); hh.step(0, 0, yaw); return hh.sector; };
ok('ahead yaw0 = 0', sec(0, -10, 0) === 0);
ok('east yaw0 = 2 (right)', sec(10, 0, 0) === 2);
ok('NE yaw0 = 1', sec(10, -10, 0) === 1);
ok('south yaw0 = 4', sec(0, 10, 0) === 4);
ok('west yaw0 = 6', sec(-10, 0, 0) === 6);
ok('east target yaw90 (facing east) = 0', sec(10, 0, 90) === 0);
ok('north target yaw90 = 6 (to the left)', sec(0, -10, 90) === 6);
ok('north target yaw180 = 4', sec(0, -10, 180) === 4);
ok('north target yaw270 = 2', sec(0, -10, 270) === 2);
ok('north target yaw45 = 7', sec(0, -10, 45) === 7);
ok('yaw negative wraps', sec(0, -10, -90) === 2);
const s16 = createCompassHud({ style: { ...FALLBACK_COMPASS_STYLE, sectors: 16 } });
POS['area:breach'] = [10, 0]; s16.target(mk(), world); s16.step(0, 0, 0);
ok('16 sectors: east = 4', s16.sector === 4);

// distance
POS['area:breach'] = [30, -40]; const hd = hud(); hd.target(mk(), world); hd.step(0, 0, 0);
ok('distance 50 m', hd.metres === 50 && hd.label === '50 m');
hd.step(0.2, -0.3, 0); ok('rounded', hd.metres === 50 || hd.metres === 49);

// draw / hidden
const cells = [];
const ui = { cols: 80, setCellRGB(x, y, g) { cells.push([x, y, g]); } };
hd.draw(ui, 80, 30);
ok('draws something bottom-right', cells.length > 6 && cells.every(c => c[0] >= 60 && c[1] >= 24 && c[1] < 30), JSON.stringify(cells.slice(0, 3)));
cells.length = 0; hd.setHidden(true); hd.draw(ui, 80, 30);
ok('hidden draws nothing', cells.length === 0 && !hd.visible);
hd.setHidden(false); const none = hud(); none.draw(ui, 80, 30);
ok('no target draws nothing', cells.length === 0);

// zero alloc
if (typeof global.gc === 'function') {
  const z = hud(); POS['area:breach'] = [30, -40]; z.target(mk(), world);
  const u = { cols: 80, setCellRGB() {} };
  for (let i = 0; i < 1000; i++) { z.step(i % 7, i % 5, i); z.draw(u, 80, 30); }
  global.gc(); const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 1e5; i++) { z.step(i % 7, i % 5, i); z.draw(u, 80, 30); }
  global.gc(); const after = process.memoryUsage().heapUsed;
  ok('step+draw 1e5 allocates nothing', after <= before + 2e5, `before=${before} after=${after}`);
} else if (!process.env.COMPASS_CHILD) {
  const r = spawnSync(process.execPath, ['--expose-gc', new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1'), '--child'], { env: { ...process.env, COMPASS_CHILD: '1' }, stdio: 'inherit' });
  ok('gc child run', r.status === 0);
}
console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach(f => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
