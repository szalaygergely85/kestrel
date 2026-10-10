// node tools/export/voxWrite.test.mjs - CHARGEN-12: voxWrite (split out of vox-export.mjs) + character grid export, round trip via voxParse.
import { makeOk } from '../../engine/test/assert.js';
import '../../design/palette.js';
import '../../design/detail-pass.js';
import { composeCharacter } from '../../engine/index.js';
import { loadKit, paletteRgbOf } from '../chargen/export.mjs';
import { parseVox } from '../voxParse.js';
import { writeVoxSingle, writeVoxMulti, exportVoxGrid } from './voxWrite.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const throws = (f) => { try { f(); } catch { return true; } return false; };

// single + multi round trip on a tiny model
const pal = [[255, 0, 0, 255], [0, 255, 0, 255]];
const one = parseVox(writeVoxSingle({ size: [2, 2, 2], voxels: [{ x: 0, y: 1, z: 1, c: 2 }], palette: pal }));
ok('single: size, voxel, palette', one.size.join() === '2,2,2' && one.voxels.length === 1 && one.voxels[0].c === 2 && one.palette[1][1] === 255);
const mul = parseVox(writeVoxMulti({ parts: [
  { name: 'a', size: [1, 1, 1], origin: [0, 0, 0], voxels: [{ x: 0, y: 0, z: 0, c: 1 }] },
  { name: 'b', size: [2, 1, 1], origin: [3, 0, 0], voxels: [{ x: 1, y: 0, z: 0, c: 2 }] },
], palette: pal }));
ok('multi: two models, two layers named', mul.models.length === 2 && [...mul.scene.layers.values()].map((l) => l.name).join() === 'a,b');
ok('limits: palette > 255 and axis > 256 throw', throws(() => writeVoxSingle({ size: [1, 1, 1], voxels: [], palette: new Array(256).fill([0, 0, 0, 255]) })) && throws(() => writeVoxSingle({ size: [257, 1, 1], voxels: [], palette: pal })));
ok('axis 256 is allowed', !throws(() => writeVoxSingle({ size: [256, 1, 1], voxels: [], palette: pal })));

// character grid: one shape per bone, nTRN named
const kit = loadKit(), rgbOf = paletteRgbOf();
const grid = composeCharacter(kit, kit.defaults);
const bytes = exportVoxGrid(grid, { rgbOf });
const vox = parseVox(bytes);
const nTrn = [...vox.scene.nodes.values()].filter((n) => n.type === 'nTRN' && n.attribs._name);
const used = new Set(); for (let i = 0; i < grid.mat.length; i++) if (grid.mat[i]) used.add(grid.bone[i]);
const boneNames = grid.bones.map((b) => b.name);
ok('one model per non-empty bone', vox.models.length === used.size && used.size > 10);
ok('nTRN names = bone names (skeleton order), layers too', nTrn.map((n) => n.attribs._name).join() === boneNames.filter((_, i) => used.has(i)).join() && [...vox.scene.layers.values()].map((l) => l.name).join() === nTrn.map((n) => n.attribs._name).join());
let total = 0; for (let i = 0; i < grid.mat.length; i++) if (grid.mat[i]) total++;
ok('voxel count = filled grid cells', vox.models.reduce((n, m) => n + m.voxels.length, 0) === total);
ok('palette = matKeys colours, <= 255', grid.matKeys.length <= 255 && grid.matKeys.every((k, i) => vox.palette[i].slice(0, 3).join() === rgbOf(k).map(Math.round).join()));
ok('every axis <= 256', vox.models.every((m) => m.size.every((a) => a >= 1 && a <= 256)));
ok('deterministic', Buffer.from(exportVoxGrid(grid, { rgbOf })).equals(Buffer.from(bytes)));

console.log(`voxWrite test: ${pass} passed, ${fail} failed`);
if (fail) { console.log('FAILURES:'); failures.forEach((f) => console.log('  - ' + f)); process.exit(1); }
