// engine/ui/dialogue.js - DIALOGUE-01a1 (docs/architecture.md 38.28 items 1-3, 8).
// Pure dialogue state machine: no text, clip names or world access beyond what the data carries.
// Imports nothing. Flags go through a game-supplied `{has(key), set(key)}` adapter.
// Zero allocation per step: nodes/choices are compiled to int indices at load, events pass strings.

export const DIALOGUE_LINE_MAX = 56;
export const DIALOGUE_CHOICE_MAX = 40;
const FLAG_RE = /^[a-z][a-zA-Z0-9_.]*$/;
const isStr = (v) => typeof v === 'string';
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const asciiOk = (s) => { for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (c < 32 || c > 126) return false; } return true; };

/**
 * Checks a dialogue definition (the file object, envelope keys optional).
 * Errors refuse the file at load; warnings (unreachable nodes) never do.
 * @returns {{errors: string[], warnings: string[]}}
 */
export function validateDialogue(def) {
  const errors = [], warnings = [];
  const err = (m) => errors.push(m);
  if (!isObj(def)) return { errors: ['dialogue is not an object'], warnings };
  const speakers = isObj(def.speakers) ? def.speakers : null;
  if (!speakers) err('speakers: expected an object {key: {label, player?}}');
  else for (const k of Object.keys(speakers)) {
    const s = speakers[k];
    if (!isObj(s) || !isStr(s.label) || !s.label) err(`speakers.${k}: needs a non-empty label`);
    else if (s.player !== undefined && typeof s.player !== 'boolean') err(`speakers.${k}.player: expected boolean`);
  }
  const nodes = isObj(def.nodes) ? def.nodes : null;
  if (!nodes || !Object.keys(nodes).length) err('nodes: expected a non-empty object');
  const flagKey = (v, path) => { if (!isStr(v) || !FLAG_RE.test(v)) err(`${path}: bad flag key ${JSON.stringify(v)} (must match ${FLAG_RE})`); };
  const targetOk = (t, path) => { if (!isStr(t) || !nodes || !has(nodes, t)) err(`${path}: points to missing node ${JSON.stringify(t)}`); };

  if (!Array.isArray(def.entry) || def.entry.length === 0) err('entry: no entry (expected a non-empty array)');
  else {
    def.entry.forEach((e, i) => {
      if (!isObj(e)) { err(`entry[${i}]: expected an object`); return; }
      targetOk(e.node, `entry[${i}].node`);
      if (e.requires !== undefined) flagKey(e.requires, `entry[${i}].requires`);
    });
    const last = def.entry[def.entry.length - 1];
    if (isObj(last) && last.requires !== undefined) err('entry: the last entry has a requires (needs an unconditional fallback)');
  }

  if (nodes) for (const id of Object.keys(nodes)) {
    const n = nodes[id], p = `nodes.${id}`;
    if (!isObj(n)) { err(`${p}: expected an object`); continue; }
    if (!isStr(n.speaker) || !speakers || !has(speakers, n.speaker)) err(`${p}.speaker: unknown speaker ${JSON.stringify(n.speaker)}`);
    if (!Array.isArray(n.lines) || n.lines.length === 0) err(`${p}.lines: expected a non-empty array`);
    else n.lines.forEach((l, i) => {
      if (!isStr(l) || !l) err(`${p}.lines[${i}]: expected a non-empty string`);
      else {
        if (l.length > DIALOGUE_LINE_MAX) err(`${p}.lines[${i}]: ${l.length} chars, max ${DIALOGUE_LINE_MAX}`);
        if (!asciiOk(l)) err(`${p}.lines[${i}]: char outside ASCII 32-126`);
      }
    });
    const hasNext = n.next !== undefined, hasCh = n.choices !== undefined, hasEnd = n.end !== undefined;
    if ((hasNext ? 1 : 0) + (hasCh ? 1 : 0) + (hasEnd ? 1 : 0) !== 1) err(`${p}: needs exactly one of next / choices / end`);
    if (hasNext) targetOk(n.next, `${p}.next`);
    if (hasEnd && n.end !== true) err(`${p}.end: must be true`);
    if (hasCh) {
      if (!Array.isArray(n.choices) || n.choices.length < 2 || n.choices.length > 3) err(`${p}.choices: expected 2..3 choices`);
      else n.choices.forEach((c, i) => {
        const cp = `${p}.choices[${i}]`;
        if (!isObj(c)) { err(`${cp}: expected an object`); return; }
        if (!isStr(c.text) || !c.text) err(`${cp}.text: expected a non-empty string`);
        else {
          if (c.text.length > DIALOGUE_CHOICE_MAX) err(`${cp}.text: ${c.text.length} chars, max ${DIALOGUE_CHOICE_MAX}`);
          if (!asciiOk(c.text)) err(`${cp}.text: char outside ASCII 32-126`);
        }
        targetOk(c.next, `${cp}.next`);
        if (c.setFlag !== undefined) flagKey(c.setFlag, `${cp}.setFlag`);
      });
    }
    if (n.setFlag !== undefined) flagKey(n.setFlag, `${p}.setFlag`);
    if (n.clip !== undefined && (!isStr(n.clip) || !n.clip)) err(`${p}.clip: expected a non-empty string`);
  }

  // unreachable nodes: warning only
  if (nodes && Array.isArray(def.entry)) {
    const seen = new Set(), stack = [];
    const visit = (t) => { if (isStr(t) && has(nodes, t) && !seen.has(t)) { seen.add(t); stack.push(t); } };
    for (const e of def.entry) if (isObj(e)) visit(e.node);
    while (stack.length) {
      const n = nodes[stack.pop()];
      if (!isObj(n)) continue;
      visit(n.next);
      if (Array.isArray(n.choices)) for (const c of n.choices) if (isObj(c)) visit(c.next);
    }
    for (const id of Object.keys(nodes)) if (!seen.has(id)) warnings.push(`nodes.${id}: unreachable`);
  }
  return { errors, warnings };
}

