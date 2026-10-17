// tools/editor/quest/conversation.js - ED-QUI-05. Card [04] view model: the quest's dialogue nodes in reading order
// (offer -> accept -> progress -> hand-in -> after) with lines, branches (read-only) and Accept / Exit checks. Pure (imports lines.js).
import { lineRows, STAGE_LABEL, questNodes } from './lines.js';

const ORDER = ['Offer', 'Accept', 'Progress', 'Hand-in', 'After'];

const ROLE_BY_STAGE = { Offer: 'OFFER', Accept: 'ACCEPT', Progress: 'ACTIVE', 'Hand-in': 'HAND-IN', After: 'LATER' };
/** Role tag of a node (ED-QUI-07a): the node's own id wins (meet / chatter chains), else its stage. A first-meeting chain reached through a hand-in is MEET, not HAND-IN. */
export function nodeRole(n) {
  const id = String(n.id || '');
  if (/(^|[._-])meet([._-]|$)/.test(id)) return 'MEET';
  if (/(^|[._-])(chatter|bark|idle|repeat)([._-]|$)/.test(id)) return 'CHATTER';
  return ROLE_BY_STAGE[n.stage] || n.stage.toUpperCase();
}

/** Accept = a choice that sets q.<id>.accept (or the legacy s.<id>.accept); Exit = any other choice or a node with end:true. */
const isAccept = (c, qid) => c.setFlag === 'q.' + qid + '.accept' || c.setFlag === 's.' + qid + '.accept';

/**
 * conversationView(dm, q, names?) -> { nodes:[{id,key,file,speaker,stage,gate,lines:[row],branches:[{text,goto,gate,sets,accept,dangling}],
 *   sets:[flag], end, accept, exit, pack}], problems:[text] }.
 * Dialogue nodes come from questNodes() (via lineRows); pack `lines` groups (offer/active/ready/done) are lines-only pseudo nodes.
 */
export function conversationView(dm, q, names) {
  const rows = lineRows(q, dm, names), nodes = [], problems = [];
  const byKey = new Map();
  for (const r of rows) {
    if (!byKey.has(r.key)) byKey.set(r.key, { key: r.key, stage: r.stage, speaker: r.speaker, source: r.source, lines: [] });
    byKey.get(r.key).lines.push(r);
  }
  for (const g of byKey.values()) {
    const n = { id: g.key, key: g.key, file: null, speaker: g.speaker, stage: g.stage, gate: '', lines: g.lines, branches: [], sets: [], end: false, accept: false, exit: false, pack: g.source === 'pack' };
    if (g.source === 'dialogue') {
      const [file, node] = g.key.split('#'), f = dm.files.get(file), def = f.obj.nodes[node];
      n.id = node; n.file = file; n.end = !!def.end;
      if (def.setFlag) n.sets.push(def.setFlag);
      const entry = (f.obj.entry || []).find((e) => e.node === node);
      n.gate = entry && entry.requires ? entry.requires : '';
      (def.choices || []).forEach((c, ci) => {
        const acc = isAccept(c, q.id);
        if (acc) n.accept = true; else n.exit = true;
        n.branches.push({ index: ci, editable: true, text: c.text || '', goto: c.next || '', gate: c.requires || '', sets: c.setFlag ? [c.setFlag] : [], accept: acc, dangling: !!c.next && !f.obj.nodes[c.next] });
      });
      if (def.next) n.branches.push({ index: -1, editable: false, text: '(continues)', goto: def.next, gate: '', sets: [], accept: false, dangling: !f.obj.nodes[def.next] });
      for (const b of n.branches) if (b.dangling) problems.push(`Node ${node}: GOTO "${b.goto}" does not exist`);
    }
    nodes.push(n);
  }
  nodes.sort((a, b) => ORDER.indexOf(a.stage) - ORDER.indexOf(b.stage));
  // OB-156: a quest with an offer node needs an Accept choice and an Exit choice
  if (nodes.some((n) => n.stage === STAGE_LABEL.offer && !n.pack)) {
    if (!nodes.some((n) => n.accept)) problems.push('Offer has no Accept choice');
    if (!nodes.some((n) => n.exit)) problems.push('Offer has no Exit choice');
  }
  return { nodes, problems };
}

/** Lint-style messages for the strip / problem list: [{rule, severity, text, target}]. */
export function conversationLint(dm, q, names) {
  return conversationView(dm, q, names).problems.map((text) => ({ rule: 'CV', severity: 'error', text, target: { kind: 'field', id: 'lines' } }));
}

