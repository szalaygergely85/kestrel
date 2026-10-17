import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadQuests } from './model.js';
import { loadDialogues, dialogueText } from './lines.js';
import { conversationView, conversationLint } from './conversation.js';
import { rewardTiles, setRewardItems, rewardLint, COIN_NOTE } from './rewards.js';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const fs = { readFileSync, readdirSync, existsSync, statSync, writeFileSync };
const dm = loadDialogues(join(root, 'content/dialogue'), fs), model = loadQuests(join(root, 'content/quests'));
const by = (id) => model.quests.find((x) => x.id === id);
const ORDER = ['Offer', 'Accept', 'Progress', 'Hand-in', 'After'];

// conversation: sq.burl.blue (offer with Accept + Exit), burl.road (hand-in node sets a flag)
const blue = conversationView(dm, by('sq.burl.blue'));
const offer = blue.nodes.find((n) => n.stage === 'Offer' && n.accept);
assert.ok(offer, 'offer node with accept'); assert.ok(offer.exit, 'exit'); assert.equal(offer.branches.length, 2);
assert.ok(offer.branches.find((b) => b.accept).sets[0].endsWith('.accept'));
assert.deepEqual(blue.problems, [], 'sq.burl.blue clean');
const road = conversationView(dm, by('burl.road'));
const hand = road.nodes.find((n) => n.stage === 'Hand-in');
assert.ok(hand && hand.sets.includes('q.burl.road.handin') && hand.speaker && hand.lines[0].count <= 56);
assert.ok(road.nodes.every((n, i, a) => !i || ORDER.indexOf(a[i - 1].stage) <= ORDER.indexOf(n.stage)), 'reading order');
// dangling GOTO + missing Accept are flagged
const dm2 = loadDialogues(join(root, 'content/dialogue'), fs);
for (const f of dm2.files.values()) for (const n of Object.values(f.obj.nodes)) for (const c of n.choices || []) if (c.setFlag === 'q.sq.burl.blue.accept') { c.next = 'nope.node'; delete c.setFlag; }
const bad = conversationView(dm2, by('sq.burl.blue'));
assert.ok(bad.problems.some((p) => /GOTO "nope.node"/.test(p)) && bad.problems.some((p) => /no Accept/.test(p)));
assert.ok(conversationLint(dm2, by('sq.burl.blue')).every((m) => m.severity === 'error'));
// untouched files still round-trip
for (const x of dm.files.values()) assert.equal(dialogueText(x), readFileSync(join(root, 'content/dialogue', x.name), 'utf8'));