const NEXT = 0, CHOICES = 1, END = 2;

/**
 * Compiles a VALID definition into a frozen structure with node ids mapped to ints (throws on errors).
 * compiled = {id, speakers:[{key,label,player}], entry:[{requires|null, node}], nodes:[{id, speaker, lines, kind,
 *   next, choices:[{text,next,setFlag|null}], setFlag|null, clip|null}]}
 */
export function compileDialogue(def) {
  const { errors } = validateDialogue(def);
  if (errors.length) throw new Error('invalid dialogue: ' + errors.join('; '));
  const ids = Object.keys(def.nodes), idx = new Map(ids.map((k, i) => [k, i]));
  const skeys = Object.keys(def.speakers), sidx = new Map(skeys.map((k, i) => [k, i]));
  const nodes = ids.map((id) => {
    const n = def.nodes[id];
    const kind = n.choices ? CHOICES : n.end ? END : NEXT;
    return Object.freeze({
      id, speaker: sidx.get(n.speaker), lines: Object.freeze(n.lines.slice()), kind,
      next: kind === NEXT ? idx.get(n.next) : -1,
      choices: Object.freeze(kind === CHOICES ? n.choices.map((c) => Object.freeze({ text: c.text, next: idx.get(c.next), setFlag: c.setFlag || null })) : []),
      setFlag: n.setFlag || null, clip: n.clip || null,
    });
  });
  return Object.freeze({
    id: def.id || '',
    speakers: Object.freeze(skeys.map((key) => Object.freeze({ key, label: def.speakers[key].label, player: def.speakers[key].player === true }))),
    entry: Object.freeze(def.entry.map((e) => Object.freeze({ requires: e.requires || null, node: idx.get(e.node) }))),
    nodes: Object.freeze(nodes),
  });
}