// ---------- ED-QUI-10: branch edits (choices of a dialogue node; undoable commands, { cmd } or { error }) ----------
export const BRANCH_TEXT_MAX = 38;                     // R19: a choice is shown in the button row (38); LINE_MAX (56) is the hard dialogue cap
const FLAG_RE = /^[a-z][a-zA-Z0-9_.]*$/;               // = engine dialogue FLAG_RE
const nChars = (s) => [...String(s)].length;

/** Resolves branch i of node `key` ("file#node"); { f, node, choices, c } or { error }. */
function branchOf(dm, key, i) {
  const [file, node] = String(key).split('#'), f = dm && dm.files.get(file), def = f && f.obj.nodes && f.obj.nodes[node];
  if (!def) return { error: 'Unknown dialogue node.' };
  const choices = def.choices;
  if (!Array.isArray(choices) || !(i >= 0 && i < choices.length)) return { error: 'No such branch.' };
  return { f, node, choices, c: choices[i] };
}
/** Command that swaps choice i for `after` (an object) and back; keeps the original key order of the file otherwise. */
function branchCmd(label, q, b, i, after) {
  const before = b.choices[i];
  const put = (v) => { b.choices[i] = v; };
  return { cmd: { label, questId: q.id, apply: () => put(after), undo: () => put(before) } };
}
const isAcceptChoice = (c, q) => c.setFlag === 'q.' + q.id + '.accept' || c.setFlag === 's.' + q.id + '.accept';
/** Rebuilds a choice with key `k` set (or removed when v is ''/undefined), new keys in alphabetical position like the generated files. */
function withKey(c, k, v) {
  const o = { ...c };
  if (v === '' || v === undefined) delete o[k]; else o[k] = v;
  if (!(k in c) && k in o) return Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return o;
}

/** Sets the button text of branch i. Empty is refused; > 38 characters (R19) is refused, and anything past 56 is too. */
export function setBranchText(q, key, i, text, dm) {
  const b = branchOf(dm, key, i); if (b.error) return b;
  const t = String(text ?? '').trim();
  if (!t) return { error: 'A choice needs some text.' };
  if (nChars(t) > BRANCH_TEXT_MAX) return { error: `That choice is ${nChars(t)} characters; the limit is ${BRANCH_TEXT_MAX}.` };
  return branchCmd('edit choice', q, b, i, withKey(b.c, 'text', t));
}

/** Node ids a GOTO of this file may point to (the picker list): every node of the dialogue file, the quest's own first. */
export function gotoTargets(dm, q, key) {
  const [file] = String(key).split('#'), f = dm && dm.files.get(file);
  if (!f) return [];
  const mine = questNodes(dm, q.id).filter((n) => n.file === file).map((n) => n.node);
  return [...new Set([...mine, ...Object.keys(f.obj.nodes)])];
}

/** Points branch i at node `target` of the same file; '' ends the conversation. Dangling targets and clearing the Accept GOTO are refused. */
export function setBranchGoto(q, key, i, target, dm) {
  const b = branchOf(dm, key, i); if (b.error) return b;
  const t = String(target ?? '');
  if (t && !Object.prototype.hasOwnProperty.call(b.f.obj.nodes, t)) return { error: `Node "${t}" does not exist.` };
  if (!t && isAcceptChoice(b.c, q)) return { error: 'The Accept choice must lead somewhere.' };
  return branchCmd('edit choice goto', q, b, i, withKey(b.c, 'next', t));
}

/** Sets the flags a branch sets (the engine sets one flag per choice, so a list of 0 or 1). The Accept (E) flag of the quest cannot be removed or changed. */
export function setBranchFlags(q, key, i, flags, dm) {
  const b = branchOf(dm, key, i); if (b.error) return b;
  const list = (Array.isArray(flags) ? flags : [flags]).map((x) => String(x ?? '').trim()).filter(Boolean);
  if (list.length > 1) return { error: 'A choice sets one flag.' };
  if (list[0] && !FLAG_RE.test(list[0])) return { error: `"${list[0]}" is not a valid flag name.` };
  if (isAcceptChoice(b.c, q) && list[0] !== b.c.setFlag) return { error: 'The Accept choice keeps its accept flag.' };
  return branchCmd('edit choice flag', q, b, i, withKey(b.c, 'setFlag', list[0]));
}
