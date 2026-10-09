import { createHurtFx, hurtFxEnabled, HURT_FX } from './hurtFx.js';
import assert from 'node:assert/strict';
const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, a + ' vs ' + b);

{ // low hearts pulse 1.2 Hz, stays within pulseAlpha, off when dead
  const f = createHurtFx(); f.step(0, 30); near(f.pulse(), 0); f.step(1000, 4);
  f.step(1e3, 4); let mx = 0;
  for (let i = 0; i < 100; i++) { f.step(10, 4); mx = Math.max(mx, f.pulse()); }
  assert.ok(mx > 0.2 && mx <= HURT_FX.pulseAlpha + 1e-9);
  f.step(10, 0, false); near(f.pulse(), 0);
}
{ // deterministic
  const run = () => { const f = createHurtFx(); const o = []; let hp = 30; for (let i = 0; i < 200; i++) { if (i % 37 === 0) hp -= 3; f.step(16.7, hp); o.push(f.pulse()); } return o.join(); };
  assert.equal(run(), run());
}
{ // flags + draw ring only
  assert.equal(hurtFxEnabled(new URLSearchParams(''), false), true);
  assert.equal(hurtFxEnabled(new URLSearchParams('fx=0'), false), false);
  assert.equal(hurtFxEnabled(new URLSearchParams(''), true), false);
  const off = createHurtFx({ enabled: false }); off.step(16, 5); assert.equal(off.pulse(), 0);
  const cells = new Set(); const ui = { cols: 20, rows: 10, setCellRGB(x, y) { cells.add(x + ',' + y); } };
  const f = createHurtFx(); f.step(16, 30); f.step(400, 4); f.draw(ui);
  assert.ok(cells.size > 10);
  for (const c of cells) { const [x, y] = c.split(',').map(Number); assert.ok(x < 2 || y < 2 || x >= 18 || y >= 8); }
}
{ // zero alloc (re-spawn with --expose-gc)
  if (!globalThis.gc && !process.env.HURTFX_CHILD) {
    const { spawnSync } = await import('node:child_process');
    const r = spawnSync(process.execPath, ['--expose-gc', new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1'), ], { env: { ...process.env, HURTFX_CHILD: '1' }, stdio: 'inherit' });
    assert.equal(r.status, 0);
  } else if (globalThis.gc) {
    const f = createHurtFx(); let hp = 30; const ui = { cols: 80, rows: 30, setCellRGB() {} };
    for (let i = 0; i < 2000; i++) { f.step(16, hp); f.pulse(); f.draw(ui); }
    gc(); const h0 = process.memoryUsage().heapUsed;
    for (let i = 0; i < 1e5; i++) { if (i % 50 === 0) hp = hp <= 3 ? 30 : hp - 2; f.step(16, hp); f.pulse(); if (i % 100 === 0) f.draw(ui); }
    gc(); const d = process.memoryUsage().heapUsed - h0;
    assert.ok(d < 200000, 'heap grew ' + d);
  }
}
console.log('hurtFx OK');
