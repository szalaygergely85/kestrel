// QL-MAIN-04 QUEST-GRAPH-LINT: whole-graph lint over the expanded quest set (legacy files + packs).
// Pure core: lintQuestGraph({ quests:[{path,def}], itemIds:Set, dialogueIds:Set, entDlg:{entityId:dialogueId}, actorIds?:Set }) -> [{rule, quest, msg}]
// Rule ids (exact): QG-A-UNREACHABLE, QG-B-CYCLE, QG-C-MISSING-QUEST, QG-D-REWARD-ITEM, QG-E-DIALOGUE-MISSING.
// validate-content.mjs runs lintRealContent() and reports each hit as a content error.
export const RULES = ['QG-A-UNREACHABLE', 'QG-B-CYCLE', 'QG-C-MISSING-QUEST', 'QG-D-REWARD-ITEM', 'QG-E-DIALOGUE-MISSING'];

export function lintQuestGraph({ quests, itemIds, dialogueIds, entDlg = {}, actorIds = null }) {
  const hits = [];
  const hit = (rule, q, msg) => hits.push({ rule, quest: q.id, msg });
  const defs = quests.map((q) => q.def).filter(Boolean);
  const byId = new Map(defs.map((d) => [d.id, d]));
  const reqQuests = (d) => (d.requires || []).filter((r) => r && r.quest !== undefined).map((r) => r.quest);

  // (c) next / requires ids that do not exist
  for (const d of defs) {
    if (d.next != null && !byId.has(d.next)) hit('QG-C-MISSING-QUEST', d, `next "${d.next}" is no quest`);
    for (const r of reqQuests(d)) if (!byId.has(r)) hit('QG-C-MISSING-QUEST', d, `requires quest "${r}" is no quest`);
  }
  // (b) cycles over requires + next edges (edge A->B: B waits on A)
  const preds = new Map(defs.map((d) => [d.id, new Set(reqQuests(d).filter((r) => byId.has(r)))]));
  for (const d of defs) if (d.next != null && byId.has(d.next)) preds.get(d.next).add(d.id);
  const state = new Map(), reported = new Set();
  const visit = (id, stack) => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) { const cyc = stack.slice(stack.indexOf(id)); const key = [...cyc].sort().join(','); if (!reported.has(key)) { reported.add(key); hit('QG-B-CYCLE', byId.get(id), 'cycle: ' + [...cyc, id].join(' -> ')); } return; }
    state.set(id, 1);
    for (const p of preds.get(id)) visit(p, [...stack, id]);
    state.set(id, 2);
  };
  for (const d of defs) visit(d.id, []);
  // (a) unreachable: offered only by a giver (or a main start with no giver and no requires (m1)), or as the `next` of a reachable quest;
  // every required quest must itself be reachable.
  const nextTargets = new Set(defs.filter((d) => d.next != null).map((d) => d.next));
  const reach = new Set();
  for (let grew = true; grew;) {
    grew = false;
    for (const d of defs) {
      if (reach.has(d.id)) continue;
      const offered = !!d.giver || nextTargets.has(d.id) || (!d.giver && !(d.requires || []).length);
      if (offered && reqQuests(d).every((r) => reach.has(r) || !byId.has(r))) { reach.add(d.id); grew = true; }
    }
  }
  for (const d of defs) if (!reach.has(d.id)) hit('QG-A-UNREACHABLE', d, 'nothing offers this quest (no giver, not a next target, prerequisites unreachable)');
  // (d) reward items exist
  for (const d of defs) for (const r of (d.reward && d.reward.items) || []) if (!itemIds.has(r.id)) hit('QG-D-REWARD-ITEM', d, `reward item "${r.id}" not in item defs`);
  // (e) giver / hand-in character's dialogue (the node the quest talks through) must exist
  for (const d of defs) for (const key of ['npc', 'turnIn']) {
    const e = d.giver && d.giver[key]; if (e === undefined) continue;
    const dlg = entDlg[e];
    if (dlg !== undefined && !dialogueIds.has(dlg)) hit('QG-E-DIALOGUE-MISSING', d, `${key} "${e}" uses dialogue "${dlg}" which has no content/dialogue file`);
    if (actorIds && !actorIds.has(e) && dlg === undefined) hit('QG-E-DIALOGUE-MISSING', d, `${key} "${e}" has no world entity / dialogue`);
  }
  return hits;
}

/** Loads the real content (quests via validate-content loaders) and lints it. -> [{rule, quest, msg}] */
export async function lintRealContent({ quests, itemDefs }) {
  const { loadQuestE2eBundle } = await import('./quest-e2e-content.mjs');
  const b = await loadQuestE2eBundle({ itemDefs });
  return lintQuestGraph({ quests, itemIds: new Set(Object.keys(itemDefs)), dialogueIds: new Set(Object.keys(b.raws)), entDlg: b.entDlg });
}

if (process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) {
  const v = await import('./validate-content.mjs');
  const A = await v.loadDesignAssets(); const dir = new URL('../content/quests', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const qf = v.loadQuestFiles(dir); qf.quests.push(...(await v.loadPackQuests(dir, A?.items?.defs)).quests);
  const hits = await lintRealContent({ quests: qf.quests, itemDefs: A?.items?.defs || {} });
  for (const h of hits) console.log(`${h.rule} ${h.quest}: ${h.msg}`);
  console.log(`quest-graph-lint: ${hits.length} hit(s) over ${qf.quests.length} quests`); process.exitCode = hits.length ? 1 : 0;
}
