# Bug hunt 2026-10-15 - area 1: save/load, game state, quests, items (architect)

Scope: engine/world/serialize.js + migrateState, game/js/saveRelay.js, questRelay.js, questPickups.js, quest/save/saveState.js, quest/sim/{questBook,quest,questSaveV2,templates,inventory,equipment,quickbar,pickups,loot,chest,heartPieces,waystone,spawnDirector}.js, quest/errands.js, dialogueCtl.js, logic/{logicWire,propState}.js, life/goblinCamps.js.
Known/excluded: OB-xxx in docs/bugs.md, batch-review-2026-10-15-pca-A.md (saved-only structures, z-only content fix), pc-b-queue "PC-A review 2026-10-15 fixes".
Probes (Node, scratch dir only, nothing committed): `probe1_seq.mjs`, `probe2_abandon.mjs`, `probe3_legacy.mjs`, `probe4_propstate.mjs` - all boot the REAL content (m1 + index.json legacy files + ch12/ch3/ch3b packs expanded with design/items.js defs) through `createSaveRelay` / `collectSave` / `applySave`.

Time cap from the owner: 4 bugs probe-confirmed, 3 trace-confirmed, suspects listed at the end.

## CONFIRMED

### BH-S1 (major) - HUD-tracked quest flips after Continue: accept order (`seq`) is dropped by collectSave
Evidence (probe1_seq.mjs: preset sq.burl.walk accepted, then accept sq.burl.boars.n, save via saveRelay.save, Continue):
```
LIVE tracked = sq.burl.boars.n seq walk/boars.n = 3 4
saved v2 active entries: {"sq.burl.boars.n":{"a":1,"c":0},...,"sq.burl.walk":{"a":1,"c":0},...}   <- no "s"
AFTER LOAD tracked = sq.burl.walk HUD line = Walk with Burl to the Bend Waystone
```
Root cause: `game/js/saveRelay.js:126` passes `quest.book.toSave().quests` (v1 map, has `seq`, questBook.js:368) to `collectSave`; `saveState.js:120` rebuilds each entry as `{quest, accepted, handedIn}` (+given) and drops `seq`, so `toQuestSaveV2` (questSaveV2.js:25) never writes `a.s`. On load `createQuestBook` (questBook.js:75) numbers accepted quests in giverDefs ARRAY order, so `tracked()` (most recent seq) picks the last quest in pack order, not the last accepted (OB-087 / CH12-AC3B-01 regression; the unit tests pass a v2 object straight in and never go through the relay path).
Fix: `saveState.js:120` copy `seq` (`if (Number.isInteger(quests[id].seq) && quests[id].seq > 0) out[id].seq = quests[id].seq;`), same in the `applySave` loop (line 145) so a v1->book round trip keeps it. Owner: kestrel-4 (content+tools: game/js/quest/save) - one-line fix + test.

