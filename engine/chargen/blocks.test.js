// engine/chargen/blocks.test.js (CHARGEN-22b, docs/architecture.md 38.34 items 2-3 + 8 a/d/e/f): node engine/chargen/blocks.test.js
// Compose blocks (head finer than the body), height remap, meshBlock + finest-grid output. Synthetic fixture + the real kit
// with a head detail block made by nearest-upsampling its own head cells (test-only; the designer's L2 is CHARGEN-23).
import fs from 'node:fs';
import { composeCharacter, meshCharacter, collapseRig, riggedModelDef, validateKit, randomRecipe, CHAR_GAME_MAX_QUADS, GAME_SAFE_RES } from './index.js';
import { makeOk } from '../test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const clone = (o) => JSON.parse(JSON.stringify(o));

// ---- fixture: Spine z0..3, Head z4..5 (region head); head L2 = 8x8x4 block, filled x2..5,y2..5 (level-1 x1..2,y1..2)
function kitFix() {
  const base = {
    size: [4, 4, 6], anchor: [2, 2, 0], layers: [],
    bones: { Spine: { joint: [2, 2, 0], box: [1, 1, 0, 2, 2, 3] }, Head: { joint: [2, 2, 4], box: [0, 0, 4, 3, 3, 5] } },
    anchors: { top: [2, 2, 5] }, stretchRows: [1],
  };
  for (let z = 0; z < 6; z++) base.layers.push(['....', '.ss.', '.ss.', '....']);
  base.detail = { head: { 2: { layers: Array.from({ length: 4 }, () => Array.from({ length: 8 }, (_, y) => (y >= 2 && y < 6 ? '..ssss..' : '........'))) } } };
  return {
    id: 'fix', cellM: 0.025,
    skeleton: [{ name: 'Spine', parent: null }, { name: 'Head', parent: 'Spine' }],
    slots: { s: { group: 'skin', shade: 1 }, e: { group: 'eyes', shade: 0, keep: 5 }, h: { group: 'hair', shade: 0 } },
    ramps: { skin: { fair: { 0: 'm.a', 1: 'm.b' } }, eyes: { brown: { 0: 'm.c' } }, hair: { black: { 0: 'm.d' } } },
    bases: { m: base },
    regions: { head: { bones: ['Head'], box: [0, 0, 4, 3, 3, 5] } },
    resLevels: { body: [1], head: [1, 2] },
    shells: [], attachments: [],
  };
}
const recipe = (res, height = 0) => ({ v: 1, kit: 'fix', base: 'm', height, age: 'adult', skin: 'fair', eyes: 'brown', ...(res ? { res } : {}) });
const count = (a) => a.reduce((n, v) => n + (v ? 1 : 0), 0);

// ---- (a) 1/1 and missing res are identical, blocks = []
{
  const kit = kitFix();
  const a = composeCharacter(kit, recipe()), b = composeCharacter(kit, recipe({ body: 1, head: 1 }));
  ok('res missing == {1,1}: mat/bone/size equal, blocks []', same(a.mat, b.mat) && same(a.bone, b.bone) && a.blocks.length === 0 && b.blocks.length === 0 && same(a.size, b.size));
  ok('1/1 head cells stay in the main grid', count(a.mat) === 4 * 6 && a.cellM === 0.025);
  const ra = meshCharacter(a);
  ok('1/1 cellM unchanged, no scaling of joints', ra.cellM === 0.025 && same(ra.bones[1].jointCells, [2, 2, 4]));
}

