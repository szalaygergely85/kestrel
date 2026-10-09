// engine/ui/dialogue.test.js - DIALOGUE-01a1 (architecture.md 38.28): runner, validation, loadPack kind.
//   node --expose-gc engine/ui/dialogue.test.js
import { compileDialogue, validateDialogue, createDialogueRunner } from './dialogue.js';
import { loadContentPack } from '../content/loadPack.js';
import { LATEST_SCHEMA, KEY_ORDER } from '../content/schema.js';
import { stringifyContent } from '../content/stringify.js';
import * as engine from '../index.js';
import { makeOk } from '../test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

const def = () => ({
  kind: 'dialogue', schema: 1, id: 'bear',
  speakers: { bear: { label: 'Burl' }, you: { label: 'You', player: true } },
  entry: [{ requires: 'met', node: 'again' }, { node: 'hello' }],
  nodes: {
    hello: { speaker: 'bear', lines: ['Hi, you.', 'Second line'], setFlag: 'met', clip: 'wave', next: 'ask' },
    ask: { speaker: 'you', lines: ['Well?'], choices: [{ text: 'Help', next: 'yes', setFlag: 'helped' }, { text: 'No', next: 'bye' }] },
    yes: { speaker: 'bear', lines: ['Thanks'], setFlag: 'thanked', end: true },
    bye: { speaker: 'bear', lines: ['Bye'], end: true },
    again: { speaker: 'bear', lines: ['Back?'], end: true },
    lost: { speaker: 'bear', lines: ['Nobody'], end: true },
  },
});
const mkFlags = () => { const s = new Set(); return { s, has: (k) => s.has(k), set: (k) => s.add(k) }; };

// ---- validation ---------------------------------------------------------------
{
  const v = validateDialogue(def());
  ok('valid file: no errors, unreachable node only warns', v.errors.length === 0 && v.warnings.length === 1 && /nodes\.lost: unreachable/.test(v.warnings[0]), JSON.stringify(v));
  const bad = (name, mut, re) => { const d = def(); mut(d); const e = validateDialogue(d).errors.join('|'); ok('validate: ' + name, re.test(e), e); };
  bad('no entry', (d) => { d.entry = []; }, /no entry/);
  bad('last entry has requires', (d) => { d.entry = [{ requires: 'met', node: 'hello' }]; }, /last entry has a requires/);
  bad('entry to missing node', (d) => { d.entry[1].node = 'zzz'; }, /entry\[1\]\.node.*missing node/);
  bad('next to missing node', (d) => { d.nodes.hello.next = 'zzz'; }, /hello\.next.*missing node/);
  bad('choice next to missing node', (d) => { d.nodes.ask.choices[0].next = 'zzz'; }, /choices\[0\]\.next.*missing node/);
  bad('node with none of next/choices/end', (d) => { delete d.nodes.bye.end; }, /bye: needs exactly one/);
  bad('node with two of next/end', (d) => { d.nodes.bye.next = 'hello'; }, /bye: needs exactly one/);
  bad('1 choice', (d) => { d.nodes.ask.choices.pop(); }, /expected 2\.\.3/);
  bad('4 choices', (d) => { const c = d.nodes.ask.choices; c.push(c[0], c[0]); }, /expected 2\.\.3/);
  bad('line too long', (d) => { d.nodes.bye.lines[0] = 'x'.repeat(57); }, /57 chars, max 56/);
  bad('choice too long', (d) => { d.nodes.ask.choices[0].text = 'x'.repeat(41); }, /41 chars, max 40/);
  bad('non-ASCII char', (d) => { d.nodes.bye.lines[0] = 'café'; }, /outside ASCII/);
  bad('control char', (d) => { d.nodes.bye.lines[0] = 'a\tb'; }, /outside ASCII/);
  bad('unknown speaker', (d) => { d.nodes.bye.speaker = 'ghost'; }, /unknown speaker/);
  bad('bad node flag key', (d) => { d.nodes.hello.setFlag = 'Met'; }, /bad flag key/);
  bad('bad choice flag key', (d) => { d.nodes.ask.choices[0].setFlag = 'has space'; }, /bad flag key/);
  bad('bad requires key', (d) => { d.entry[0].requires = '1x'; }, /bad flag key/);
  ok('flag keys with dots/camelCase are fine', validateDialogue(Object.assign(def(), { entry: [{ requires: 'bear.metTwice', node: 'again' }, { node: 'hello' }] })).errors.length === 0);
  ok('non-object refused', validateDialogue(null).errors.length === 1);
}

