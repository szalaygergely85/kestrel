// tools/editor/quest/validate.js - ED-QUI-07a. Card [06] VALIDATE: every static check that applies to ONE quest, pure (no DOM, no node:fs).
// Reuses lintQuest (R3/R5/R10/R12/R14/R15/R16), formatProblems (QF, D-106), conversationLint (CV), and a mirror of
// validate-content's lintQuestText (R19; the editor may not import that file: it pulls node:fs). Parity: validate.test.mjs.
// validateQuest(model, q, ctx, dm, extra?) -> { errors, warnings, items:[{rule, severity, text, target:{kind,id}}], ok }
//   target.kind: lintQuest kinds + 'card' (id = a CARDS id: scroll to that card). `extra` = optional (q, items) => items (the panel's reward lint).
import { lintQuest } from './lintQuest.js';
import { formatProblems } from './format.js';
import { conversationLint } from './conversation.js';
import { questNodes } from './lines.js';
import { fileText } from './model.js';

// ---- R19 mirror of validate-content.mjs lintQuestText (kept identical; the parity test runs both) ----
const R19_VISIBLE = new Set(['title', 'text', 'journal', 'returnText', 'objText', 'nextHint', 'hint', 'hintTitle', 'prompt', 'accept', 'later', 'lines']);
const R19_OBJ_KEYS = new Set(['text', 'objText', 'journal', 'returnText']);
export const R19_OBJ_MAX = 38, R19_TALK_MAX = 56;
export function lintQuestText(files) {
  const out = [];
  for (const { path, json } of files) {
    const isDialogue = /(^|[\/])dialogue[\/]/.test(path);
    const walk = (v, where, key, visible) => {
      if (typeof v === 'string') {
        if (!visible || !v) return;
        const add = (kind, msg) => out.push({ file: path, where, kind, text: v, msg });
        if (/NEEDS WRITER/i.test(v)) add('writer', 'NEEDS WRITER');
        if (/\b(mq|sq|note|flag|item)\.[a-z]/i.test(v)) add('id', 'raw id in player text');
        if (/\besc\b/i.test(v)) add('esc', 'Esc hint');
        if (!isDialogue && R19_OBJ_KEYS.has(key) && v.length > R19_OBJ_MAX) add('objlen', `${v.length} chars > ${R19_OBJ_MAX}`);
        if (isDialogue && (key === 'text' || key === 'lines') && v.length > R19_TALK_MAX) add('talklen', `${v.length} chars > ${R19_TALK_MAX}`);
      } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${where}[${i}]`, key, visible));
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, where ? `${where}.${k}` : k, k, visible || R19_VISIBLE.has(k));
    };
    walk(json, '', '', false);
  }
  return out;
}

/** The R19 inputs of one quest: its own json + only ITS dialogue nodes (a dialogue file also holds other quests) + pack `lines` groups (checked as talk lines). */
export function r19Files(q, dm) {
  const files = [{ path: 'content/quests/' + q.file, json: q.raw }];
  if (q.raw && q.raw.lines && !Array.isArray(q.raw.lines)) files.push({ path: 'content/dialogue/' + q.id + '.lines', json: { nodes: Object.fromEntries(Object.entries(q.raw.lines).map(([k, v]) => [k, { lines: v }])) } });
  if (dm) {
    const by = new Map();
    for (const r of questNodes(dm, q.id)) { if (!by.has(r.file)) by.set(r.file, {}); by.get(r.file)[r.node] = dm.files.get(r.file).obj.nodes[r.node]; }
    for (const [name, nodes] of by) files.push({ path: 'content/dialogue/' + name, json: { nodes } });
  }
  return files;
}

// formatProblems string -> [plain text, target kind, target id]
function plainFormat(p) {
  let m;
  if (/^no begin/.test(p)) return ['This quest has no giver. Pick a character or object that starts it.', 'giver', 'giver'];
  if (/^no end/.test(p)) return ['This quest has no hand-in character.', 'return', 'return'];
  if (/^empty rewards/.test(p)) return ['The quest rewards nothing. Add at least one reward.', 'card', 'rewards'];
  if (/^no objectives/.test(p)) return ['The quest has no objectives.', 'card', 'objectives'];
  if ((m = /^(\d+) objectives/.exec(p))) return [`The quest has ${m[1]} objectives; the maximum is 3.`, 'card', 'objectives'];
  if (/^xp field/.test(p)) return ['The quest has an xp field. This game has no XP (D-020): remove it.', 'card', 'rewards'];
  if ((m = /^next "(.*)" is not/.exec(p))) return [`The next quest "${m[1]}" does not exist.`, 'card', 'rewards'];
  return [p.charAt(0).toUpperCase() + p.slice(1) + '.', 'card', 'prereq'];
}

export function validateQuest(model, q, ctx = {}, dm = null, extra = null) {
  let items = lintQuest(model, q.id, ctx);
  if (dm) items.push(...conversationLint(dm, q, ctx.names).map((m) => ({ ...m, target: { kind: 'card', id: 'conversation' } })));
  const push = (rule, severity, text, kind, id) => items.push({ rule, severity, text, target: { kind, id } });
  const noGiver = items.some((x) => x.rule === 'R14' && x.target.kind === 'giver' && x.target.id === null);
  for (const p of formatProblems(q.raw, new Set(model.quests.map((x) => x.id)))) {
    if (/^requires unknown quest/.test(p)) continue;        // lintQuest R15 says it already
    if (/^no begin/.test(p) && noGiver) continue;           // lintQuest R14 says it already
    const [text, kind, id] = plainFormat(p); push('QF', 'error', text, kind, id);
  }
  for (const h of lintQuestText(r19Files(q, dm))) {
    const dialogue = /dialogue[\/]/.test(h.file);
    if (h.kind === 'id' && !dialogue && /\b(?:sq|mq|heart)\./.test(h.text)) continue;   // lintQuest R3 reports these
    const what = { writer: 'is marked NEEDS WRITER', id: 'shows an internal id', esc: 'has an "Esc" hint' }[h.kind] || `is too long (${h.msg})`;
    const m = /^objectives\[(\d+)\]/.exec(h.where), o = m && q.objectives[Number(m[1])];
    const tail = h.text.length > 40 ? h.text.slice(0, 40) + '...' : h.text;
    push('R19', h.kind === 'objlen' ? 'warn' : 'error', `Text "${tail}" ${what}.`, dialogue ? 'card' : o ? 'objective' : 'field', dialogue ? 'conversation' : o ? o.id : (h.where.split(/[.\[]/)[0] || 'title'));
  }
  if (extra) items = extra(q, items);
  const errors = items.filter((x) => x.severity === 'error').length;
  return { errors, warnings: items.length - errors, items, ok: errors === 0 };
}

/** Footer data: file path, byte size of the would-be saved file text, verdict. */
export function validateFooter(model, q, res) {
  const f = model.files && model.files.get(q.file);
  let bytes = 0; try { bytes = f ? new TextEncoder().encode(fileText(f)).length : 0; } catch { bytes = 0; }
  const n = (k, w) => `${k} ${k === 1 ? w : w + 's'}`;
  const verdict = res.errors ? `${n(res.errors, 'error')}, ${n(res.warnings, 'warning')}` : res.warnings ? `OK, ${n(res.warnings, 'warning')}` : 'NO ERRORS';
  return { path: 'content/quests/' + q.file, bytes, verdict, kind: res.errors ? 'error' : res.warnings ? 'warn' : 'ok' };
}