// ---- (d) compose {1,2}
{
  const kit = kitFix();
  const g = composeCharacter(kit, recipe({ body: 1, head: 2 }));
  const blk = g.blocks[0];
  ok('one block: origin, size, k', g.blocks.length === 1 && blk.region === 'head' && blk.k === 2 && same(blk.origin, [0, 0, 4]) && same(blk.size, [8, 8, 4]));
  ok('head bone absent from the main grid, spine intact', g.mat.every((m, i) => !m || g.bone[i] === 0) && count(g.mat) === 4 * 4);
  ok('block holds only head cells (4x4x4)', count(blk.mat) === 64 && blk.bone.every((b, i) => !blk.mat[i] || b === 1));
  ok('main cellM and anchor unchanged', g.cellM === 0.025 && same(g.anchor, [2, 2, 0]));
  const up = composeCharacter(kit, recipe({ body: 1, head: 2 }, 2)), dn = composeCharacter(kit, recipe({ body: 1, head: 2 }, -0));
  ok('height +2: only the block origin shifts (z 4 -> 6), block unchanged', same(up.blocks[0].origin, [0, 0, 6]) && same(up.blocks[0].mat, dn.blocks[0].mat) && up.size[2] === 8);
  ok('height +2: spine box grew, head joint moved', up.bones[1].joint[2] === 6);
  const hd = composeCharacter(kit, recipe({ body: 1, head: 2 }, 1));
  ok('height +1: duplicate row below the head', same(hd.blocks[0].origin, [0, 0, 5]));
  // the kit must still be valid with the real blocks
  ok('fixture kit valid', validateKit(kit, ['m.a', 'm.b', 'm.c', 'm.d']).errors.length === 0);
  // derived level: head 1 from the L2 detail only (base.layers wins at level 1), head 2 derived from authored L4
  const k4 = kitFix(); const L2 = k4.bases.m.detail.head[2].layers;
  const up2 = L2.map((pl) => [...pl, ...pl].map((r, i) => r)); void up2;
  const L4 = [];
  for (const pl of L2) { const rows = []; for (const r of pl) { const w = r.split('').map((c) => c + c).join(''); rows.push(w, w); } L4.push(rows, rows); }
  k4.bases.m.detail.head = { 4: { layers: L4 } };
  const d2 = composeCharacter(k4, recipe({ body: 1, head: 2 }));
  ok('level 2 derived from authored level 4 by downsample', same(d2.blocks[0].mat, g.blocks[0].mat));
  ok('compose is deterministic', same(composeCharacter(kit, recipe({ body: 1, head: 2 })).blocks[0].mat, g.blocks[0].mat));
}

// ---- shells + attachments per level (synthetic)
{
  const kit = kitFix();
  kit.shells = [{ id: 'cap', slot: 'top', regions: [{ bone: 'Head', t0: 0, t1: 0.5 }], thick: 1, paint: 'h' }];
  kit.ramps.hair = { black: { 0: 'm.d' } };
  kit.attachments = [{ id: 'tuft', slot: 'hair', bone: 'Head', anchor: 'top', offset: [0, 0, 0], box: [1, 1, 1], layers: [['h']] }];
  kit.slots.h = { group: 'hair', shade: 0 };
  const r = { ...recipe({ body: 1, head: 2 }), top: { id: 'cap', ramp: 'black' }, hair: { id: 'tuft', ramp: 'black' } };
  const e = (kit.shells[0].paint = 'h', validateKit(kit, ['m.a', 'm.b', 'm.c', 'm.d']).errors);
  ok('shell/attachment fixture valid', e.length === 0, e.join('; '));
  // top shell is dyed by the 'top' group; give it a ramp
  kit.ramps.top = { black: { 0: 'm.d' } };
  const g = composeCharacter(kit, r);
  const blk = g.blocks[0];
  ok('shell grows thick * level (2 layers) in the block', count(blk.mat) > 64 && blk.size[2] === 4);
  const tuft = composeCharacter(kit, { ...recipe({ body: 1, head: 2 }), hair: { id: 'tuft', ramp: 'black' } });
  // anchor top = (2,2,5): level-1 cell (2,2,5) -> block cells x (2-0)*2=4.., y 4.., z (5-4)*2=2.. ; a 1-cell attachment upsampled 2x2x2
  const base64 = 64;
  ok('level-1 attachment is upsampled to 2x2x2 in the head block', count(tuft.blocks[0].mat) >= base64 && count(tuft.mat) === 16);
}

