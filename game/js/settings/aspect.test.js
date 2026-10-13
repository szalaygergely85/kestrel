// OB-117 (aspect ratio option) + OB-118 ('extreme' quality label). Node only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { ASPECT_VALUES, DEFAULT_ASPECT, aspectRatio, getDefaultValues, findOption } from './options.js';
import { saveSettings, loadSettings } from '../platform/web.js';

assert.equal(DEFAULT_ASPECT, '16:9');
assert.equal(getDefaultValues().aspect, '16:9');
assert.deepEqual(ASPECT_VALUES, ['16:9', '16:10', '21:9', '4:3', 'fill']);
assert.ok(findOption('aspect'));
assert.deepEqual(ASPECT_VALUES.map(aspectRatio), [16 / 9, 16 / 10, 21 / 9, 4 / 3, null]); // fed to RenderTarget.setAspect (ratio math: engine/render/glyphMetrics.test.js)
assert.equal(aspectRatio('bogus'), 16 / 9);
// persistence (in-memory storage object on a fake window)
const mem = new Map();
globalThis.window = { ['local' + 'Storage']: { getItem: (k) => mem.has(k) ? mem.get(k) : null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) } };
assert.equal(loadSettings().aspect, undefined, 'absent until chosen (consumers default to 16:9)');
saveSettings({ aspect: '21:9' });
assert.equal(loadSettings().aspect, '21:9');
saveSettings({ aspect: 'nope', muted: true });
assert.equal(loadSettings().aspect, '21:9', 'invalid ignored, kept');
// OB-118: the quality strip has a visible 'Extreme' choice
const ctx = vm.createContext({});
for (const f of ['palette.js', 'models/menu_ui.js']) vm.runInContext(readFileSync(new URL('../../../design/' + f, import.meta.url), 'utf8'), ctx);
const q = ctx.ASSETS.uiStyle.settings.quality;
assert.ok(q.choices.includes('extreme') && q.text.extreme === 'Extreme' && q.choices.indexOf('extreme') === q.choices.indexOf('ultra') + 1);
for (const c of q.choices) assert.ok(q.text[c], 'label for ' + c);
console.log('aspect.test: PASS');