// rewards
const defs = { 'potion.hp': { name: 'Health Potion', rarity: 'common' }, 'heart.piece': { name: 'Heart Piece' } };
const q = by('sq.burl.blue');
const t = rewardTiles(q, defs, {}, model);
assert.equal(t.coin.enabled, false); assert.equal(t.coin.note, COIN_NOTE); assert.equal(t.heart.shown, true);
assert.equal(rewardTiles(q, {}, {}).heart.shown, false, 'heart only if registered');
assert.equal(rewardTiles(q, defs, { coinPaid: true }).coin.enabled, true);
const before = JSON.stringify(q.raw);
const r1 = setRewardItems(q, { items: [...t.items, { id: 'potion.hp', n: 2 }] });
r1.cmd.apply(); assert.ok(q.raw.reward && !q.raw.rewards && q.raw.reward.items.some((i) => i.id === 'potion.hp' && i.n === 2));
r1.cmd.undo(); assert.equal(JSON.stringify(q.raw), before, 'undo restores');
if (t.items.length) assert.ok(setRewardItems(q, { items: [], heartPiece: 0, coin: 0 }).error, 'last reward cannot be removed');
assert.ok(setRewardItems(q, { heartPiece: 1 }).cmd);
const fq = model.quests.find((x) => x.raw.rewards !== undefined);
if (fq) { const c = setRewardItems(fq, { heartPiece: 1 }); c.cmd.apply(); assert.ok(fq.raw.rewards.heartPiece === 1 && fq.raw.reward === undefined); c.cmd.undo(); }
assert.equal(rewardLint({ raw: { id: 'x' } }, defs).length, 1, 'no reward = warning');
// ED-QUI-10 branch edits
import { setBranchText, setBranchGoto, setBranchFlags, gotoTargets } from './conversation.js';
{
  const q = by('sq.burl.blue'), dm3 = loadDialogues(join(root, 'content/dialogue'), fs);
  const key = 'bear.dialogue.json#bear.blue.offer.2', nd = dm3.files.get('bear.dialogue.json').obj.nodes['bear.blue.offer.2'];
  assert.equal(dialogueText(dm3.files.get('bear.dialogue.json')), dm3.files.get('bear.dialogue.json').text, 'untouched round-trips byte-identically');
  const was = JSON.stringify(nd.choices);
  // text: R19 38 cap, empty refused, undo
  assert.ok(setBranchText(q, key, 0, 'x'.repeat(39), dm3).error && setBranchText(q, key, 0, '  ', dm3).error && setBranchText(q, key, 5, 'a', dm3).error);
  const t = setBranchText(q, key, 0, "I'll bring six.", dm3); t.cmd.apply(); assert.equal(nd.choices[0].text, "I'll bring six.");
  const f3 = dm3.files.get('bear.dialogue.json'), txt = dialogueText(f3);
  assert.ok(txt.includes(`{"next": "bear.blue.accepted", "setFlag": "q.sq.burl.blue.accept", "text": "I'll bring six."}`), 'choice re-rendered in place');
  assert.equal(JSON.stringify(JSON.parse(txt).nodes['bear.blue.offer.2'].choices), JSON.stringify(nd.choices));
  assert.equal(txt.split('"next"').length, f3.text.split('"next"').length, 'only the one choice line changed');
  t.cmd.undo(); assert.equal(JSON.stringify(nd.choices), was); assert.equal(dialogueText(f3), f3.text, 'undo restores bytes');
  // goto: must exist; picker lists quest nodes; Exit choice can be retargeted or ended, Accept cannot be ended
  assert.ok(setBranchGoto(q, key, 1, 'nope.node', dm3).error && setBranchGoto(q, key, 0, '', dm3).error);
  assert.ok(gotoTargets(dm3, q, key).includes('bear.blue.accepted'));
  const g = setBranchGoto(q, key, 1, 'bear.blue.active', dm3); g.cmd.apply(); assert.equal(nd.choices[1].next, 'bear.blue.active'); assert.deepEqual(conversationView(dm3, q).problems, []);
  assert.equal(JSON.parse(dialogueText(f3)).nodes['bear.blue.offer.2'].choices[1].next, 'bear.blue.active'); g.cmd.undo();
  const e = setBranchGoto(q, key, 1, '', dm3); e.cmd.apply(); assert.ok(!('next' in nd.choices[1])); e.cmd.undo(); assert.equal(JSON.stringify(nd.choices), was);
  // flags: one flag, valid name, Accept flag locked
  assert.ok(setBranchFlags(q, key, 1, ['a.b', 'c.d'], dm3).error && setBranchFlags(q, key, 1, ['Bad Flag'], dm3).error);
  assert.ok(setBranchFlags(q, key, 0, [], dm3).error && setBranchFlags(q, key, 0, ['other.flag'], dm3).error, 'accept flag locked');
  assert.ok(setBranchFlags(q, key, 0, ['q.sq.burl.blue.accept'], dm3).cmd, 'same accept flag is fine');
  const fl = setBranchFlags(q, key, 1, ['mood.sour'], dm3); fl.cmd.apply();
  assert.deepEqual(Object.keys(nd.choices[1]), ['next', 'setFlag', 'text'], 'new key lands alphabetically');
  assert.equal(JSON.parse(dialogueText(f3)).nodes['bear.blue.offer.2'].choices[1].setFlag, 'mood.sour');
  const view = conversationView(dm3, q); assert.ok(view.nodes.some((n) => n.branches.some((b) => b.sets[0] === 'mood.sour')));
  fl.cmd.undo(); assert.equal(JSON.stringify(nd.choices), was); assert.equal(dialogueText(f3), f3.text);
}
console.log('conversation.test PASS');