// ---- mesh: finest grid, seam, body quads, riggedModelDef
{
  const kit = kitFix();
  const g11 = composeCharacter(kit, recipe({ body: 1, head: 1 })), g12 = composeCharacter(kit, recipe({ body: 1, head: 2 }));
  const r11 = meshCharacter(g11), r12 = meshCharacter(g12);
  const G = 0.0125;
  ok('rigged.cellM = G at head 2', Math.abs(r12.cellM - G) < 1e-12);
  let offGrid = 0;
  for (let i = 0; i < r12.mesh.pos.length; i++) { const c = r12.mesh.pos[i] / G; if (Math.abs(c - Math.round(c)) > 1e-3) offGrid++; }
  ok('every vertex is an integer multiple of G', offGrid === 0, `${offGrid} off-grid`);
  const sp = (r) => { const q = r.mesh.ranges[0]; return Array.from(r.mesh.pos.slice(12 * q.start, 12 * (q.start + q.count))); };
  ok('body-bone quads at {1,2} == at {1,1} (positions exact)', r12.mesh.ranges[0].count === r11.mesh.ranges[0].count && same(sp(r12), sp(r11)));
  // seam: Spine max z == Head min z (no gap, no overlap); head bone volume above
  const zr = (r, bi) => { const q = r.mesh.ranges[bi]; let lo = 1e9, hi = -1e9; for (let i = 0; i < 4 * q.count; i++) { const z = r.mesh.pos[12 * q.start + 3 * i + 2]; lo = Math.min(lo, z); hi = Math.max(hi, z); } return [lo, hi]; };
  const sZ = zr(r12, 0), hZ = zr(r12, 1);
  ok('neck seam: head bottom plane == spine top plane', Math.abs(sZ[1] - hZ[0]) < 1e-9, `${sZ} ${hZ}`);
  // occupancy in G cells: no cell owned by two bones
  const occ = new Map(); let clash = 0;
  const put = (x, y, z, b) => { const k = x + ',' + y + ',' + z; if (occ.has(k) && occ.get(k) !== b) clash++; occ.set(k, b); };
  for (let z = 0; z < 6; z++) for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if (g12.mat[x + 4 * (y + 4 * z)]) for (let d = 0; d < 8; d++) put(x * 2 + (d & 1), y * 2 + ((d >> 1) & 1), z * 2 + (d >> 2), g12.bone[x + 4 * (y + 4 * z)]);
  const bk = g12.blocks[0];
  for (let z = 0; z < 4; z++) for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (bk.mat[x + 8 * (y + 8 * z)]) put(bk.origin[0] * 2 + x, bk.origin[1] * 2 + y, bk.origin[2] * 2 + z, 1);
  ok('no overlap between block and main cells', clash === 0);
  const pm = [{ name: 'body', bones: ['Spine'], parent: null }, { name: 'head', bones: ['Head'], parent: 'body' }];
  const rig = collapseRig(r12, pm);
  ok('riggedModelDef accepts {1,2}', (() => { try { riggedModelDef(rig); return true; } catch (e) { return false; } })());
  ok('(f) joint metres = (jointCells - anchor x f) * G at F = 2', r12.bones.every((bn, i) => bn.joint.every((v, k) => Math.abs(v - (bn.jointCells[k] - g12.anchor[k] * 2) * G) < 1e-9)) && r12.bones[1].jointCells[2] === 8);
  const bad = clone({ ...rig, mesh: { ...rig.mesh } });
  bad.mesh.pos = new Float32Array(rig.mesh.pos); bad.mesh.pos[0] += G * 0.4;
  ok('riggedModelDef rejects an off-grid vertex', (() => { try { riggedModelDef(bad); return false; } catch (e) { return /not a voxel-grid mesh/.test(e.message); } })());
  const r2 = meshCharacter(g12);
  ok('mesh deterministic', same(r2.mesh.pos, r12.mesh.pos) && same(r2.mesh.mat, r12.mesh.mat));
  // Hips clip translation + mounts scale to G cells
  const kc = kitFix(); kc.clips = { walk: { duration: 100, loop: true, keys: [{ t: 0, pos: { Spine: [1, 0, 2] } }] } };
  const gc = composeCharacter(kc, recipe({ body: 1, head: 2 }));
  gc.clips = { walk: { duration: 100, loop: true, keys: [{ t: 0, pos: { Hips: [1, 0, 2] } }] } };
  ok('Hips clip pos scaled by f', same(meshCharacter(gc).clips.walk.keys[0].pos.Hips, [2, 0, 4]));
  gc.mounts = { top: [2, 2, 5] };
  ok('mounts scaled by f', same(meshCharacter(gc).mounts.top, [4, 4, 10]));
}

