// ED-QUEST-DEPS: the editor's marker constants mirror game/js/quest/markTop.js (editor may not import game/).
import assert from 'node:assert/strict';
import * as game from '../game/js/quest/markTop.js';
import * as ed from './editor/quest/markers.js';
assert.equal(ed.MARK_MARGIN, game.MARK_MARGIN);
assert.equal(ed.MARK_DEFAULT_TOP, game.MARK_DEFAULT_TOP);
assert.equal(game.markZ({ z: 3 }, 2), 3 + 2 + ed.MARK_MARGIN);
console.log('quest-editor-markers-parity OK');
