// M4-C2 pure helpers for tools/verify-ch12-run.mjs (Node-tested in verify-ch12-run.test.mjs): guidance-gap table (AC4),
// save compare (AC3, same rules as tools/verify-m4-exit.mjs), report writer (AC5).

export const SAMPLE_EVERY_S = 5, GAP_MIN_S = 30;

/** AC4. samples: [{t (s), x, y, hour, tracked, compass, giver, event}] taken every SAMPLE_EVERY_S. A "blind" sample has no tracked HUD
 *  objective, no compass target and no ! / ? giver in view. One row per run of blind samples whose stretch is longer than GAP_MIN_S. */
export const lineOf = (event) => (/^(E\d|E\+)/.test(String(event || '')) ? 'errand' : 'main'); // run.mjs names errand beats 'E1 ..'..'E6 ..' and the generic pass 'E+ <id>'; everything else is the main line

export function buildGapTable(samples, { every = SAMPLE_EVERY_S, minS = GAP_MIN_S } = {}) {
  const rows = []; let run = [];
  const flush = () => {
    if (run.length) {
      const len = run[run.length - 1].t - run[0].t + every;
      if (len > minS) rows.push({ x: run[0].x, y: run[0].y, t: run[0].t, hour: run[0].hour, lenS: len, lastEvent: run[0].event || '(none)', line: lineOf(run[0].event) });
    }
    run = [];
  };
  // a run also ends where the line changes (main -> errand) so errand gaps are never merged into main-line gaps; samples may carry their own `line`
  for (const s of samples) { if (!s.tracked && !s.compass && !s.giver) { if (run.length && (run[0].line || lineOf(run[0].event)) !== (s.line || lineOf(s.event))) flush(); run.push(s); } else flush(); }
  flush();
  return rows;
}

const canon = (v) => (v && typeof v === 'object') ? (Array.isArray(v) ? v.map(canon) : Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]))) : v;
const near = (a, b, e) => Math.abs(a - b) <= e;

/** AC3. before/after: any two snapshots of the same shape (verify-m4-exit SNAP or this run's snap()): `pos` within 0.05, `state` per key
 *  (clock.hour within 0.1), every other top-level key canonical-equal (key order is not part of the snapshot). [] = identical. */
export function compareSnaps(before, after) {
  const diffs = [];
  const eq = (name, a, b) => { if (JSON.stringify(canon(a)) !== JSON.stringify(canon(b))) diffs.push({ name, before: a, after: b }); };
  if (!before.pos.every((v, i) => near(v, after.pos[i], 0.05))) diffs.push({ name: 'pos', before: before.pos, after: after.pos });
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) if (k !== 'pos' && k !== 'state') eq(k, before[k], after[k]);
  const sb = before.state || {}, sa = after.state || {};
  for (const k of new Set([...Object.keys(sb), ...Object.keys(sa)])) {
    if (k === 'clock.hour') { if (!(typeof sa[k] === 'number' && near(sb[k], sa[k], 0.1))) diffs.push({ name: 'state.' + k, before: sb[k], after: sa[k] }); } else eq('state.' + k, sb[k], sa[k]);
  }
  return diffs;
}

/** AC1 verdict from the in-page quest table: [{id, status ('done'|...), lastObjective, forced?}]. */
export function questVerdict(quests) {
  const open = quests.filter((q) => q.status !== 'done');
  return { ok: open.length === 0, open };
}

const cell = (s) => String(s).replace(/\|/g, '/').replace(/\n/g, ' ');
const f1 = (n) => (Math.round(n * 10) / 10).toString();

/** AC5. r: { date, quests, beats:[{id,t,still}], forced:[], gaps, ac:{ac1,ac2,ac3}, diffs, equipment, notes:[] } -> markdown. */
export function renderReport(r) {
  const L = [];
  const pf = (b) => (b ? 'PASS' : 'FAIL');
  L.push('# M4-C2 scripted fresh-player Ch1-2 run', '', `Date: ${r.date}. Tool: \`node tools/verify-ch12-run.mjs <port>\`.`, '');
  L.push('| AC | Result |', '|---|---|');
  L.push(`| AC1 all Ch1-2 beats + errands done | ${pf(r.ac.ac1)} |`, `| AC2 gear equipped + shown | ${pf(r.ac.ac2)} |`, `| AC3 save / Continue byte-stable | ${pf(r.ac.ac3)} |`, `| AC4 guidance gaps (> ${GAP_MIN_S} s blind) | ${r.gaps.length} rows |`, '');
  L.push('## Quests (AC1)', '', '| Quest | Status | Last objective | Forced step |', '|---|---|---|---|');
  for (const q of r.quests) L.push(`| ${cell(q.id)} | ${cell(q.status)} | ${cell(q.lastObjective || '-')} | ${cell((q.forced || []).join(', ') || '-')} |`);
  L.push('');
  if (r.forced && r.forced.length) { L.push('Steps the script had to feed by hand (the real interaction did not fire by itself; each is a candidate bug):', ''); for (const f of r.forced) L.push(`- ${cell(f)}`); L.push(''); }
  L.push('## Main beats (stills)', '', '| Beat | Game t (s) | Still |', '|---|---|---|');
  for (const b of r.beats) L.push(`| ${cell(b.id)} | ${f1(b.t)} | ${b.still ? `![${cell(b.id)}](${b.still})` : '-'} |`);
  L.push('', '## Gear (AC2)', '', '```', JSON.stringify(r.equipment || null), '```', '');
  L.push(`## Guidance-gap table (AC4)`, '', `Sampled every ${SAMPLE_EVERY_S} s; a row = a stretch longer than ${GAP_MIN_S} s with no tracked HUD objective, no compass target and no ! / ? giver within view range.`, '');
  if (r.gaps.length) { L.push('| Where (x,y) | Game time (s) | Hour | Length (s) | Last event | Line |', '|---|---|---|---|---|---|'); for (const g of r.gaps) L.push(`| ${f1(g.x)}, ${f1(g.y)} | ${f1(g.t)} | ${f1(g.hour)} | ${f1(g.lenS)} | ${cell(g.lastEvent)} | ${g.line || 'main'} |`); } else L.push('No gaps.');
  L.push('', '## Save compare (AC3)', '');
  L.push(r.diffs.length ? '```\n' + JSON.stringify(r.diffs, null, 1).slice(0, 3000) + '\n```' : 'Identical after Continue.');
  if (r.notes && r.notes.length) { L.push('', '## Notes', ''); for (const n of r.notes) L.push(`- ${cell(n)}`); }
  return L.join('\n') + '\n';
}