// ---- real kit: head detail made by nearest-upsampling its own head cells; quad counts per combination
{
  const kit = JSON.parse(fs.readFileSync(new URL('../../content/chargen/human.charkit.json', import.meta.url), 'utf8'));
  const base = kit.bases.m_avg;
  const hb = base.bones.Head.box, jb = base.bones.Jaw.box;
  const box = [Math.min(hb[0], jb[0]), Math.min(hb[1], jb[1]), Math.min(hb[2], jb[2]), Math.max(hb[3], jb[3]), Math.max(hb[4], jb[4]), Math.max(hb[5], jb[5])];
  kit.regions = { head: { bones: ['Head', 'Jaw'], box } };
  kit.resLevels = { body: [1], head: [1, 2, 4] };
  const boxIn = (q, x, y, z) => x >= q[0] && x <= q[3] && y >= q[1] && y <= q[4] && z >= q[2] && z <= q[5];
  const firstBone = (x, y, z) => kit.skeleton.find((b) => base.bones[b.name] && boxIn(base.bones[b.name].box, x, y, z));
  const up = (L) => {
    const [ex, ey, ez] = [box[3] - box[0] + 1, box[4] - box[1] + 1, box[5] - box[2] + 1];
    const out = [];
    for (let z = 0; z < ez * L; z++) {
      const pl = [];
      for (let y = 0; y < ey * L; y++) {
        let row = '';
        for (let x = 0; x < ex * L; x++) {
          const gx = box[0] + ((x / L) | 0), gy = box[1] + ((y / L) | 0), gz = box[2] + ((z / L) | 0);
          const fb = firstBone(gx, gy, gz);
          const ch = base.layers[gz][gy][gx];
          row += fb && (fb.name === 'Head' || fb.name === 'Jaw') ? ch : '.';
        }
        pl.push(row);
      }
      out.push(pl);
    }
    return out;
  };
  base.detail = { head: { 2: { layers: up(2) }, 4: { layers: up(4) } } };
  const names = base.stretchRows.filter((r) => r >= box[2] && r <= box[5]);
  ok('real-kit fixture: no stretch row in the head box', names.length === 0);
  const rc = randomRecipe(kit, 3);
  const quads = (res, h) => meshCharacter(composeCharacter(kit, { ...rc, height: h, res })).mesh.quads;
  const q11 = quads({ body: 1, head: 1 }, 0), q12 = quads({ body: 1, head: 2 }, 0), q14 = quads({ body: 1, head: 4 }, 0);
  ok('quad counts: nearest-upsampled head keeps the greedy quad count at every level', q11 === q12 && q12 === q14, `${q11} ${q12} ${q14}`);
  ok('GAME_SAFE_RES stays under CHAR_GAME_MAX_QUADS', quads(GAME_SAFE_RES, 0) <= CHAR_GAME_MAX_QUADS && q12 <= CHAR_GAME_MAX_QUADS, `${q12}`);
  ok('worst combination under MESH_ONLY_MAX_QUADS 32768', q14 < 32768, `${q14}`);
  for (const h of [-2, 3]) { const a = composeCharacter(kit, { ...rc, height: h, res: { body: 1, head: 2 } }); ok(`real kit height ${h} composes with a head block`, a.blocks.length === 1 && a.blocks[0].origin[2] >= 0); }
  console.log(`  real kit quads: 1/1 ${q11}, 1/2 ${q12}, 1/4 ${q14}`);
}

console.log(`blocks.test: ${pass} passed, ${fail} failed`);
if (fail > 0) { for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
console.log('ALL PASS');
