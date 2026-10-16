// tools/editor/quest/conversation.js - ED-QUI-05. Card [04] view model: the quest's dialogue nodes in reading order
// (offer -> accept -> progress -> hand-in -> after) with lines, branches (read-only) and Accept / Exit checks. Pure (imports lines.js).
import { lineRows, STAGE_LABEL } from './lines.js';

const ORDER = ['Offer', 'Accept', 'Progress', 'Hand-in', 'After'];

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
      for (const c of def.choices || []) {
        const acc = isAccept(c, q.id);
        if (acc) n.accept = true; else n.exit = true;
        n.branches.push({ text: c.text || '', goto: c.next || '', gate: c.requires || '', sets: c.setFlag ? [c.setFlag] : [], accept: acc, dangling: !!c.next && !f.obj.nodes[c.next] });
      }
      if (def.next) n.branches.push({ text: '(continues)', goto: def.next, gate: '', sets: [], accept: false, dangling: !f.obj.nodes[def.next] });
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
