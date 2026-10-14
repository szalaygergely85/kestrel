// GI-PROBE-02b: .gi.bin container. Run: node engine/world/giFile.test.js
import { writeGIFile, readGIFile, readGIHeader, isGIFileFresh, GI_HEADER_BYTES } from './giFile.js';
import { GIBake, encodeRaw } from './giBake.js';
import { makeOk } from '../test/assert.js';

let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const world = { groundAt: () => 0, raySegmentRay(s, o) { if (s[5] >= s[2]) return false; const t = -s[2] / (s[5] - s[2]); if (t > 1) return false; o.t = t; o.x = s[0] + (s[3] - s[0]) * t; o.y = s[1] + (s[4] - s[1]) * t; o.z = 0; return true; } };
const bake = () => { const b = new GIBake(world, { x0: 16, y0: 8, w: 4, h: 3 }); while (!b.step(1000)); return encodeRaw(b.raw()); };
const hashA = 'ab'.repeat(32), hashB = 'cd'.repeat(32);
const f1 = bake(), f2 = bake();
const a = writeGIFile(f1, { hash: hashA, zone: 'z', world: 'w' }), b = writeGIFile(f2, { hash: hashA, zone: 'z', world: 'w' });
ok('two bakes -> identical bytes', Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0);
const h = readGIHeader(a);
ok('header: magic, version 1, hash prefix', h.ok && h.version === 1 && h.hash16 === hashA.slice(0, 32) && a.length === GI_HEADER_BYTES + h.metaLen + h.payloadLen);
const r = readGIFile(a), g = r.field;
ok('round trip: grid + arrays', g.x0 === 16 && g.y0 === 8 && g.w === 4 && g.h === 3 && g.layers === 3 && g.cellM === 8 && r.meta.zone === 'z');
ok('round trip: data/valid/base/scale/bias equal', Buffer.compare(Buffer.from(g.data), Buffer.from(f1.data)) === 0 && Buffer.compare(Buffer.from(g.valid), Buffer.from(f1.valid)) === 0
  && g.base.every((v, i) => v === f1.base[i]) && g.scale.every((v, i) => v === f1.scale[i]) && g.bias.every((v, i) => v === f1.bias[i]));
ok('fresh with same hash, stale with another', isGIFileFresh(a, hashA) && !isGIFileFresh(a, hashB));
let threw = false; try { readGIFile(a.subarray(0, a.length - 5)); } catch { threw = true; }
ok('truncated file throws', threw);
console.log(`${pass} passed, ${fail} failed.`);
if (fail) { console.log('FAILURES:\n' + failures.map((x) => '  - ' + x).join('\n')); process.exit(1); }
console.log('ALL PASS');
