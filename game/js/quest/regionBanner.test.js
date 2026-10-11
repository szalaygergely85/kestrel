// game/js/quest/regionBanner.test.js (REGION-01). Run: node game/js/quest/regionBanner.test.js
import '../../../design/ui-region-banner.js';
import { createRegionBanner, regionIdAt, SEEN_KEY } from './regionBanner.js';
import { makeOk } from '../../../engine/test/assert.js';

let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const B = globalThis.ASSETS.uiRegionBanner;
const regions = [
  { id: 'tower', r: [1380, 930, 1600, 1130] }, { id: 'roadWest', r: [1150, 960, 1380, 1130] },
  { id: 'ford', r: [940, 1010, 1150, 1130] }, { id: 'outwall', r: [860, 700, 960, 1010] },
  { id: 'heartland', r: [0, 0, 2048, 2048] },
];
const colors = { gold: '#ffd24a' };
const mk = (state = {}) => createRegionBanner({ style: B.style, names: B.names, regions, state, colors });
const DT = 1 / 60;
function run(b, sec, x, y, blocked = false, onTick) { for (let i = 0; i < Math.round(sec / DT); i++) { b.step(DT, x, y, blocked); if (onTick) onTick(); } }

// AC1: one entry fires once; text is the approved name; times 0.4/2.5/0.6
{
  const st = {}, b = mk(st);
  b.step(DT, 1500, 1000, false);
  ok(b.active && b.text() === 'The Watchtower', 'first entry shows the approved name');
  ok(st[SEEN_KEY].includes('tower'), 'seen-set updated');
  run(b, 0.2, 1500, 1000); ok(b.alpha() > 0.4 && b.alpha() < 0.6, 'fade-in half way at 0.2 s: ' + b.alpha());
  run(b, 1.5, 1500, 1000); ok(b.alpha() === 1, 'hold = full');
  run(b, 1.5, 1500, 1000); ok(b.alpha() < 1 && b.alpha() > 0, 'fading out at ~3.2 s');
  run(b, 0.5, 1500, 1000); ok(!b.active && b.alpha() === 0, 'gone after ~3.5 s total');
}
// border jitter +-3 m for 20 s never re-fires
{
  const st = {}, b = mk(st); let fires = 0, was = false;
  const tick = () => { if (b.active && !was) fires++; was = b.active; };
  run(b, 5, 1500, 1000, false, tick); // tower, banner shown + done
  for (let i = 0; i < 20 * 60; i++) { b.step(DT, 1380 + (((i / 30) | 0) % 2 ? -3 : 3), 1000, false); tick(); } // x 1377/1383 flips tower<->roadWest every 0.5 s
  run(b, 1, 1385, 1000, false, tick);
  ok(fires === 1, 'jitter did not re-fire (fires=' + fires + ')');
  const b2 = mk({}); let f2 = 0, w2 = false;
  for (let i = 0; i < 20 * 60; i++) { b2.step(DT, 1150 + (((i / 30) | 0) % 2 ? -3 : 3), 1050, false); if (b2.active && !w2) f2++; w2 = b2.active; }
  ok(f2 === 1, 'ford border jitter fires once (' + f2 + ')');
}
// 10 min rule
{
  const b = mk({}); let fires = 0, was = false;
  const tick = () => { if (b.active && !was) fires++; was = b.active; };
  run(b, 5, 1500, 1000, false, tick);               // tower #1
  run(b, 300, 1250, 1000, false, tick);             // roadWest 5 min (no name)
  run(b, 1, 1500, 1000, false, tick);               // back after < 10 min
  ok(fires === 1, 'back after 5 min: no banner');
  run(b, 5, 1500, 1000, false, tick); run(b, 601, 1050, 1050, false, tick); // away > 10 min (ford: 1 banner)
  const before = fires; run(b, 5, 1500, 1000, false, tick);
  ok(fires === before + 1, 'back after >= 10 min: banner again (' + fires + ')');
}
// queued while blocked, shown after; not shown if player left meanwhile
{
  const b = mk({});
  run(b, 2, 1500, 1000, true);
  ok(!b.active && b.queued === 1 && b.alpha() === 0, 'blocked: queued, nothing shown');
  b.step(DT, 1500, 1000, false); ok(b.active, 'unblocked: shows');
  const c = mk({}); run(c, 1, 1500, 1000, true); run(c, 1, 1050, 1050, true); // tower then ford while blocked
  c.step(DT, 1050, 1050, false); ok(c.text() === 'The Crossroads', 'stale queued entry dropped, current region shown');
  const d = mk({}); d.step(DT, 1500, 1000, false); run(d, 1, 1500, 1000, true);
  const a0 = d.alpha(); run(d, 2, 1500, 1000, true); ok(d.alpha() === a0, 'paused while blocked');
}
// AC2: regions without an approved name show nothing; list them
{
  const none = regions.filter((r) => !B.names[r.id]).map((r) => r.id);
  console.log('regions without a name (test fixture):', none.join(', '));
  ok(none.includes('roadWest') && none.includes('outwall'), 'roadWest and outwall are nameless');
  const b = mk({}); b.step(DT, 1250, 1000, false); ok(!b.active && b.text() === '', 'nameless region: nothing');
  const b2 = mk({}); b2.step(DT, 900, 800, false); ok(!b2.active && b2.queued === 0, 'outwall: nothing, not even queued');
  for (const k of Object.keys(B.names)) if (B.names[k]) ok(B.names[k].length <= 16 && /^[\x20-\x7e]+$/.test(B.names[k]), 'name ASCII <= 16: ' + k);
}
// save round trip keeps the seen-set
{
  const st = {}, b = mk(st); run(b, 4, 1500, 1000);
  const saved = JSON.parse(JSON.stringify(st)), b2 = mk(saved);
  run(b2, 1, 1500, 1000); ok(!b2.active, 'loaded save: seen region silent');
  run(b2, 1, 1050, 1050); ok(b2.active, 'loaded save: unseen region still fires');
}
// 0 alloc per step (heap delta over 100k steps, no banner showing)
{
  const b = mk({}); run(b, 5, 1500, 1000); if (global.gc) global.gc();
  const h0 = process.memoryUsage().heapUsed; for (let i = 0; i < 100000; i++) b.step(DT, 1500 + (i & 1), 1000, i % 7 === 0);
  const d = process.memoryUsage().heapUsed - h0; ok(d < 400000, 'step allocates ~nothing: ' + d);
}
// draw: scaled path, even origin, width 2*len, centred
{
  const cells = []; const ui = { cols: 160, rows: 60, setCellScaled: (x, y, ch, fg, bg) => cells.push([x, y, ch, fg, bg]), setCell() {} };
  const b = mk({}); run(b, 1, 1500, 1000); b.draw(ui);
  const s = 'The Watchtower'; ok(cells.length === s.length && cells[0][0] % 2 === 0 && cells[0][1] % 2 === 0, 'scaled draw even origin');
  ok(cells[cells.length - 1][0] - cells[0][0] === 2 * (s.length - 1), 'step 2 per glyph');
  ok(cells[0][0] === (160 - 2 * s.length) / 2, 'centred');
  ok(cells[0][1] < 12, 'top of screen (clear of crosshair prompt and bottom-left hints)');
}
console.log(`regionBanner: ${pass} passed, ${fail} failed`); if (fail) { console.log(failures.join('\n')); process.exit(1); }
