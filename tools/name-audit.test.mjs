// OB-135: player-facing names/descriptions have no placeholder words, id-like names or tier codes.
import assert from 'node:assert/strict';
import { audit } from './name-audit.mjs';
const { rows, issues } = audit();
const bad = issues.filter((i) => ['placeholder', 'id-as-name', 'tier-code', 'duplicate-name'].includes(i.why));
assert.ok(rows.length > 100, 'audit collected strings');
assert.equal(bad.length, 0, 'name audit issues:\n' + bad.map((i) => '[' + i.why + '] ' + i.where + ' : ' + i.text).join('\n'));
console.log('name-audit.test ok (' + rows.length + ' strings)');
