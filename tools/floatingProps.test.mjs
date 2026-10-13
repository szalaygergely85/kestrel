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
