import assert from 'node:assert';
import { selectSuites, relativeImports } from './testSelect.mjs';

const suites = ['engine/a/x.test.js', 'engine/b/y.test.js', 'engine/c/z.test.js', 'tools/check-deps.mjs', 'tools/editor/u.test.mjs'];
const src = {
  'engine/c/z.test.js': "import { f } from '../b/lib.js';",
  'tools/editor/u.test.mjs': "import x from './undo.js'; const d = await import('../../engine/a/dyn.js');",
};
const read = (f) => src[f] ?? '';
const pick = (ch) => selectSuites(suites, ch, read);

assert.deepStrictEqual(pick(['engine/a/x.test.js']), ['engine/a/x.test.js'], 'suite itself');
assert.deepStrictEqual(pick(['engine/a/foo.js']), ['engine/a/x.test.js'], 'same directory');
assert.deepStrictEqual(pick(['engine/b/lib.js']), ['engine/b/y.test.js', 'engine/c/z.test.js'], 'dir + importer');
assert.deepStrictEqual(pick(['engine/a/dyn.js']), ['engine/a/x.test.js', 'tools/editor/u.test.mjs'], 'dynamic import + dir');
assert.deepStrictEqual(pick(['docs/readme.md']), [], 'unrelated');
assert.deepStrictEqual(relativeImports('a/b/c.js', "import q from '../d.js'"), ['a/d.js']);
console.log('PASS testSelect');