// ---- M4-C2b generic errand pass: order + template -> action plan (pure; the page-side doing lives in verify-ch12-run.mjs) ----

/** quest ids a quest waits for (requires[].quest done, opensAfter); step-gates ({quest,step}) need no ordering (they open by themselves in the main line) */
export const depsOf = (q) => [...(q.requires || []).filter((r) => r.quest && r.done).map((r) => r.quest), ...(q.opensAfter || [])];

/** stable topological order (Kahn, input order breaks ties) so chains unlock: a quest comes after every dependency that is in the list. Cycles keep input order. */
export function orderErrands(quests) {
  const ids = new Set(quests.map((q) => q.id)), left = quests.slice(), out = [], placed = new Set();
  while (left.length) {
    const i = left.findIndex((q) => depsOf(q).every((d) => !ids.has(d) || placed.has(d)));
    const [q] = left.splice(i < 0 ? 0 : i, 1); out.push(q); placed.add(q.id);
  }
  return out;
}

/** regex sources for the world pickup interactable keys ('qp.berry3', 'qi.post') an item / collect id may lie around as: full id, first and last dotted segment */
export function pickupPatterns(item) { const seg = String(item).split('.'); return [...new Set([String(item), seg[0], seg[seg.length - 1]])].map((x) => '^q[pi]\\.' + x.replace(/[^a-z0-9]/gi, '\\$&')); }

/** one action per objective: {kind: explore|kill|collect|fetch|deliver|talk|escort|hit|flag|unknown, ...}. areas: areas.json "areas" map (area id -> {trigger}) */
export function stepsOf(q, areas = {}) {
  const trig = (a) => (areas[a] && areas[a].trigger) || a;
  if (q.steps) return q.steps.map((s) => {
    const p = s.params || {};
    switch (s.template) {
      case 'explore': return { kind: 'explore', triggers: (p.areas || []).map(trig) };
      case 'kill': return { kind: 'kill', ids: p.ids || [], count: p.count || (p.ids || []).length };
      case 'collect': return { kind: 'collect', item: p.item || (p.ids || [])[0], count: p.count || 1 };
      case 'fetch': return { kind: 'fetch', item: p.item, count: p.count || 1 };
      case 'deliver': return { kind: 'deliver', item: p.item, count: p.count || 1, to: p.to };
      case 'talk': return { kind: 'talk', to: p.to };
      case 'escort': return { kind: 'escort', npc: p.npc, to: p.to };
      default: return { kind: 'unknown', why: 'template ' + s.template };
    }
  });
  return (q.objectives || []).map((o) => {
    const w = o.when || {}, m = /^(target\d+)\.hit$/.exec(w.id || '');
    if (w.type === 'area') return { kind: 'explore', triggers: [trig(w.id)] };
    if (w.type === 'flag' && m) return { kind: 'hit', target: m[1] };
    if (w.type === 'flag') { const f = /^lore\.(\w+)\.read$/.exec(w.id || ''); return { kind: 'flag', id: w.id, ix: f ? 'qi.' + f[1] : null }; }
    return { kind: 'unknown', why: 'objective ' + w.type };
  });
}

/** {id, site, turnSite, steps, equip} for the run loop. turnSite: last deliver -> its target, else turnIn, else the giver (null for site-less main quests). */
export function planQuest(q, areas) {
  const steps = stepsOf(q, areas), last = steps[steps.length - 1];
  return { id: q.id, site: q.site || null, turnSite: last && last.kind === 'deliver' ? last.to : (q.turnIn || q.site || null), steps, equip: q.requireEquipped || [] };
}
