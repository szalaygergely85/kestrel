// D-080 / OB-146: the player never reads the word "relay" (internal ids/keys may keep it). Scans every player-facing string
// the game shows: quest/dialogue/level JSON prose, relay wake prompts/hints/notice/card, waystone toasts + names, item names.
// Run: node game/js/quest/noRelayText.test.js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as RW from './relayWake.js';
import * as WS from './wire/waystone.js';
import { NOTICE_TEXT } from '../ui/noticeText.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../../..');
const hits = [];
const check = (where, s) => { if (typeof s === 'string' && /relay/i.test(s)) hits.push(where + ' = ' + s.slice(0, 80)); };

// 1) JSON prose: any string with a space, except notes (identifiers/keys have no spaces).
const files = [];
(function walk(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (p.endsWith('.json')) files.push(p); } })(path.join(root, 'content/quests'));
for (const f of fs.readdirSync(path.join(root, 'content/dialogue'))) if (f.endsWith('.json')) files.push(path.join(root, 'content/dialogue', f));
files.push(path.join(root, 'content/levels/tower.level.json'));
for (const f of files) {
  (function rec(v, k, p) {
    if (typeof v === 'string') { if (k !== 'note' && k !== '_note' && v.includes(' ')) check(path.relative(root, f) + ' ' + p, v); }
    else if (Array.isArray(v)) v.forEach((x, i) => rec(x, k, p + '[' + i + ']'));
    else if (v && typeof v === 'object') for (const kk in v) rec(v[kk], kk, p + '.' + kk);
  })(JSON.parse(fs.readFileSync(f, 'utf8')), '', '');
}

// 2) JS constants the HUD / map / toasts show.
for (const k of ['PROMPT_WAKE', 'PROMPT_TOUCH', 'PROMPT_STONE', 'PROMPT_LOOK', 'HINT_NEED_CRYSTAL', 'HINT_NEED_WAYSTONE', 'HINT_NEED_TALK']) check('relayWake.' + k, RW[k]);
check('relayWake.HINT_NO_CRYSTAL', RW.HINT_NO_CRYSTAL.text); RW.NOTICE.forEach((s, i) => check('relayWake.NOTICE' + i, s));
check('card', RW.wakeCard('ws_ford', true)); check('card', RW.wakeCard('x', false));
for (const [k, v] of Object.entries(WS.RELAY_TITLES)) check('RELAY_TITLES.' + k, v); // also the M-map labels
for (const [k, v] of Object.entries(WS.RELAY_WAKE)) check('RELAY_WAKE.' + k, v);
for (const k of ['RELAY_SAVED', 'TOAST_SAVED', 'TOAST_HEALED']) check('waystone.' + k, WS[k]);
for (const [k, n] of Object.entries(NOTICE_TEXT)) { check('notice.' + k, n.title); n.lines.forEach((s) => check('notice.' + k, s)); }

// 3) Item names / use text (classic script: read the source literals).
const itemSrc = fs.readFileSync(path.join(root, 'design/items.js'), 'utf8');
for (const m of itemSrc.matchAll(/\b(name|desc|none): *'([^']*)'/g)) check('items.js ' + m[1], m[2]);

assert.deepEqual(hits, [], 'player-facing "relay" left:\n' + hits.join('\n'));
assert.match(RW.wakeCard('ws_ford', true), /^Waystone woken: travel \(M\), heal \+ save, new task\.$/);
assert.equal(RW.wakeCard('ws_x', false), 'Waystone woken: travel (M), heal + save.');
console.log('noRelayText: ok (' + files.length + ' json files)');
