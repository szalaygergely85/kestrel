#!/usr/bin/env node
// EV17-16: dialogue graph lint over content/dialogue/*.dialogue.json + inspect.json (report only).
// Rules: GOTO (target exists) / REACH (reachable from an entry) / DEAD (no next/choices/end) /
// OFFER (accept-flag choice only on an offer node = choices incl. an Exit; OB-156) / FLAG (engine flag pattern) / CHOICELEN (R19 cap).
// Files are read through the editor's loadDialogues (tools/editor/quest/lines.js) - no second parser.
import { readFileSync, readdirSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDialogues, LINE_MAX } from './editor/quest/lines.js';

export const FLAG_RE = /^[a-z][a-zA-Z0-9_.]*$/; // = engine/ui/dialogue.js FLAG_RE (not exported)
const ACCEPT_RE = /\.accept$/;

/** Pure: lint one parsed dialogue def -> [{rule, where, msg}]. */
export function lintDialogue(def, file = '?') {
  const hits = [], add = (rule, where, msg) => hits.push({ rule, where: `${file}:${where}`, msg });
  const nodes = (def && def.nodes) || {}, ids = Object.keys(nodes);
  const flag = (v, where) => { if (typeof v === 'string' && !FLAG_RE.test(v)) add('FLAG', where, `flag ${JSON.stringify(v)} does not match ${FLAG_RE}`); };
  const starts = [];
  (def.entry || []).forEach((e, i) => {
    if (!e) return;
    if (!nodes[e.node]) add('GOTO', `entry[${i}]`, `entry node "${e.node}" does not exist`); else starts.push(e.node);
    flag(e.requires, `entry[${i}].requires`);
  });
  for (const id of ids) {
    const n = nodes[id] || {}, ch = Array.isArray(n.choices) ? n.choices : [];
    if (n.next !== undefined && !nodes[n.next]) add('GOTO', id, `next "${n.next}" does not exist`);
    flag(n.setFlag, `${id}.setFlag`);
    if (typeof n.setFlag === 'string' && ACCEPT_RE.test(n.setFlag)) add('OFFER', id, `accept flag "${n.setFlag}" on a node (must be a choice on an offer node)`);
    if (n.next === undefined && !ch.length && n.end !== true) add('DEAD', id, 'no next, no choices and no explicit "end": true');
    ch.forEach((c, i) => {
      const w = `${id}.choices[${i}]`;
      if (!c) return;
      if (!nodes[c.next]) add('GOTO', w, `next "${c.next}" does not exist`);
      flag(c.setFlag, `${w}.setFlag`);
      if (typeof c.text === 'string' && c.text.length > LINE_MAX) add('CHOICELEN', w, `${c.text.length} chars > ${LINE_MAX}`);
      if (typeof c.setFlag === 'string' && ACCEPT_RE.test(c.setFlag) && ch.length < 2) add('OFFER', w, `accept choice "${c.setFlag}" has no Exit sibling (offer node needs Accept + Exit)`);
    });
  }
  const seen = new Set(), stack = [...starts];
  while (stack.length) {
    const id = stack.pop(); if (seen.has(id) || !nodes[id]) continue; seen.add(id);
    const n = nodes[id]; if (n.next !== undefined) stack.push(n.next);
    for (const c of n.choices || []) if (c) stack.push(c.next);
  }
  for (const id of ids) if (!seen.has(id)) add('REACH', id, 'not reachable from any entry node');
  return hits;
}

/** Pure: inspect.json -> hits (line length cap; blank spacer lines are allowed). */
export function lintInspect(obj, file = 'inspect.json') {
  const hits = [];
  for (const [k, t] of Object.entries((obj && obj.texts) || {}))
    (t.lines || []).forEach((l, i) => { if (typeof l === 'string' && l.length > LINE_MAX) hits.push({ rule: 'CHOICELEN', where: `${file}:${k}.lines[${i}]`, msg: `${l.length} chars > ${LINE_MAX}` }); });
  return hits;
}

/** Lints every dialogue file under dir (+ inspect.json) -> hits. */
export function lintDialogueDir(dir) {
  const fs = { readFileSync, readdirSync, existsSync, statSync, writeFileSync };
  const hits = [];
  for (const [n, f] of loadDialogues(dir, fs).files) hits.push(...lintDialogue(f.obj, n));
  const ip = join(dir, 'inspect.json');
  if (existsSync(ip)) hits.push(...lintInspect(JSON.parse(readFileSync(ip, 'utf8'))));
  return hits;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const hits = lintDialogueDir(fileURLToPath(new URL('../content/dialogue', import.meta.url)));
  for (const h of hits) console.log(`${h.rule} ${h.where}: ${h.msg}`);
  console.log(`dialogue-lint: ${hits.length} hit(s)`);
}
