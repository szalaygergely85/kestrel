// engine/world/levelLight.test.js (EV17-10): every walkable cell of every content/levels/*.level.json must lie within the radius of at
// least one level light (preset radius from design/palette.js), or under open sky (daylight opening), or be allow-listed with a reason.
// Walkable = legend entry not solid, not terrainFloor (the outside reference ring). Run: node engine/world/levelLight.test.js
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { makeOk } from '../test/assert.js';
const require = createRequire(import.meta.url);
const palette = require('../../design/palette.js');
const presets = palette.lights || palette.light || palette;
let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
// Deliberately dark cells: { levelId: [{ x0, y0, x1, y1, why }] } (cell index ranges, inclusive).
const ALLOW = { test_room: [{ x0: 0, y0: 0, x1: 999, y1: 999, why: 'dev test fixture, not a shipped interior' }] };
const dir = new URL('../../content/levels/', import.meta.url);
for (const f of readdirSync(dir).filter((n) => n.endsWith('.level.json')).sort()) {
  const d = JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
  const cs = d.cellSize || 1;
  const lights = (d.lights || []).filter((l) => l.on !== false).map((l) => {
    const p = presets[l.preset]; return { x: l.x, y: l.y, r: l.radius ?? p?.radius ?? 0, id: l.id };
  });
  const dark = [];
  d.rows.forEach((row, cy) => [...row].forEach((ch, cx) => {
    const g = d.legend[ch]; if (!g || g.solid || g.terrainFloor || g.ceilH === 'sky' || /outer ring/.test(g.desc || '')) return;
    if ((ALLOW[d.id] || []).some((a) => cx >= a.x0 && cx <= a.x1 && cy >= a.y0 && cy <= a.y1)) return;
    const px = (cx + 0.5) * cs, py = (cy + 0.5) * cs;
    if (!lights.some((l) => Math.hypot(l.x - px, l.y - py) <= l.r)) dark.push(`${cx},${cy}`);
  }));
  ok(`${f}: ${lights.length} lights, no dark walkable cell`, dark.length === 0, `${dark.length} dark: ${dark.join(' ')}`);
}
console.log(`levelLight: ${pass} passed, ${fail} failed`);
for (const m of failures) console.log('FAIL ' + m);
process.exit(fail ? 1 : 0);
