import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadQuests, makeStack, fileText } from './model.js';
import { LINE_MAX, loadDialogues, dialogueText, saveDialogues, questNodes, lineRows, setLine, addLine, deleteLine, moveLine, captureBaseline, changedLines, exportChangedText } from './lines.js';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const fs = { readFileSync, readdirSync, existsSync, statSync, writeFileSync };
const dm = loadDialogues(join(root, 'content/dialogue'), fs);
assert.ok(dm.files.size >= 10);
for (const [n, f] of dm.files) assert.equal(dialogueText(f), readFileSync(join(root, 'content/dialogue', n), 'utf8'), 'round trip ' + n);

// cap: 55 / 56 / 57 chars, multi-byte counted by characters
const model = loadQuests(join(root, 'content/quests'));
const base = captureBaseline(model);
const q = model.quests.find((x) => x.raw.lines && x.raw.lines.offer && x.raw.lines.offer.length);
assert.equal(LINE_MAX, 56);
assert.ok(setLine(q, 'offer', 0, 'a'.repeat(55)).cmd);
assert.ok(setLine(q, 'offer', 0, 'a'.repeat(56)).cmd);
assert.match(setLine(q, 'offer', 0, 'a'.repeat(57)).error, /57 characters/);
assert.ok(setLine(q, 'offer', 0, 'é'.repeat(56)).cmd, 'accents count as 1');
assert.ok(setLine(q, 'offer', 0, '\u{1F600}'.repeat(56)).cmd, 'astral chars count as 1');
assert.ok(setLine(q, 'offer', 0, '\u{1F600}'.repeat(57)).error);
assert.ok(setLine(q, 'offer', 99, 'x').error);

// pack write target + undo + byte-exact round trip
const st = makeStack(), file = model.files.get(q.file), orig = fileText(file);
const was = [...q.raw.lines.offer];
st.run(setLine(q, 'offer', 0, 'Changed.').cmd);
st.run(addLine(q, 'offer', 'New one.').cmd);
st.run(moveLine(q, 'offer', 0, 1).cmd);
st.run(deleteLine(q, 'offer', 0).cmd);
assert.equal(q.raw.lines.offer.length, was.length);
let ch = changedLines(model, dm, base);
assert.ok(ch.length > 0 && ch.every((r) => r.quest === q.title));
while (st.undo());
assert.deepEqual(q.raw.lines.offer, was);
assert.equal(fileText(file), orig);
assert.deepEqual(changedLines(model, dm, base), []);
assert.equal(exportChangedText([]), 'No changed lines.\n');

// dialogue write target: rook road quest
const rq = { id: 'mq.river.road', title: 'River road', giver: 'rook', raw: {} };
const nodes = questNodes(dm, 'mq.river.road');
assert.ok(nodes.some((n) => n.node === 'rook.road.1' && n.stage === 'offer'));
assert.ok(nodes.some((n) => n.node === 'rook.road.2' && n.stage === 'accept'));
assert.ok(nodes.some((n) => n.node === 'rook.road.ready' && n.stage === 'ready'));
const rows = lineRows(rq, dm);
const r0 = rows.find((r) => r.key === 'rook.dialogue.json#rook.road.1');
assert.equal(r0.speaker, 'Rook'); assert.equal(r0.count, r0.text.length);
const key = r0.key, f = dm.files.get('rook.dialogue.json'), ftext = f.text;
assert.ok(setLine(rq, key, 0, 'x'.repeat(57), dm).error);
const dst = makeStack();
dst.run(setLine(rq, key, 0, 'West. Walk the road.', dm).cmd);
dst.run(addLine(rq, key, 'Second line.', dm).cmd);
const t1 = dialogueText(f);
assert.notEqual(t1, ftext);
assert.equal(JSON.parse(t1).nodes['rook.road.1'].lines.length, 2);
// only that node's lines changed: everything else is byte-identical
const strip = (t) => t.replace(/("rook\.road\.1": \{[^\n]*"lines": )\[[\s\S]*?\n    \]/, '$1[]');
assert.equal(strip(t1), strip(ftext));
ch = changedLines(model, dm, base);
assert.equal(ch.length, 2); assert.equal(ch[0].kind, 'changed'); assert.equal(ch[1].kind, 'added');
const txt = exportChangedText(ch);
assert.match(txt, /was: West\. The road runs/); assert.match(txt, /now: Second line\./);
const written = [];
assert.deepEqual(saveDialogues(dm, { writeFileSync: (p, t) => written.push([p, t]) }), ['rook.dialogue.json']);
assert.equal(written[0][1], t1);
assert.deepEqual(changedLines(model, dm, base), []);
dst.undo(); dst.undo();
assert.deepEqual(JSON.parse(dialogueText(f)).nodes['rook.road.1'].lines, JSON.parse(ftext).nodes['rook.road.1'].lines);
console.log('lines.test OK');