### BH-S2 (major) - abandon + re-accept of a kill(ids) errand: quest cannot complete live, completes by itself after Continue
Evidence (probe2_abandon.mjs, sq.burl.boars.n = kill ids boarN1..3 count 3, abandonable):
```
boarN1 killed: 1/3 status=active relay dead = [ 'boarN1' ]
abandon -> true 0/3 status=available
re-accept -> true LIVE: 0/3 status=active
after N2+N3 dead LIVE: 2/3 status=active (boarN1 is GONE for good: beastSim only revives on R / resetAll)
AFTER CONTINUE: 3/3 status=ready
```
Root cause: `questBook.js:243` `abandon` replaces the state with `createQuest(def, null)` (deadBeasts = []), but a dead authored beast never comes back (beastSim STATE_GONE, only `resetAll` on R; spawnDirector not wired). Live progress is stuck at 2/3 forever. On load, `questSaveV2.js:62-73` replays the global `game.deadBeasts` set into every listening quest, so the same save shows 3/3. Pack counts ARE re-applied on abandon (line 246); dead beasts are not.
Fix: in `abandon`, after the reset re-apply the dead facts the book already knows (keep a `dead` Set mirror like `packCounts`, replay `beast:died` for the quest's `when.ids`), or make abandon keep `deadBeasts`. Owner: kestrel-4.

### BH-S3 (minor) - legacy m1 save (no game.quests): boar kill count is seeded twice, "Boars in the Woods" READY with 3/5 boars dead
Evidence (probe3_legacy.mjs: v1 save at the boar fight, deadBeasts boar1-3, load -> save -> load):
```
after load 1: kill_boar=3 kk=undefined status=active
save true {"a":1,"c":0,"f":{"counts":{"kill_boar":3}}}
after load 2: kill_boar=5 kk=true status=ready (only 3 of 5 boars are dead)
```
Root cause: `migrateQuestSave` LEGACY path (questBook.js:398) seeds `counts.kill_boar` with `applyKindKill` but never sets `flags.kk`; the next save stores the counts without `kk`; `fromQuestSaveV2` (questSaveV2.js:76-86) sees no `kk` and seeds from the dead set AGAIN on top of the stored count (capped at 5).
Fix: set `q.flags.kk = true` in the legacy seeding at questBook.js:398 (and/or in fromQuestSaveV2 seed only `max(stored, hit)` instead of adding). Owner: kestrel-4.

### BH-S4 (major) - logic prop state: a cancelled deferred request survives in the save and fires after Continue (gate closes on its own)
Evidence (probe4_propstate.mjs: gate open, player standing in it, logic asks 'closed' (deferred), then asks 'open' (applied)):
```
request closed while player in gateway -> false pending 1 state {"prop.rook.gate.state.want":"closed"}
request open (same as current) -> true pending 0 saved state = {"prop.rook.gate.state.want":"closed","prop.rook.gate.state":"open"}
after Continue: pending 1
after first step: gate variant = closed state {"prop.rook.gate.state":"closed"}
```
Root cause: `game/js/logic/propState.js` `request()`: the two success branches delete `want[id]`/`wantIds` but never `world.state[propKey(id)+'.want']` (only `step()` deletes it). `reapply()` re-queues every `.state.want` key, so a stale key re-applies the old request after a load.
Fix: in `request()` both success paths `delete world.state[propKey(id) + '.want']`. Owner: kestrel-3 (engine sim/nav lane owns logic wiring) or kestrel-1 - one line + test.

### BH-S5 (major, trace) - a respawned goblin camp is killed again on Continue and can never be cleared or respawn afterwards
Trace: `saveRelay.js:65` adds every `beast:died` id to `dead` and only ever clears it in `onWorldLoaded` (line 97); nothing removes an id when the beast comes back. `life/goblinCamps.js:98-100`: a down camp respawns after `respawnDays` (`state[wKey]=false; setDown(c,false)` -> slots alive again). Save (camp up, goblins alive, `deadBeasts` still lists gobE1..4) -> Continue: `main.js:1604` `goblinWire.attach(beasts)` sees the camp NOT down (slots alive, `dead[c]=0`), then `main.js:1608` `saveRelay.applyDeadToBeasts(beasts)` sets gobE1..4 to STATE_GONE / hp 0 (saveRelay.js:111-117). Result: camp flagged up with no goblins; `beast:died` can never fire for them, so the camp is never cleared (`cKey`), never goes down, never respawns - permanently empty, and any quest/logic waiting on that camp is blocked. Same mechanism will hit every future respawn path (spawnDirector `onRespawn`, regional packs) as soon as they are wired.
Fix: prune `dead` when a beast respawns (emit `beast:respawned {id}` from `sim.setDown(slot,false)` / resetSlot and `dead.delete(id)` in the relay), or make `applyDeadToBeasts` skip slots whose camp/group owner already decided (camp not down). Owner: kestrel-1 (main.js order + saveRelay) with kestrel-3 (beastSim event).

### BH-S6 (minor, trace) - picking up an `acceptQuest` packet (sq.packet) emits `inventory:added` twice: toast says "+2 Cloth packet", and "+1" even when the pack was full
Trace: `questPickups.js:85-87` `book.accept('sq.packet')` -> `questBook.js:204` `packOps.add` -> `questPickups.js:41` `addItem` + `emit('inventory:added', {packet, 1})`; then `questPickups.js:91` emits `inventory:added {packet, 1}` again. `toastView.js:46` stacks same-id lines (`L.n += p.n`) -> "+2". When the pack is full: `packOps.add` returns 0, `leftover()` drops the packet on the ground + `inventory:full`, `e.given` stays empty (abandon will not take it back), and line 89-91 still removes the prop and toasts "+1 Cloth packet". Content: world_m1 `packet` prop (`acceptQuest: sq.packet`, deliver template -> giveOnAccept packet).
Fix: in the `acceptQuest` branch skip the second emit (the accept path already toasted) and keep the prop when `b.accept()` added nothing. Owner: kestrel-1 (game/js/questPickups.js).

### BH-S7 (minor, trace) - errands' "offer first, accept on the second touch" (OB-126) is lost after R / Load in the same page session
Trace: `errands.js:64-65` `offered` / `looked` Sets live for the page (createErrands is called once, `main.js:1293`); `load(w)` (line 107) resets `relayEnt` only. After a restart or Continue, a relay whose errand was offered in the previous world is in `offered`, so `onEvent` (line 134) skips the offer and `inspected()` -> `book.inspect` ACCEPTS the errand on the first touch (journal entry unasked); `looked` likewise shows the `again` text variant on the first look.
Fix: `offered.clear(); looked.clear();` in `load(w)`. Owner: kestrel-1.

## Suspects (not confirmed within the time cap)
- `game/js/quest/beacon.js:154` stores a light `handle` object in `world.state['tower.beacon.lightHandle']`; `saveState.canonical()` throws for non-plain objects ("expected finite JSON data") -> if the handle is a class instance, every save fails silently while the beacon light is lit (check `lightSet.add` return type).
- `questBook.handIn` sets `book.lastReward` BEFORE `book.feed(quest.<id>.done)`; a dependent giverless (`auto`) quest that completes on that flag overwrites `lastReward` with NO_REWARD before `quest:done` reaches `grantReward` (main.js:1732) -> hand-in reward lost. No giverless pack quest exists today (latent).
- `applySave` v1-map path (saveState.js:144) throws `unknown giver quest` for a removed quest id (the v2 path only warns) - old v1 saves would fail Continue if a quest id is ever removed; none removed so far (git history checked).
- Waystone touch saves twice per touch (`requestSave` from the sim + saveRelay.stepGame's first-`waystone`-area save) - harmless, perf only.
- spawnDirector (not wired yet): `D.load` rebuilds `diedAt` with the CURRENT `D.mult`; if `setDifficulty` runs after `load` the due time shifts; partially dead groups are not saved (`alive` count resets), so a group with 2/3 dead never respawns after Continue once wired (same family as BH-S5).
