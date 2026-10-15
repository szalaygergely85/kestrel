// Drives shaftRule8a with a fake wg whose readbackCells reuses its buffers (like WgCellPipeline._rbFg/_rbBg).
import assert from 'node:assert/strict';
import { shaftRule8a } from './shaftRule8a.js';

const n = 100, tint = [255, 205, 130];
function fakeWg() {
  const tex = new Uint8Array(n * 4), rbFg = new Uint8Array(n * 4), rbBg = new Uint8Array(n * 4); // tex = GPU texture, rb* = reused readback buffers
  return {
    paint(lift) { for (let c = 0; c < n; c++) { const v = lift && c < 10 ? 120 : 100; for (let k = 0; k < 3; k++) tex[c * 4 + k] = v; tex[c * 4 + 3] = 65; } },
    async readbackShade(oFg, oBg) { const f = oFg || new Uint8Array(n * 4), b = oBg || new Uint8Array(n * 4); f.set(tex); b.set(tex); return { fg: f, bg: b }; }, // shade stage == final here (gain 1)
    async readbackCells(oFg, oBg) { const f = oFg || rbFg, b = oBg || rbBg; f.set(tex); b.set(tex); return { fg: f, bg: b }; },
  };
}
const wg = fakeWg();
wg.paint(false);
const rbw = await wg.readbackCells();            // frame A: reused buffers
const aFg = new Uint8Array(rbw.fg), aBg = new Uint8Array(rbw.bg);
const lightA = new Uint32Array(n * 4);
for (let c = 0; c < 10; c++) lightA[c * 4 + 3] = (3 << 20) >>> 0; // shaft cells
const sA = await wg.readbackShade();
const r = await shaftRule8a({ n, aFg, aBg, aSFg: sA.fg, aSBg: sA.bg, readShade: (f, b) => wg.readbackShade(f, b), lightA, renderB: async () => wg.paint(true), readCells: (f, b) => wg.readbackCells(f, b), sunI: 1, tint });
assert.ok(r.ok, r.fails.join(';'));
assert.equal(r.stats.lifted, 10);
// frame A data (what the twin compare uses) must be unchanged by frame B
assert.equal(rbw.fg[0], 100, 'reused frame-A readback buffer must not be overwritten by frame B (twin compare uses it)');
assert.equal(aFg[0], 100, 'frame A copy untouched');
// null shade readback -> row FAIL (no silent fallback)
wg.paint(false);
const rn = await shaftRule8a({ n, aFg, aBg, aSFg: sA.fg, aSBg: sA.bg, readShade: async () => null, lightA, renderB: async () => wg.paint(true), readCells: (f, b) => wg.readbackCells(f, b), sunI: 1, tint });
assert.equal(rn.ok, false); assert.match(rn.fails[0], /readbackShade null/);
// final cells whose sign disagrees with the shade stage -> FAIL (zero tolerance)
wg.paint(false);
const rs = await shaftRule8a({ n, aFg, aBg, aSFg: sA.fg, aSBg: sA.bg, readShade: (f, b) => wg.readbackShade(f, b), lightA, renderB: async () => wg.paint(true), readCells: async (f, b) => { const o = await wg.readbackCells(f, b); o.fg[0] = 90; return o; }, sunI: 1, tint });
assert.equal(rs.ok, false); assert.ok(rs.stats.signMismatch > 0);
console.log('shaftRule8a ok');