// ---- compile ------------------------------------------------------------------
const comp = compileDialogue(def());
ok('compile: frozen, int node indices', Object.isFrozen(comp) && Object.isFrozen(comp.nodes[0]) && comp.entry[1].node === 0 && comp.nodes[0].next === 1 && comp.nodes[1].choices[0].next === 2);
{ let threw = false; try { compileDialogue({}); } catch (e) { threw = true; } ok('compile throws on an invalid file', threw); }

// ---- runner -------------------------------------------------------------------
const mk = (opts) => { const ev = []; const r = createDialogueRunner(Object.assign({ onEvent: (n, a) => ev.push(n + ':' + a) }, opts)); return { r, ev }; };
{
  const { r, ev } = mk({ cps: 10, holdSec: 0.5 });
  const f = mkFlags();
  ok('idle before open', r.state === 'idle');
  r.open(comp, f);
  ok('first talk: entry fallback, typing, speaker + clip, node flag set on enter', r.state === 'typing' && r.speakerLabel === 'Burl' && !r.isPlayer && r.line === 'Hi, you.' && r.clip === 'wave' && f.s.has('met') && r.visibleChars === 0);
  r.tick(0.35);
  ok('typewriter: 0.35 s at 10 cps = 3 chars', r.visibleChars === 3, String(r.visibleChars));
  r.tick(0.1); // the comma (index 2) was the 3rd char: revealed, then hold 0.5 s
  ok('comma reveals then holds', r.visibleChars === 3, String(r.visibleChars));
  r.tick(0.35);
  ok('still held 0.45 s after the comma', r.visibleChars === 3, String(r.visibleChars));
  r.tick(0.2);
  ok('hold ends and typing resumes', r.visibleChars === 4, String(r.visibleChars));
  r.press();
  ok('press while typing completes the line', r.visibleChars === r.line.length && r.state === 'waiting');
  r.press();
  ok('press advances to the next line of the node', r.state === 'typing' && r.line === 'Second line' && r.visibleChars === 0);
  r.tick(10);
  ok('long tick finishes the line (no overshoot)', r.visibleChars === 11 && r.state === 'waiting');
  r.press();
  ok('next node: player line, typing, clip cleared', r.state === 'typing' && r.isPlayer && r.speakerLabel === 'You' && r.clip === null);
  r.tick(10);
  ok('last line of a choice node -> choosing', r.state === 'choosing' && r.choiceCount === 2 && r.selected === 0 && r.choiceText(0) === 'Help' && r.choiceText(1) === 'No' && r.choiceText(5) === '');
  r.move(1); ok('move +1', r.selected === 1);
  r.move(1); ok('move wraps', r.selected === 0);
  r.move(-1); ok('move -1 wraps', r.selected === 1);
  r.move(-1);
  r.press(); ok('press does not choose', r.state === 'choosing');
  r.choose();
  ok('choose: choice flag set, next node entered with its node flag', f.s.has('helped') && f.s.has('thanked') && r.line === 'Thanks' && r.state === 'typing');
  r.tick(10); r.press();
  ok('end node: press ends', r.state === 'ended');
  ok('events in order', ev.join(',') === 'open:bear,node:hello,flag:met,node:ask,flag:helped,node:yes,flag:thanked,end:bear', ev.join(','));
  r.press(); r.tick(1); r.move(1); r.choose(); r.close();
  ok('inputs after the end are inert', r.state === 'ended' && ev.length === 8);

  // repeat: entry picks the requires-node once the flag is set
  r.open(comp, f);
  ok('repeat talk: entry requires met -> again node', r.line === 'Back?' && r.state === 'typing');
}
{
  // Esc leaves later flags unset
  const { r, ev } = mk({ cps: 100 });
  const f = mkFlags();
  r.open(comp, f);
  r.tick(10); r.press(); r.tick(10); r.press(); r.tick(10);
  ok('reached the choice', r.state === 'choosing');
  r.close();
  ok('close: ended, later flags (helped/thanked) unset, earlier kept', r.state === 'ended' && f.s.has('met') && !f.s.has('helped') && !f.s.has('thanked') && ev[ev.length - 1] === 'close:bear');
  const d2 = mk({}); d2.r.close();
  ok('close while idle is inert', d2.r.state === 'idle' && d2.ev.length === 0);
}
{
  // frame-size independence of the typewriter
  const a = mk({ cps: 30 }).r, b = mk({ cps: 30 }).r;
  a.open(comp, mkFlags()); b.open(comp, mkFlags());
  for (let i = 0; i < 30; i++) a.tick(1 / 60);
  b.tick(0.5);
  ok('typewriter: 30 x 1/60 s == one 0.5 s tick', a.visibleChars === b.visibleChars, a.visibleChars + ' vs ' + b.visibleChars);
}

