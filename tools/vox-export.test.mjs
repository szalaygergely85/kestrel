// Tests for tools/vox-export.mjs (OWN-REQ-005c, docs/backlog.md row 25z).
// Plain Node script, no framework (matches tools/vox-import.test.mjs etc.)
// - run directly: node tools/vox-export.test.mjs
//
// The core assertion (per the backlog row's own AC wording: "export ->
// import round-trip gives the same voxels + part names") runs on EVERY
// real VoxelModelDef currently in the repo (design/models/voxel_props.js +
// voxel_tower.js + voxel_world.js), not a synthetic fixture: export it with
// tools/vox-export.mjs, feed the bytes back through tools/vox-import.mjs's
// own parseVox/buildVoxelModel, and compare.
//
// Known, expected divergence (see vox-export.mjs's header "KNOWN
// LIMITATION" comment): `pivot` is NOT asserted for equality, because
// vox-import always derives it geometrically (single-part: the model's
// anchor; multi-part: each part's own box bottom-centre), while real
// hand-authored content sometimes sets a semantic pivot elsewhere (a
// rotation hinge, a pivot shared by two rigidly-linked parts) - the
// backlog row's own AC does not require pivot fidelity, only voxels + part
// names, so this is scoped out on purpose, not an oversight.

import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { exportVoxelModel, chooseExportMode, loadRealVoxelModels, collectMaterials } from './vox-export.mjs';
import { parseVox, buildVoxelModel } from './vox-import.mjs';
import { validateVoxelModel } from '../engine/index.js';

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`ok - ${name}`);
  } catch (e) {
    console.error(`FAIL - ${name}`);
    console.error(e.stack || e.message);
    process.exitCode = 1;
  }
}

/** char -> material key (or null for empty) at (x,y,z) of a VoxelModelDef. */
function matAt(def, x, y, z) {
  const ch = def.layers[z][y][x];
  if (ch === '.' || ch === ' ') return null;
  const m = def.mats[ch];
  return m === undefined ? null : m;
}

/** Tight bounding box [x0,y0,z0,x1,y1,z1] (half-open) of every non-empty
 * voxel in a VoxelModelDef. In 'multi' mode vox-import's buildMultiPartModel
 * (OWN-REQ-005b) shifts the reimported model so ITS combined voxel extent
 * starts at (0,0,0) - real content is not always already edge-tight in
 * every axis (e.g. gondola/canvasHeap/envelopeHeap have empty margin on at
 * least one side), so the reimported model can come back smaller AND
 * shifted relative to the original's own (possibly loose) declared `size`.
 * That shift is expected/correct (it is exactly what OWN-REQ-005b's AC
 * documents: "box = the tight bounds of its own voxels"), not a bug - this
 * helper lets the test compare voxel-for-voxel against the right origin
 * instead of assuming the trivial shift=0 case. */
function tightBounds(def) {
  const [sx, sy, sz] = def.size;
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let z = 0; z < sz; z++) {
    for (let y = 0; y < sy; y++) {
      for (let x = 0; x < sx; x++) {
        if (matAt(def, x, y, z) === null) continue;
        if (x < x0) x0 = x; if (x + 1 > x1) x1 = x + 1;
        if (y < y0) y0 = y; if (y + 1 > y1) y1 = y + 1;
        if (z < z0) z0 = z; if (z + 1 > z1) z1 = z + 1;
      }
    }
  }
  return [x0, y0, z0, x1, y1, z1];
}

/** Asserts `reimported` (a VoxelModelDef from buildVoxelModel) has the
 * exact same per-cell material-key grid as `original` (allowing only a
 * palette-index / char remap - never comparing raw chars - and, in 'multi'
 * mode, the tight-bbox shift described on `tightBounds` above). */
function assertSameVoxels(name, mode, original, reimported) {
  const [ox0, oy0, oz0, ox1, oy1, oz1] = tightBounds(original);
  const expectedSize = mode === 'multi'
    ? [ox1 - ox0, oy1 - oy0, oz1 - oz0]
    : original.size; // 'single' mode keeps the full declared grid, no shift
  assert.deepStrictEqual(reimported.size, expectedSize, `${name}: reimported size mismatch`);
  const [dx, dy, dz] = mode === 'multi' ? [ox0, oy0, oz0] : [0, 0, 0];
  const [sx, sy, sz] = expectedSize;
  for (let z = 0; z < sz; z++) {
    for (let y = 0; y < sy; y++) {
      for (let x = 0; x < sx; x++) {
        const o = matAt(original, x + dx, y + dy, z + dz);
        const r = matAt(reimported, x, y, z);
        assert.strictEqual(r, o, `${name}: voxel (${x},${y},${z}) material mismatch: original '${o}' vs reimported '${r}'`);
      }
    }
  }
}

const { palette, voxelModels } = loadRealVoxelModels();
const modelNames = Object.keys(voxelModels).sort();

