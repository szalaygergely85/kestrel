// tools/editor/quest/diff.js - ED-QUI-08. Field-level diff of the open quest (and its dialogue nodes) vs the text loaded at editor start. Pure: no DOM.
// questDiff(baseRaw, q, dm) -> [{ kind:'changed'|'added'|'removed'|'moved', label, old, new, card }]; empty = no changes.
import { questNodes, STAGE_LABEL } from './lines.js';

const show = (v) => (v === undefined ? '(none)' : typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const CARD_OF = { objectives: 'objectives', steps: 'objectives', reward: 'rewards', rewards: 'rewards', requires: 'prereq', lines: 'conversation', giver: 'spatial', returnText: 'spatial', turnIn: 'spatial' };
const stepName = (s, i) => 'Objective ' + (i + 1) + (s && s.text ? ' "' + s.text + '"' : '');

function walk(out, label, a, b, card) {
  if (same(a, b)) return;
  if (isObj(a) && isObj(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) walk(out, label + '.' + k, a[k], b[k], card);
  } else if (a === undefined) out.push({ kind: 'added', label, old: undefined, new: b, card });
  else if (b === undefined) out.push({ kind: 'removed', label, old: a, new: undefined, card });
  else out.push({ kind: 'changed', label, old: a, new: b, card });
}

function diffSteps(out, key, a = [], b = []) {
  const ja = a.map((x) => JSON.stringify(x)), jb = b.map((x) => JSON.stringify(x));
  if (a.length === b.length && ja.join() !== jb.join() && [...ja].sort().join() === [...jb].sort().join()) {
    out.push({ kind: 'moved', label: 'Objectives order', old: a.map((s, i) => i + 1 + ':' + (s.text || s.kind || '')).join(' | '), new: b.map((s) => ja.indexOf(JSON.stringify(s)) + 1 + ':' + (s.text || s.kind || '')).join(' | '), card: 'objectives' });
    return;
  }
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (i >= a.length) out.push({ kind: 'added', label: stepName(b[i], i), old: undefined, new: b[i], card: 'objectives' });
    else if (i >= b.length) out.push({ kind: 'removed', label: stepName(a[i], i), old: a[i], new: undefined, card: 'objectives' });
    else if (!same(a[i], b[i])) walk(out, stepName(a[i], i).replace(/ ".*$/, ''), a[i], b[i], 'objectives');
  }
}

function diffLines(out, baseLines, nowLines) {
  for (const k of new Set([...Object.keys(baseLines || {}), ...Object.keys(nowLines || {})])) {
    const was = (baseLines || {})[k] || [], now = (nowLines || {})[k] || [];
    for (let i = 0; i < Math.max(was.length, now.length); i++) if (was[i] !== now[i]) out.push(lineRow((STAGE_LABEL[k] || k) + ' line ' + (i + 1), was[i], now[i]));
  }
}
const lineRow = (label, o, n) => ({ kind: o === undefined ? 'added' : n === undefined ? 'removed' : 'changed', label, old: o, new: n, card: 'conversation' });

export function questDiff(baseRaw, q, dm) {
  const out = [], now = q.raw, base = baseRaw || {};
  for (const k of new Set([...Object.keys(base), ...Object.keys(now)])) {
    if (k === 'lines') continue;
    const card = CARD_OF[k] || null;
    if (k === 'objectives' || k === 'steps') diffSteps(out, k, base[k], now[k]);
    else walk(out, k, base[k], now[k], card);
  }
  diffLines(out, base.lines, now.lines);
  if (dm) for (const r of questNodes(dm, q.id)) {
    const f = dm.files.get(r.file), nowL = f.obj.nodes[r.node].lines || [], was = (f.orig.nodes[r.node] || {}).lines || [];
    for (let i = 0; i < Math.max(was.length, nowL.length); i++) if (was[i] !== nowL[i]) out.push(lineRow((STAGE_LABEL[r.stage] || r.stage) + ' ' + r.node + ' line ' + (i + 1), was[i], nowL[i]));
  }
  return out;
}

/** One plain line per change, for the clipboard (commit message / writer). */
export function diffText(rows) {
  if (!rows.length) return 'No changes\n';
  return rows.map((r) => r.kind === 'added' ? `${r.label}: added ${show(r.new)}` : r.kind === 'removed' ? `${r.label}: removed ${show(r.old)}` : `${r.label}: ${show(r.old)} -> ${show(r.new)}`).join('\n') + '\n';
}
