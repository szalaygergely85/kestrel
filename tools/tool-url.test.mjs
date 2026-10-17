import assert from 'node:assert/strict';
import { withTimeFreeze, gameUrl, parseTimeArg, DEFAULT_TOOL_HOUR } from './tool-url.mjs';

assert.equal(DEFAULT_TOOL_HOUR, 8);
assert.equal(withTimeFreeze(''), 'timefreeze=1&time=8');
assert.equal(withTimeFreeze('gpucompare=1'), 'gpucompare=1&timefreeze=1&time=8');
assert.equal(withTimeFreeze('?a=1', 19.5), 'a=1&timefreeze=1&time=19.5');
assert.equal(withTimeFreeze('time=23&a=1'), 'time=23&a=1&timefreeze=1'); // explicit param wins
assert.equal(withTimeFreeze('timefreeze=0&time=6'), 'timefreeze=0&time=6');
assert.equal(withTimeFreeze('daytime=3'), 'daytime=3&timefreeze=1&time=8'); // no false prefix match
assert.equal(gameUrl(9725, 'save=0'), 'http://127.0.0.1:9725/game/index.html?save=0&timefreeze=1&time=8');
assert.equal(parseTimeArg(undefined), 8);
assert.equal(parseTimeArg('19.5'), 19.5);
assert.throws(() => parseTimeArg('x'));
assert.throws(() => parseTimeArg('25'));
console.log('tool-url: ok');

// --time flag plumbing in the tool parsers
import { parseArgs as capArgs } from './capture-browser.mjs';
import { parseArgs as cineArgs } from './capture-cinematic.mjs';
assert.equal(capArgs(['--mode', 'bench', '--port', '9725', '--time', '19.5']).time, 19.5);
assert.equal(capArgs(['--mode', 'bench', '--port', '9725', '--time=23']).time, 23);
assert.equal(capArgs(['--mode', 'bench', '--port', '9725']).time, undefined);
assert.equal(cineArgs(['--port', '9725', '--cinematic', 'intro', '--time=6']).time, 6);
console.log('tool-url args: ok');
