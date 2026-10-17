// ED-LOGIC-02a: content/logic/vocab.schema.json (read by tools/editor, which may not import game/) must equal the
// arg schema of game/js/logic/vocab.js exactly.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LOGIC_VOCAB } from '../game/js/logic/vocab.js';
const schema = JSON.parse(readFileSync(new URL('../content/logic/vocab.schema.json', import.meta.url), 'utf8'));
for (const part of ['events', 'conds', 'acts']) {
  assert.deepEqual(Object.keys(schema[part]), Object.keys(LOGIC_VOCAB[part]), part + ' names');
  for (const n of Object.keys(LOGIC_VOCAB[part])) assert.deepEqual(schema[part][n].args, LOGIC_VOCAB[part][n].args, `${part}.${n} args`);
}
console.log('logic vocab schema parity ok');
