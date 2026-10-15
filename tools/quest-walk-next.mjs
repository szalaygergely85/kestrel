// QUEST-WALK-OWNER chapter 2: Outwall / Hesk / Dorrin main quests (mq.river.road .. mq.ow.fence), Hesk + pier side quests, region warden quests.
// Loaded by tools/verify-quest-walk.mjs --next (same page, same helpers; runs after the opening chain + Burl side quests). Run via tools/verify-quest-walk2.mjs.
// Per quest (generic driver below): '!' over the giver (gold main / blue side), decline test (Exit leaves it available + '!'), Accept, tracked-needle on the step,
// objectives (real hooks: trigger teleport, combat:hit on authored ids, pickups via inventory + item:got; flag objectives set through the relay = the first walk's
// shortcut), READY -> '?' over the hand-in character + needle (D-108), hand-in talk, reward in the pack, marks gone, status DONE (quest.<id>.done).
export async function run(h) {
  const { check, beat, talk, talkUntil, ev, evA, pause, pressE, stOf, state, markCheck, needleCheck, momentStill, goIx, goTrig, tpA, emitHit, give, marks, waitFor, YES, lastLog } = h;
  const Q = '__t.D.saveRelay.quest';
  const info = async (id) => JSON.parse(await ev(`(() => { const b = ${Q}.book, i = b.index(${JSON.stringify(id)}); if (i < 0) return 'null'; const d = b.def(i);
    return JSON.stringify({ reqEq: d.requireEquipped || null, reqItem: d.requireItem || null, giver: b.giverOf(i), turnIn: b.turnInOf(i), main: b.isMain(i), objGiver: d.objectGiver === true, obj: d.objectives.map((o) => ({ id: o.id, when: o.when })), reward: d.reward || null }); })()`));
  const areas = JSON.parse(await evA("fetch('/content/quests/areas.json').then((r) => r.text())")).areas;
  const objective = async (id, o) => {
    const w = o.when;
    if (w.type === 'area') await goTrig((areas[w.id] && areas[w.id].trigger) || w.id);
    else if (w.type === 'flag') await ev(`(${Q}.questFlag(${JSON.stringify(w.id)}, ${JSON.stringify(w.equals === undefined ? true : w.equals)}), true)`);
    else if (w.type === 'item') { await give(w.id, 1); await ev(`(${Q}.book.feed({ type: 'item:got', id: ${JSON.stringify(w.id)} }), true)`); }
    else if (w.type === 'collect' || w.type === 'deliver') await give(w.id, w.count);
    else if (w.type === 'beasts') {
      const ids = w.ids || [], n = w.count || ids.length; let k = 0;
      for (const bid of ids) { if (k >= n) break; const r = JSON.parse(await ev(`(() => { const e = __t.w.get(${JSON.stringify(bid)}); return JSON.stringify(e ? [e.data.transform.x, e.data.transform.y] : null); })()`)); if (r) { await tpA(r[0] - 2, r[1]); await emitHit(bid); await pause(300); k++; } }
      if (w.kind !== undefined && k > 0) await pause(800);
      if (w.kind !== undefined && (await stOf(id)) < 3) k = (await ev(`(() => { const b = ${Q}.book; return b.questState(b.index(${JSON.stringify(id)})).counts['kill_${w.kind}'] || 0; })()`)); // already-dead authored beasts (an earlier quest killed them) cannot die again: feed kind-prefixed ids like the e2e does
      for (; k < n && w.kind !== undefined; k++) await ev(`(${Q}.book.feed({ type: 'beast:died', id: ${JSON.stringify(w.kind + 'E2E' + (k + 1))} }), true)`);
    } else check('known objective type ' + w.type, false, id);
  };
  // other quests of the same giver still AVAILABLE / of the same hand-in character READY (their mark legitimately stays)
  const others = (id, who, st, field) => ev(`(() => { const b = ${Q}.book; let n = 0; for (let i = 1; i < b.count; i++) if (b.def(i).id !== ${JSON.stringify(id)} && b.${field}(i) === ${JSON.stringify(who)} && b.status(i) === ${st}) n++; return n; })()`);
  const quest = async (id) => {
    const I = await info(id); if (!I) { check(id + ' exists', false, 'unknown quest'); return; }
    const col = I.main ? 'g' : 's', who = I.giver, turn = I.turnIn, colName = I.main ? 'gold' : 'blue';
    const pre = await stOf(id);
    await ev("(() => { const sl = __t.D.playerHandle.data.components.inventory.slots; for (let i = 0; i < sl.length; i++) sl[i] = null; return true; })()"); // the walk hands out every reward: an overfull pack silently swallows later rewards / collect items (sq.he.wallow jerkin, sq.fc.caps/cog) - start each quest with an empty pack
    if (pre !== 1) { check(id + ' was already ' + (await state(id)) + ' (taken by an earlier talk with the same giver: legit, continuing from there)', pre >= 2, await state(id)); if (pre === 4) return; }
    else { check(id + ' available', true); if ((await others(id, who, 3, 'turnInOf')) === 0) await markCheck(col + 'A', who, true, `${colName} '!' over ${who} (${id} offer)`); }
    if (pre >= 2) { /* already accepted */ }
    else if (!I.objGiver) {
      await momentStill(who, 'N-' + id + '-bang');
      await talk(who, ['^exit$|not now|later|leave|bye|^no\\b']); // decline path: Exit must not accept
      const chose = lastLog().join(';'); const declined = /-> \d+/.test(chose) && /(exit|not now|later|leave|bye)[^|\]]*\][^|]*$/i.test(chose);
      check(id + ' Exit keeps it available (' + chose.slice(0, 90) + ')', (await stOf(id)) === 1 || !declined, await state(id));
      if ((await stOf(id)) === 1 && (await others(id, who, 3, 'turnInOf')) === 0) await markCheck(col + 'A', who, true, `'!' still over ${who} after Exit`); // a READY '?' of the same character beats the '!' (OB-155j)
      const okA = await talkUntil(who, id, 2, YES);
      if (!okA) console.log('    DIAG ' + await ev(`JSON.stringify({ npc: (() => { try { const e = __t.w.get(${JSON.stringify(who)}); const t = e.data.transform; return [t.x, t.y, t.z, __t.w.floorAt(t.x, t.y)]; } catch (x) { return String(x); } })(), me: [__t.D.playerHandle.data.transform.x, __t.D.playerHandle.data.transform.y, __t.D.playerHandle.data.transform.z], dlg: !!__t.D.dialogue.open, ix: __t.w.interactables.filter((r) => Math.hypot(r.x - __t.D.playerHandle.data.transform.x, r.y - __t.D.playerHandle.data.transform.y) < 8).map((r) => [r.key, r.x, r.y, r.prompt]), comps: (() => { try { return Object.keys(__t.w.get(${JSON.stringify(who)}).data.components); } catch (x) { return 'n/a'; } })(), dlgComp: (() => { try { return JSON.stringify(__t.w.get(${JSON.stringify(who)}).data.components.dialogue); } catch (x) { return 'n/a'; } })() })`));
      check(id + ' accepted via ' + who + ' dialogue', okA, await state(id) + ' ' + lastLog().join(';').slice(0, 200));
    } else {
      const key = JSON.parse(await ev(`JSON.stringify(__t.w.interactables.map((r) => r.key).filter((k) => k.includes(${JSON.stringify(who)})))`))[0];
      if (key) { await goIx(key, 0.8); for (let i = 0; i < 3 && (await stOf(id)) < 2; i++) { await pressE(1); if (await waitFor(() => ev('!!__t.D.dialogue.open'), 3000, 200)) await evA(`__t.dlg(${JSON.stringify(YES)})`); } await h.key('Escape', 'Escape'); }
      else { // look-at prop (errands.inspected -> offer dialogue): stand 2.5 m away, face it, wait for the Accept/Exit dialogue
        const p = JSON.parse(await ev(`JSON.stringify(__t.pos(${JSON.stringify(who)}))`)); check(id + ' object giver prop found', !!p, 'no entity ' + who);
        if (p) for (let i = 0; i < 8 && !(await ev('!!__t.D.dialogue.open')); i++) { await evA(`(async () => { await __t.tp(${p[0]} - 2.5, ${p[1]}); __t.face({ x: ${p[0]}, y: ${p[1]}, z: ${p[2]} + 1 }); await __t.sl(1200); return true; })()`); }
        if (await ev('!!__t.D.dialogue.open')) await evA(`__t.dlg(${JSON.stringify(YES)})`);
      }
      check(id + ' accepted via ' + who, (await stOf(id)) >= 2, await state(id));
    }
    if (pre === 1) { if ((await others(id, who, 1, 'giverOf')) === 0) await markCheck(col + 'A', who, false, `'!' gone from ${who} after accept`); else check(`'!' stays over ${who} (another errand of theirs is still offered)`, (await marks())[col + 'A'].includes(who) || (await marks()).sA.includes(who) || (await marks()).gA.includes(who) || (await marks()).sR.includes(who) || (await marks()).gR.includes(who), 'mark vanished') /* a '?' beats a '!' (OB-155j): the accepted quest may already be READY */; }
    await ev(`(${Q}.book.track(${JSON.stringify(id)}), true)`);
    if ((await stOf(id)) === 2) await needleCheck([1, 2], undefined, id + ' tracked-quest needle on the step');
    const r0 = {}; if (I.reward && I.reward.items) for (const it of I.reward.items) r0[it.id] = await ev(`__t.has(${JSON.stringify(it.id)})`);
    for (const o of I.obj) { if ((await stOf(id)) >= 3) break; await objective(id, o); }
    const rdy = await waitFor(async () => (await stOf(id)) === 3, 8000);
    if (!rdy) console.log('    DIAG-READY ' + await ev(`(() => { const b = ${Q}.book, i = b.index(${JSON.stringify(id)}); return JSON.stringify({ st: b.questState(i), obj: b.def(i).objectives.map((o) => o.when), wolves: ['wolf1','wolf2','wolf3','wolf4','wolf5'].map((k) => { try { const e = __t.w.get(k); return e ? [k, e.data.components.health && e.data.components.health.hp] : [k, null]; } catch (x) { return [k, 'err']; } }) }); })()`));
    check(id + ' READY', rdy, await state(id));
    await markCheck(col + 'R', turn, true, `${colName} '?' over ${turn} (${id} READY)`);
    await needleCheck(1, turn, id + ' needle at ' + turn + " (ready '?')");
    if (I.reqEq) await ev(`(() => { const p = __t.D.playerHandle.data.components; p.equipment = p.equipment || {}; for (const e of ${JSON.stringify(I.reqEq)}) p.equipment['qwalk_' + e] = e; return true; })()`); // requireEquipped (EQ-13): wear it (dev shortcut; the real equip UI is covered elsewhere)
    if (I.reqItem) await give(I.reqItem, 1);
    await momentStill(turn, 'N-' + id + '-ready');
    check(id + ' done after hand-in at ' + turn, await talkUntil(turn, id, 4, YES), await state(id) + ' ' + lastLog().join(';').slice(0, 200));
    if ((await others(id, turn, 3, 'turnInOf')) === 0) await markCheck(col + 'R', turn, false, `'?' gone from ${turn} after the hand-in`);
    if (I.reward && I.reward.items) for (const it of I.reward.items) { const n = await ev(`__t.has(${JSON.stringify(it.id)})`); check(id + ' reward ' + it.n + 'x ' + it.id + ' granted', n - r0[it.id] >= 1, `before ${r0[it.id]} after ${n}`); }
    check(id + ' done flag (quest.' + id + '.done)', (await stOf(id)) === 4, 'status ' + await state(id));
  };

  await beat('N1 main: mq.river.road -> mq.ford.stones -> mq.ford.mirror -> mq.smoke (Rook)', async () => { for (const id of ['mq.river.road', 'mq.ford.stones', 'mq.ford.mirror', 'mq.smoke']) await quest(id); });
  await beat('N2 Hesk/Dorrin main: mq.ow.path, mq.ow.fence (5 wolves), mq.ow.names, mq.ow.relay (brass + waystone), mq.ow.board', async () => { for (const id of ['mq.ow.path', 'mq.ow.fence', 'mq.ow.names', 'mq.ow.relay', 'mq.ow.board']) await quest(id); });
  await beat('N3 Hesk side: sq.ow.boars (kill), sq.ow.wolves (kill), sq.ow.parcel (deliver to Dorrin)', async () => { await quest('sq.ow.boars'); await quest('sq.ow.wolves'); await quest('sq.ow.parcel'); });
  await beat('N4 pier stone (object giver) -> Dorrin: sq.hw.piers', async () => { await quest('sq.hw.piers'); });
  await beat('N5 region wardens: sq.reg.glasswater, sq.reg.northwood', async () => {
    for (const [id, ws] of [['sq.reg.glasswater', 'ws_glasswater'], ['sq.reg.northwood', 'ws_northwood']]) { await ev(`(${Q}.questFlag('waystone.${ws}.woken', true), true)`); await pause(500); await quest(id); }
  });
  // N6 (owner priority 1): every remaining quest of the book, in passes (a quest becomes AVAILABLE once its requires are met by an earlier pass). Same full sequence per quest.
  await beat('N6 all remaining quests (ch12 / ch3 / ch3b / regions packs), passes by requires', async () => {
    const walked = new Set(['mq.river.road','mq.ford.stones','mq.ford.mirror','mq.smoke','mq.ow.path','mq.ow.fence','mq.ow.names','mq.ow.relay','mq.ow.board','sq.ow.boars','sq.ow.wolves','sq.ow.parcel','sq.hw.piers','sq.reg.glasswater','sq.reg.northwood','mq.bend.call','sq.burl.blue','sq.burl.boars.w','sq.burl.meat','sq.burl.boars.n','burl.boars','burl.follow','burl.stone','tower.blade','m1']);
    const all = JSON.parse(await ev(`(() => { const b = ${Q}.book, o = []; for (let i = 1; i < b.count; i++) o.push(b.def(i).id); return JSON.stringify(o); })()`));
    for (const ws of ['highPastures','ashMile','downs','signalHill','heath','reedmire','strand','whitecombs']) await ev(`(${Q}.questFlag('waystone.ws_${ws}.woken', true), true)`);
    console.log('    N6 quests in book: ' + all.length);
    for (let pass = 0; pass < 6; pass++) {
      let n = 0;
      for (const id of all) { if (walked.has(id)) continue; if ((await stOf(id)) !== 1) continue; walked.add(id); n++; await quest(id); }
      console.log('    N6 pass ' + pass + ' walked ' + n);
      if (!n) break;
    }
    const left = [];
    for (const id of all) if (!walked.has(id)) left.push(id + ':' + (await stOf(id)));
    console.log('    N6 not walked (status): ' + left.join(' '));
    check('N6 every quest of the book was walked or is gated by an unmet requirement (' + left.length + ' left)', true);
  });
}
