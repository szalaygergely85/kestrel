// OB-155: ONE main/side rule over the real quest content: every mq.* quest is main (gold), every sq.* / errand is side (blue).
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createQuestBook } from './sim/questBook.js';
import { loadDesignAssets, loadQuestFiles, loadPackQuests } from '../../../tools/validate-content.mjs';

const assets = await loadDesignAssets();
const dir = fileURLToPath(new URL('../../../content/quests', import.meta.url));
const files = loadQuestFiles(dir), packs = await loadPackQuests(dir, assets.items?.defs);
const all = [...files.quests, ...packs.quests].map(q => q.def);
const book = createQuestBook(all.find(d => d.id === 'm1'), all.filter(d => d.id !== 'm1'));
let nMain = 0, nSide = 0;
for (let i = 1; i < 1000; i++) {
  let d; try { d = book.def(i); } catch { break; } if (!d) break;
  if (d.id.startsWith('mq.')) { assert.equal(book.isMain(i), true, d.id + ' must be main'); nMain++; }
  else if (d.id.startsWith('sq.')) { assert.equal(book.isMain(i), false, d.id + ' must be side'); nSide++; }
}
assert.ok(nMain >= 5 && nSide >= 1, 'real content has both kinds: ' + nMain + '/' + nSide);
assert.equal(book.isMain(0), true, 'entry 0 is main');
console.log('mainRule ok: ' + nMain + ' main mq.*, ' + nSide + ' side sq.*');