// ---- zero allocation ------------------------------------------------------------
{
  const r = createDialogueRunner({ cps: 60, onEvent() {} });
  const f = { has: () => false, set() {} };
  const loop = (n) => {
    for (let i = 0; i < n; i++) {
      if (r.state === 'idle' || r.state === 'ended') r.open(comp, f);
      r.tick(1 / 60);
      const m = i % 7;
      if (m === 3) r.press(); else if (m === 5) { r.move(1); r.choose(); }
    }
  };
  loop(3000);
  if (globalThis.gc) globalThis.gc();
  const h0 = process.memoryUsage().heapUsed;
  loop(10000);
  if (globalThis.gc) globalThis.gc();
  const grew = process.memoryUsage().heapUsed - h0;
  ok(`10k steps: heap growth ${grew} B < 200 KB`, !globalThis.gc || grew < 200000);
}

// ---- engine export + schema -----------------------------------------------------
ok('engine/index.js exports the dialogue API', engine.compileDialogue === compileDialogue && engine.validateDialogue === validateDialogue && engine.createDialogueRunner === createDialogueRunner);
ok('schema tables know the dialogue kind', LATEST_SCHEMA.dialogue === 1 && KEY_ORDER.dialogue.join() === 'kind,schema,id,speakers,entry,nodes');
{
  const text = stringifyContent(def());
  ok('canonical writer: key order, node order kept, idempotent', /"kind"[\s\S]*"speakers"[\s\S]*"entry"[\s\S]*"nodes"/.test(text) && text.indexOf('"hello"') < text.indexOf('"ask"') && stringifyContent(JSON.parse(text)) === text);
}

// ---- loadPack integration -------------------------------------------------------
const manifest = (files) => ({ kind: 'manifest', schema: 1, id: 'p', contentVersion: 1, files });
const fetchOf = (files) => async (u) => {
  const key = new URL(u).pathname.split('/').pop();
  if (!(key in files)) throw new Error(`404 ${key}`);
  return JSON.stringify(files[key]);
};
const load = (files, names) => loadContentPack('http://x/manifest.json', { fetchText: fetchOf({ 'manifest.json': manifest(names), ...files }) }).catch((e) => e);
const msgs = (e) => (e.errors || [e]).map((x) => `${x.field}: ${x.message}`).join('|');
{
  const b = await load({ 'bear.dialogue.json': def() }, ['bear.dialogue.json']);
  ok('loadPack: bundle.dialogues.bear is the compiled form', !(b instanceof Error) && b.dialogues.bear && b.dialogues.bear.nodes.length === 6 && Object.isFrozen(b.dialogues.bear), String(b));
  ok('loadPack: meta.dialogue + unreachable node warns (no error)', b.meta.dialogue.bear.schema === 1 && b.warnings.length === 1 && /unreachable/.test(b.warnings[0]) && /bear\.dialogue\.json/.test(b.warnings[0]));
  ok('loadPack: not mixed into other maps', Object.keys(b.levels).length === 0 && Object.keys(b.prefabs).length === 0);
  const r = createDialogueRunner({}); const f = mkFlags(); r.open(b.dialogues.bear, f);
  ok('loadPack: the loaded dialogue runs', r.state === 'typing' && f.s.has('met'));
  const none = await load({}, []);
  ok('pack without dialogues: empty map, no warnings', !(none instanceof Error) && Object.keys(none.dialogues).length === 0 && none.warnings.length === 0);
}
{
  const bad = def(); bad.nodes.hello.next = 'zzz'; bad.nodes.bye.lines[0] = 'x'.repeat(60);
  const e = await load({ 'bear.dialogue.json': bad }, ['bear.dialogue.json']);
  ok('loadPack: bad file refused, every error listed', e instanceof Error && /hello\.next.*missing node/.test(msgs(e)) && /60 chars/.test(msgs(e)), msgs(e));
  const e2 = await load({ 'a.dialogue.json': def(), 'b.dialogue.json': def() }, ['a.dialogue.json', 'b.dialogue.json']);
  ok('loadPack: duplicate dialogue id refused', e2 instanceof Error && /duplicate dialogue id "bear"/.test(msgs(e2)), msgs(e2));
  const camel = def(); camel.id = 'bearTalk';
  const e3 = await load({ 'c.dialogue.json': camel }, ['c.dialogue.json']);
  ok('loadPack: camelCase dialogue id refused', e3 instanceof Error && /bad or missing id/.test(msgs(e3)), msgs(e3));
}

console.log(`${pass} pass, ${fail} fail`);
if (fail) { for (const f of failures) console.log(' - ' + f); process.exit(1); } else console.log('ALL PASS');
