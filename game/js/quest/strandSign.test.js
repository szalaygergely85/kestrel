// STRAND-SIGN-01: net stakes sit at warnM +- 3 m from the beach shore, in water; the sign is on land with its inspect text.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createShore, inSea, SEA_EDGE_CONFIG } from './seaEdge.js';
globalThis.window = globalThis.window || globalThis;
await import('../../../design/levels/world_geo.js');
const geo = globalThis.ASSETS.levels.world_geo;
const shore = createShore((geo.coast || geo.geo?.coast));
const near = (x, y) => { let b = Infinity; const S = shore.segs; for (let i = 0; i < S.length; i += 4) { const ax = S[i], ay = S[i + 1], dx = S[i + 2] - ax, dy = S[i + 3] - ay, l2 = dx * dx + dy * dy; let t = l2 ? ((x - ax) * dx + (y - ay) * dy) / l2 : 0; t = Math.max(0, Math.min(1, t)); b = Math.min(b, Math.hypot(x - ax - t * dx, y - ay - t * dy)); } return b; };
const w = JSON.parse(fs.readFileSync(new URL('../../../content/worlds/world_m1.world.json', import.meta.url), 'utf8'));
const stakes = w.structures.filter((s) => /^strandStake/.test(s.id));
assert.ok(stakes.length >= 6 && stakes.length <= 10, 'stake count ' + stakes.length);
for (const s of stakes) { const { x, y } = s.origin; assert.ok(inSea(shore, x, y), s.id + ' in water'); assert.ok(Math.abs(near(x, y) - SEA_EDGE_CONFIG.warnM) <= 3, s.id + ' at warnM +-3: ' + near(x, y).toFixed(1)); }
const sign = w.entities.find((e) => e.id === 'strandSign');
assert.ok(sign && !inSea(shore, sign.x, sign.y) && near(sign.x, sign.y) < 12, 'sign on the beach');
const txt = JSON.parse(fs.readFileSync(new URL('../../../content/dialogue/inspect.json', import.meta.url), 'utf8')).texts['note.strand.monster'];
assert.equal(sign.components.inspect.text, 'note.strand.monster'); assert.equal(txt.lines.length, 3);
console.log('strandSign ok', stakes.length, 'stakes');
