// game/js/audio/surfaces.test.js (US-020c: floor-material -> footstep
// timbre map). Node built-ins only (assert + process.exitCode), same style
// as this project's other audio tests.
import assert from 'node:assert';
import { surfaceTimbre } from './surfaces.js';

let failures = 0;
let total = 0;
function check(name, got, want) {
  total++;
  try {
    assert.strictEqual(got, want);
    console.log(`PASS ${name}`);
  } catch (e) {
    failures++;
    console.log(`FAIL ${name}: ${e.message}`);
  }
}

// Explicit wood/iron mappings (AC: "wood/deck" -> hollow knock, "iron/grate" -> metallic tick).
check('wood -> wood', surfaceTimbre('wood'), 'wood');
check('deck -> wood', surfaceTimbre('deck'), 'wood');
check('iron -> iron', surfaceTimbre('iron'), 'iron');
check('grate -> iron', surfaceTimbre('grate'), 'iron');

// Current design/levels/tower.js floorMat keys (design/levels/tower.js) all
// read as stone (no wood/iron in level data yet, per the backlog note).
check('floor -> stone', surfaceTimbre('floor'), 'stone');
check('rubble -> stone', surfaceTimbre('rubble'), 'stone');
check('rock -> stone', surfaceTimbre('rock'), 'stone');
check('ash -> stone', surfaceTimbre('ash'), 'stone');
check('moss_top -> stone', surfaceTimbre('moss_top'), 'stone');
check('grass -> stone', surfaceTimbre('grass'), 'stone');

// AC: "an unknown material = stone" - the safe default, including null/undefined.
check('unknown key -> stone', surfaceTimbre('unknown_xyz'), 'stone');
check('null -> stone', surfaceTimbre(null), 'stone');
check('undefined -> stone', surfaceTimbre(undefined), 'stone');

console.log(failures === 0 ? `ALL PASS (${total} checks)` : `${failures}/${total} FAILURES`);
process.exitCode = failures === 0 ? 0 : 1;
