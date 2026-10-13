// RIG-03w: registerRiggedChars with a fake registry; real rigged glb from the chargen CLI helpers.
import assert from 'node:assert/strict';
import { readRiggedGlb, ContentError } from '../../../engine/index.js';
import { loadKit, buildGlb } from '../../../tools/chargen/export.mjs';
import { registerRiggedChars } from './charRegister.js';

const kit = loadKit();
const { glb } = buildGlb(kit, kit.defaults);
const good = { kind: 'rigged', model: readRiggedGlb(glb, 'vil') };
const reg = { added: [], add(kind, key, def) { this.added.push([kind, key, def]); } };
const errs = [];
const keys = registerRiggedChars(reg, {
  vil: good,
  rock: { kind: 'static', model: {} },
  bad: { kind: 'rigged', model: {} },
}, (e) => errs.push(e));
assert.deepEqual(keys, ['char.vil']);
assert.equal(reg.added.length, 1);
assert.equal(reg.added[0][0], 'model');
assert.equal(reg.added[0][1], 'char.vil');
assert.ok(reg.added[0][2].voxel.rig.quads > 0, 'rig quads present');
assert.equal(errs.length, 1, 'bad glb reported, others still registered');
assert.ok(errs[0] instanceof ContentError && /bad/.test(errs[0].message + errs[0].file), 'error names the id');
assert.deepEqual(registerRiggedChars(reg, undefined), []);
console.log('charRegister: ok');