/**
 * The runner. `state`: 'idle' | 'typing' | 'waiting' | 'choosing' | 'ended'.
 * `onEvent(name, arg)` names: 'open' (dialogue id), 'node' (node id), 'flag' (flag key), 'end' / 'close' (dialogue id).
 */
export function createDialogueRunner({ cps = 30, holdSec = 0.12, onEvent } = {}) {
  const stepSec = 1 / cps;
  let comp = null, flags = null, node = null, lineIdx = 0, budget = 0, hold = 0;
  const emit = (n, a) => { if (onEvent) onEvent(n, a); };

  function enter(ni) {
    node = comp.nodes[ni];
    const sp = comp.speakers[node.speaker];
    r.speakerKey = sp.key; r.speakerLabel = sp.label; r.isPlayer = sp.player;
    r.clip = node.clip;
    emit('node', node.id);
    if (node.setFlag !== null) { flags.set(node.setFlag); emit('flag', node.setFlag); }
    startLine(0);
  }

  function startLine(i) {
    lineIdx = i;
    r.line = node.lines[i];
    r.visibleChars = 0; budget = 0; hold = 0;
    r.choiceCount = 0; r.selected = 0;
    r.state = 'typing';
  }

  function lineDone() {
    if (lineIdx + 1 >= node.lines.length && node.kind === CHOICES) { r.state = 'choosing'; r.choiceCount = node.choices.length; r.selected = 0; }
    else r.state = 'waiting';
  }

  function finish(evt) {
    r.state = 'ended'; r.choiceCount = 0; r.clip = null;
    emit(evt, comp.id);
  }

  const r = {
    state: 'idle', speakerKey: '', speakerLabel: '', isPlayer: false, line: '', visibleChars: 0,
    choiceCount: 0, selected: 0, clip: null,
    choiceText(i) { return node && i >= 0 && i < node.choices.length ? node.choices[i].text : ''; },

    open(compiled, flagAdapter) {
      comp = compiled; flags = flagAdapter;
      emit('open', comp.id);
      let ni = comp.entry[comp.entry.length - 1].node;
      for (let i = 0; i < comp.entry.length; i++) {
        const e = comp.entry[i];
        if (e.requires === null || flags.has(e.requires)) { ni = e.node; break; }
      }
      enter(ni);
    },

    tick(dt) {
      if (r.state !== 'typing') return;
      budget += dt;
      const line = r.line;
      for (;;) {
        if (hold > 0) {
          if (budget < hold) { hold -= budget; budget = 0; return; }
          budget -= hold; hold = 0;
        }
        if (budget < stepSec) return;
        budget -= stepSec;
        const c = line.charCodeAt(r.visibleChars++);
        if (r.visibleChars >= line.length) { lineDone(); return; }
        if (c === 46 || c === 44 || c === 33 || c === 63) hold = holdSec; // . , ! ?
      }
    },

    /** Confirm: finish the typing line, else advance (next line / next node / end). */
    press() {
      if (r.state === 'typing') { r.visibleChars = r.line.length; lineDone(); return; }
      if (r.state !== 'waiting') return;
      if (lineIdx + 1 < node.lines.length) { startLine(lineIdx + 1); return; }
      if (node.kind === NEXT) enter(node.next);
      else finish('end'); // kind END
    },

    move(d) {
      if (r.state !== 'choosing') return;
      const n = r.choiceCount;
      r.selected = (((r.selected + d) % n) + n) % n;
    },

    choose() {
      if (r.state !== 'choosing') return;
      const c = node.choices[r.selected];
      if (c.setFlag !== null) { flags.set(c.setFlag); emit('flag', c.setFlag); }
      enter(c.next);
    },

    /** Esc / damage: leave now; flags of nodes not yet entered stay unset. */
    close() {
      if (r.state === 'idle' || r.state === 'ended') return;
      finish('close');
    },
  };
  return r;
}
