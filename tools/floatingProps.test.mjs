// OB-143: no placed prop in world_m1 floats > 0.25 m / pokes out of a slope (probe-floating-props rule); no crossed X-beam strut (Prop_Support) outside the sea stakes/sign post.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { floatingProps, FILE } from './probe-floating-props.mjs';
const bad = await floatingProps();
assert.equal(bad.length, 0, 'floating props: ' + bad.map((p) => p.id + ' ' + p.float).join(', '));
const w = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const beams = w.structures.filter((s) => /Prop_Support/.test(s.mesh || '') && !/^strand/.test(s.id));
assert.equal(beams.length, 0, 'X-beam struts left: ' + beams.map((s) => s.id).join(', '));
console.log('floatingProps ok');
// OB-155: checkProp sunk (opt-in): a mesh whose lowest vertex is 0.5 m under the ground at its origin is flagged; seated on the ground is not
import { checkProp } from './prop-ground-lint.mjs';
{
  const mesh = { pos: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 1]) }, g = () => 0;
  assert.ok(checkProp({ id: 'a', origin: { x: 0, y: 0, z: -0.5 } }, mesh, g, [], { sunk: true })?.kind.includes('sunk'), 'sunk flagged');
  assert.equal(checkProp({ id: 'a', origin: { x: 0, y: 0, z: -0.5 } }, mesh, g), null, 'sunk is opt-in');
  assert.equal(checkProp({ id: 'a', origin: { x: 0, y: 0, z: 0 } }, mesh, g, [], { sunk: true }), null, 'seated is fine');
}
console.log('floatingProps sunk ok');
