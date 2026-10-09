// Run: node engine/render/gpu/wg/passShade.tint.test.js - 38.23 tint words upload (writeEntityTints) + fillEntityTints.
import { writeEntityTints } from './passShade.js';
import { SHADE_BLOCK } from '../wgsl/shade.wgsl.js';
import { createEntityTintTable, fillEntityTints, ENTITY_TINT_MAX } from '../../entityTint.js';
import { setTint } from '../../../entities/tintEnvelope.js';

let fails = 0;
const ok = (n, c) => { if (!c) { fails++; console.log('FAIL', n); } else console.log('ok  ', n); };
const W = (n) => SHADE_BLOCK.field(n).word;
const mk = () => { const su = new Float32Array(SHADE_BLOCK.sizeWords); return [su, new Uint32Array(su.buffer)]; };

// no tints -> bytes identical to the untouched buffer (and a stale previous upload is cleared)
{
  const [a, a32] = mk(), [b, b32] = mk();
  writeEntityTints(b, b32, undefined);
  ok('absent -> identical bytes', Buffer.compare(Buffer.from(a.buffer), Buffer.from(b.buffer)) === 0);
  const t = createEntityTintTable(); t.count = 0;
  writeEntityTints(b, b32, t);
  ok('count 0 -> identical bytes', Buffer.compare(Buffer.from(a.buffer), Buffer.from(b.buffer)) === 0);
}
// 2 tinted entities
const pool = { objectIdFor: (e) => (e.slot === undefined ? -1 : 0x8000 | e.slot) };
const ents = [{ slot: 3 }, { /* no slot */ }, { slot: 5 }, { slot: 6 }];
setTint(ents[0], 'hit', 1000, 0); setTint(ents[1], 'hit', 1000, 0); setTint(ents[2], 'hurt', 1000, 0); // ents[3] untinted
const tab = createEntityTintTable();
const n = fillEntityTints(tab, ents, pool, 1010);
ok('fill: 2 entries (no-slot and k=0 skipped)', n === 2 && tab.ids[0] === (0x8000 | 3) && tab.ids[1] === (0x8000 | 5));
const [su, s32] = mk();
writeEntityTints(su, s32, tab);
ok('upload: count', su[W('etA')] === 2);
ok('upload: ids via u32 view', s32[W('etId')] === (0x8000 | 3) && s32[W('etId') + 1] === (0x8000 | 5) && s32[W('etId') + 2] === 0);
ok('upload: rgb+k', su[W('etC')] === tab.rgbk[0] && su[W('etC') + 3] === tab.rgbk[3] && su[W('etC') + 4] === tab.rgbk[4] && tab.rgbk[3] > 0);
// cap
{
  const many = []; for (let i = 0; i < 20; i++) { const e = { slot: i }; setTint(e, 'hit', 0, 0); many.push(e); }
  const c = fillEntityTints(tab, many, pool, 10);
  ok('cap respected', c === ENTITY_TINT_MAX && tab.count === ENTITY_TINT_MAX);
}
// zero alloc
{
  const many = ents.slice(); for (let i = 0; i < 20000; i++) { fillEntityTints(tab, many, pool, 1010); writeEntityTints(su, s32, tab); }
  if (global.gc) global.gc();
  const h0 = process.memoryUsage().heapUsed;
  for (let i = 0; i < 20000; i++) { fillEntityTints(tab, many, pool, 1010); writeEntityTints(su, s32, tab); }
  const d = process.memoryUsage().heapUsed - h0;
  ok('zero alloc (' + d + ' B / 20000 iters)', d < 128 * 1024);
}
process.exit(fails ? 1 : 0);
