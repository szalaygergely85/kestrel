// OB-218: the editor registers char.kit (Hesk, Dorrin) from the char kit json.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerKitChar } from './charKit.js';

const kit = JSON.parse(readFileSync(new URL('../../content/chargen/human.charkit.json', import.meta.url), 'utf8'));
const mk = () => { const m = new Map(); return { has: (k, n) => m.has(k + n), add: (k, n, d) => m.set(k + n, d), get: (k, n) => m.get(k + n) }; };
const reg = mk();
const fetchFn = async () => ({ ok: true, json: async () => kit });
assert.equal(await registerKitChar(reg, 'x', fetchFn), true);
assert.ok(reg.has('model', 'char.kit') && reg.get('model', 'char.kit').voxel, 'char.kit has a voxel def');
assert.equal(await registerKitChar(reg, 'x', fetchFn), false, 'second call is a no-op');
const reg2 = mk();
assert.equal(await registerKitChar(reg2, 'x', async () => ({ ok: false, status: 404 })), false, 'a 404 does not throw');
console.log('charKit.test PASS');
