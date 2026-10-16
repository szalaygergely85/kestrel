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
console.log('conversation.test PASS');