test('loadRealVoxelModels finds every real model key (not a hardcoded guess)', () => {
  assert.ok(modelNames.length >= 12, `expected at least 12 real voxel models, found ${modelNames.length}: ${modelNames.join(', ')}`);
  // The owner's own example names from the backlog row - all must be present (a stale guess would miss/rename one).
  for (const k of ['lever', 'lantern', 'boulder', 'rubble0', 'rubble1', 'rubble2', 'canvasHeap', 'gondola', 'strut', 'envelopeHeap', 'relay', 'waystone']) {
    assert.ok(voxelModels[k], `expected ASSETS.voxelModels.${k}`);
  }
});

// One round-trip test per real model, written into the loop so a single
// model's failure doesn't hide the others.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vox-export-test-'));
const modeUsed = {};
for (const name of modelNames) {
  test(`round trip: ${name}`, () => {
    const def = voxelModels[name].voxel;
    const { mode, buffer, map } = exportVoxelModel(def, palette.materials, palette.rgb);
    modeUsed[name] = mode;

    // Step 2 of the task: exercise the REAL written bytes (a temp file on
    // disk), not just the in-memory buffer.
    const voxPath = path.join(tmpDir, `${name}.vox`);
    fs.writeFileSync(voxPath, buffer);
    const bytesFromDisk = fs.readFileSync(voxPath);
    assert.deepStrictEqual(bytesFromDisk, buffer, `${name}: bytes written to disk differ from the in-memory buffer`);

    const parsed = parseVox(bytesFromDisk);
    if (mode === 'multi') {
      assert.ok(parsed.scene, `${name}: expected a v200 scene graph (mode 'multi'), parseVox found none`);
    } else {
      assert.ok(!parsed.scene, `${name}: expected no scene graph (mode 'single'), parseVox found one`);
    }

    const reimported = buildVoxelModel(parsed, map, def.cellM);
    const { errors } = validateVoxelModel(reimported);
    assert.deepStrictEqual(errors, [], `${name}: reimported model failed validateVoxelModel`);

    assertSameVoxels(name, mode, def, reimported);

    // Part names (the AC's second half): only meaningful in 'multi' mode -
    // 'single' mode always reimports as one root part named 'body'
    // (vox-import's own single-part convention), which is expected, not a
    // failure - see this file's header + vox-export.mjs's KNOWN LIMITATION.
    if (mode === 'multi') {
      assert.deepStrictEqual(
        Object.keys(reimported.parts), Object.keys(def.parts),
        `${name}: reimported part names/order differ from the original`
      );
    } else {
      assert.deepStrictEqual(Object.keys(reimported.parts), ['body'], `${name}: expected the single-part 'body' fallback`);
    }
  });
}

test('chooseExportMode: multi for disjoint-box multi-part models (lever, gondola, canvasHeap, envelopeHeap)', () => {
  for (const k of ['lever', 'gondola', 'canvasHeap', 'envelopeHeap']) {
    assert.strictEqual(modeUsed[k], 'multi', `expected '${k}' to export as 'multi' (disjoint part boxes)`);
  }
});

test('chooseExportMode: single fallback for models with genuinely overlapping part boxes (lantern, relay)', () => {
  for (const k of ['lantern', 'relay']) {
    assert.strictEqual(modeUsed[k], 'single', `expected '${k}' to export as 'single' (overlapping part boxes - see KNOWN LIMITATION)`);
    assert.strictEqual(chooseExportMode(voxelModels[k].voxel), 'single');
  }
});

test('chooseExportMode: single for models with exactly one part (boulder, rubble0..2, strut, waystone)', () => {
  for (const k of ['boulder', 'rubble0', 'rubble1', 'rubble2', 'strut', 'waystone']) {
    assert.strictEqual(modeUsed[k], 'single', `expected '${k}' to export as 'single' (one part)`);
  }
});

test('collectMaterials: first-encounter order, 1-based indices, no duplicates', () => {
  const def = {
    size: [2, 1, 1], layers: [['AB']],
    mats: { A: 'brass_light', B: 'brass_dark' }
  };
  const { orderedKeys, indexOf } = collectMaterials(def);
  assert.deepStrictEqual(orderedKeys, ['brass_light', 'brass_dark']);
  assert.strictEqual(indexOf.get('brass_light'), 1);
  assert.strictEqual(indexOf.get('brass_dark'), 2);
});

test('exportVoxelModel: palette RGBA matches design/palette.js materials[key].base -> rgb[base]', () => {
  const def = voxelModels.lever.voxel;
  const { buffer, map } = exportVoxelModel(def, palette.materials, palette.rgb);
  const parsed = parseVox(buffer);
  for (const [idxStr, matKey] of Object.entries(map)) {
    const idx = Number(idxStr);
    const got = parsed.palette[idx - 1];
    const want = palette.rgb[palette.materials[matKey].base];
    assert.deepStrictEqual([got[0], got[1], got[2]], want, `palette index ${idx} (${matKey}) RGB mismatch`);
    assert.strictEqual(got[3], 255);
  }
});

console.log(`${passed} passed`);
if (process.exitCode) console.error('SOME TESTS FAILED');
