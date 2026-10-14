# Chapter I Alpha on Steam - release plan

Manager, 2026-10-14. Answers D-109 (Chapter I ends at the Outwall gate, about hidden level 10, released as a **paid alpha on Steam** to earn money and to ask players where the story goes next). This plan builds on D-012 (Electron + steamworks.js), D-044 (WebGPU only, Electron as the reference target), D-053 (no public demo, reopened by D-109 for this alpha only), D-085 (frame budget), D-103..D-108 (main chain split, hidden level, Outwall is the last main stretch).
Status: **proposal**. The main session records it as **D-110** once the owner answers section 8.

Steam's label for a paid alpha is **Early Access**. Working store name: "Kestrel - Chapter I (Early Access)". Final name: owner/writer.

---

## 1. Chapter I content-complete definition

Chapter I is content-complete when **every item below exists, has PO OK, and is covered by a Node test or a headless verify script**. Nothing past the gate is built. The Sealed Gate stays locked (D-065).

### 1.1 Main chain (docs/epics/main-quests-split.md, D-103/D-104/D-108)
| # | Quest | Giver -> turn-in | minLevel |
|---|---|---|---|
| 1 | mq.tower A Blade in the Ashes | tower note -> Burl | 1 |
| 2 | mq.boars Boars in the Woods | Burl | 1 |
| 3 | mq.stone The Old Stone | Burl | 1 |
| 4 | mq.road The Road West | Burl -> Rook (Bend) | 1 |
| 5 | mq.bend.call The Call Carries | Rook | 1 |
| 6 | mq.river.road The River Road | Rook -> Rook (east bank) | 1 |
| 7 | mq.ember Burl's Ember (fireball, spellbook D-099) | Burl | 5 |
| 8 | mq.ford.stones Stones in the Water | Burl -> Rook (west bank) | 5 |
| 9 | mq.ford.mirror The Missing Glass | Rook | 5 |
| 10 | mq.smoke Smoke in the North | Rook | 5 |
| 11 | Tobin step (D-108 item 1: Tobin is main, after Smoke) | PO writes the row | 6-7 |
| 12 | mq.ow.fence Wolves at the Fence | Rook -> Hesk | 8 |
| 13 | mq.ow.relay The Village Waystone | Hesk | 9 |
| 14 | mq.ow.board The Board of the Dead | Hesk | 10 |
| 15 | **Chapter end** at the Outwall gate (owner question 5) | Hesk | 10 |

Done means: the D-103 split and the save migration (section 2 of the split doc) are in, every NEEDS WRITER line is written, and a **quest bot** (`tools/verify-ch12-run.mjs` extended) plays 1 -> 15 on a fresh save with no stuck state.
**Pacing fix (required):** the split doc has `minLevel 5` on everything from mq.ember on, but D-108 puts Outwall at level ~10. The minLevels on quests 11-15 have to rise (proposal in the table), so the 5 -> 10 climb happens on the west bank through side quests and gear. The PO confirms the numbers with the PLAYER-LEVEL-01 formula and a gear-path simulation: "a player who does the main chain plus about 50 % of the side quests reaches hidden level 10 at quest 14".

### 1.2 Side quests per region
Rule: every region the main chain passes through has **at least 3 side quests** (a chain counts as its steps), **its waystone**, and **at least 1 earned point of interest** (camp, ruin or guarded chest; OB-141/OB-152 rule: chests are earned). Off-path regions (band <= 10) need at least 1 regional quest (`sq.reg.*`) and 1 POI, or they are cut from the Chapter I promise (they stay walkable under D-076 but the store page doesn't claim them).
- Near side (levels 1-5): Burl's home/tower (Burl hunt, stone, meat, farm chains + singles), Bend/roadWest (Rook bend + lamps chains), downs, strand, ashMile, northwood, reedmire (`sq.reg.*`), bees and straw chains.
- West bank (levels 5-10): ford post chains A + B, Rook ask chain, Outwall (wolves chain + 10 singles in ch3/ch3b), glasswater, highPastures, signalHill, heath, whitecombs (`sq.reg.*`).
- The ~70 side quests already in the split audit are enough by count. The job is **fix, place and pace**, not new quests: OB-136 (river side), OB-155 audit items, the D-108 item 2 exceptions (side quests that assume a main meeting require their main quest), the OB-135 plain names.
- **Content lint gate:** `node tools/content-lint.mjs` + validate-content are green; every quest's objectives are reachable (quest bot sweep over all side quests, not just the main chain).

### 1.3 Bestiary subset (levels 1-10, from docs/epics/ep-bestiary.md)
Cut to what exists or is a cheap variant. **No new (N) creature models except 2.**
- **In:** boar (1-3), fox (1-3), grey wolf (4-8), white wolf alpha (V, 8-10), black bear (5-9), goblin warrior / spear thrower / torch-bearer / chief (camps), goblin archer (V), carrion crows (3-4), snapping turtle (V tortoise), mountain goat (8-9), bandit cutthroat + archer (V human_kit). New models: **red deer** (plains life) and **river crocodile** (the river is the chapter's spine).
- **Bosses (3):** Great Boar (tower, lv2), Wolf Mother (northwood, lv5), Siege Chief (Outwall, lv6-10, can be the chapter finale fight if the owner wants one, question 5).
- **Systems needed:** BEAST-03b/04 (perception, tokens, tactics), BEAST-05 difficulty (Easy/Normal/Hard), BEAST-06a/b spawn director + respawn + caps, BEAST-14 boss framework. OB-150 combat pass ("too easy, AI stupid") is a release blocker.
- **Out (Chapter II+):** lynx, spiders, treant, harpy, troll, bats, skeletons, wisps, eels, crabs, cave bear, the other 13 bosses.

### 1.4 Items and loot
- Gear tiers up to the one that carries hidden level 10 (T3 per the mq.ow.fence reward; the ITEM rows confirm the exact top tier). Rarity, attributes and damage numbers per D-091.
- Loot tables only for the in-scope bestiary; earned chests per region; potions (HP/MP), arrows, the spellbook with Fireball (OB-169, D-099).
- No item in the pack is a placeholder name or a "Placeholder copy" description (OB-135).

### 1.5 End of chapter + story vote hook
- **End screen** after the last main hand-in: a short closing scene at the Outwall gate (writer text, chapter card style like `verify-chapter-card.mjs`), then "End of Chapter I", playtime, quests done, then **"What should happen next?"** with 3-4 story directions written by the writer (for example: follow the signal past the Sealed Gate / go back for the Low Wards / the exiles' feud / the Hush). One pick + optional "Tell us more" button.
- After the screen the player returns to the world (free roam, unfinished side quests stay playable). The save is flagged `chapter1.done`.
- Credits screen: team, "Voxel assets by StickyBizcuit", CC0 credits (optional but polite), Electron/Chromium notices link.

---

## 2. Alpha quality bar - measurable gates

"Playable from start to gate without blockers, looks right, saves never lost, frame budget on min spec." The alpha ships only when **all gates are green on the same build** (the release candidate, RC).

| # | Gate | Measure | Tool / owner |
|---|---|---|---|
| G1 | No blockers | Zero open OB rows with priority P0/P1 in docs/bugs.md; every open row triaged (P0-P3) by the PO. Today: 22 open rows; OB-164/166/168/170 are P0 candidates | PO triage, main session |
| G2 | Quest bot | Node quest sim plays main chain 1 -> 15 and every side quest to completion on a fresh save, 0 stuck states | `verify-ch12-run` extended, `content-lint`, validate-content |
| G3 | Route walk | Headless browser route walk new game -> Outwall gate, in the **Electron build**, 0 console errors, 0 fall-throughs, 0 stuck > 10 s | `tools/route-walk-browser.mjs` (Electron target) |
| G4 | Render parity | `?gpucompare=1` full PASS set (D-039) on the pinned Electron Chromium, on an idle machine (PC-B RTX 4060 baseline refreshed per D-039) | `gpucompare` skill |
| G5 | Frame budget | D-085: GPU p95 <= 8 ms on the RTX 4060 at every preset; <= 10 ms on the Intel iGPU laptop at "high"; min-spec machine holds 60 fps at its default preset on the 6 bench poses + the Outwall pose with 4 enemies engaged | `tools/bench-presets.mjs`, `bench-geo-perf.mjs` |
| G6 | Saves never lost | (a) region-save-sweep + verify-continue green; (b) 50 forced kills of the Electron process during autosave -> 0 corrupt or lost saves (atomic write + 3 rotating backups); (c) every save fixture from earlier alpha builds loads (pinned migration fixtures); (d) Steam Cloud round trip on 2 PCs | `region-save-sweep.test.mjs`, `verify-continue.mjs`, new `desktop` kill test |
| G7 | Suites | `node tools/run-tests.mjs` all green + `check-deps` clean | janitor |
| G8 | Owner walk-tests | 2 full owner runs start -> gate: one on the RTX desktop, one on the Intel laptop, on the Electron build; owner says "playable" and "looks right" | owner |
| G9 | Stranger test | 3 people who have not seen the game play from start without help; all reach at least mq.ow.fence; time-to-gate recorded (target >= 3 h, so the Steam 2-hour refund window is not the whole game) | owner's friends, PO notes |
| G10 | Licence | Section 5 checklist green: every shipped third-party file has a written commercial-redistribution basis | manager + owner |

Look rule (owner, "looks right"): no flicker (OB-110), fire looks like before OB-132b (OB-167), no floating props, no sprites where voxels are meant, no `?` or `!` in the wrong place (OB-156/OB-168).

---

## 3. Steam packaging for a no-build browser game

### 3.1 Wrapper options
| Option | WebGPU | Pinned engine | Steamworks | Size | Risk |
|---|---|---|---|---|---|
| **Electron** | Chromium WebGPU on by default on Windows (D3D12 via Dawn) | Yes: we pick the Electron (Chromium) version and baseline gpucompare on it | `steamworks.js` (Node addon, main process) | ~150-250 MB | Low; the most common Steam path for web games |
| NW.js | Same Chromium WebGPU | Yes | greenworks (older, less maintained) or own addon | similar | Medium: smaller community, Steamworks binding older |
| Tauri / WebView2 | Windows: WebView2 is evergreen Chromium, WebGPU yes; Linux/Deck: WebKitGTK, **no usable WebGPU** | **No**: WebView2 updates under us, gpucompare can drift after a Windows update | Rust bindings (second language) | ~10 MB | High for us |

**Recommendation: Electron** (already decided in D-012 and D-044; this plan confirms it for the alpha). Layout per D-012: `desktop/` folder (Electron `main.js` + `preload.js` + packaging config), loads the unchanged `game/` over a custom `app://` protocol; the game never knows it is in Electron. `electron-builder` is a packaging tool only; the game still has no build step.

### 3.2 WebGPU in the wrapper
- Pin one Electron major at the start of A2; re-baseline gpucompare on it; upgrade Electron only between alpha patches with a full G4/G5 re-run.
- Windows: WebGPU is on by default. Force the discrete GPU on dual-GPU laptops (`force_high_performance_gpu` switch + `powerPreference: 'high-performance'`), turn off background throttling.
- Chromium keeps a GPU/driver blocklist for WebGPU. A player on a blocklisted GPU gets the "WebGPU required" screen -> refund. Mitigation: the store page min spec is explicit; the screen tells the player to update the driver and links the Steam discussions FAQ.
- **Alpha = Windows only.** Linux/Steam Deck WebGPU in Chromium is not reliable enough to test with our gates; Deck/Linux comes with M6 (D-012) after a measured spike.

### 3.3 Save location
- Saves move from browser storage to files through the platform adapter (D-012): `%APPDATA%/Kestrel/saves/slot-N.json` (Electron `app.getPath('userData')`), written **atomically** (tmp file + rename) with **3 rotating backups**; the preload exposes only `saveRead/saveWrite/saveList`.
- First launch of the Steam build imports nothing (new players); the browser build keeps its current storage.
- **Steam Auto-Cloud** on the `saves/` folder (no code; configured in Steamworks). Settings file stays local (graphics preset is per machine).
- Logs: `userData/logs/` (last 5 sessions, errors + F3 line), with a "Open log folder" button on the pause menu for bug reports.

### 3.4 Steamworks basics
- **Steam Direct fee $100** per app (recouped after $1,000 gross). Owner pays it, then: company/personal tax + bank interview (non-US: W-8BEN; the Hungary-US treaty normally means 0 % US withholding), identity check.
- **Timing rules:** at least **30 days** between paying the fee and release; the store page must be visible as **Coming Soon for at least 2 weeks** before launch (aim for 4+ weeks for wishlists); store page review and build review each take a few business days.
- **App ID** + one **Windows depot** (game files); SteamPipe uploads with `steamcmd` + an `app_build.vdf` (a `tools/` script, PC-A). Branches: `default` (public) and `testing` (password, owner + testers get patches first).
- **Overlay:** works in Electron when the window renders through the GPU process; check Shift+Tab on the RC (known Electron overlay quirks; fall back to `steamworks.js` overlay hooks if needed).
- **Achievements: optional**, about 8 (finish Chapter I, each boss, all waystones, first fireball). They cost a day; nice for visibility.
- **Story vote via Steam Stats** (section 6): one stat per vote option; no own server.
- No DRM wrapper needed (Steam DRM is optional and does not protect JS).

### 3.5 Min spec (draft; measured in A3 with G5)
- **Minimum:** Windows 10/11 64-bit, 4-core CPU ~2.5 GHz, 8 GB RAM, DirectX 12 GPU with WebGPU support: Intel Iris Xe / AMD Radeon 680M / NVIDIA GTX 1050 class, "medium" preset at 1080p window.
- **Recommended:** 6-core CPU, 16 GB RAM, GTX 1660 / RTX 2060 or better, "high"; "ultra" = RTX class only (D-075).
- Disk: measure the package (Electron + content); estimate 1 GB.

---

## 4. Store and business

### 4.1 Store page assets (Steam sizes)
- Header capsule 920x430, small capsule 462x174, main capsule 1232x706, vertical capsule 748x896, library capsule 600x900, library hero 3840x1240, library logo 1280x720 (transparent). Optional page background.
- **At least 5 screenshots** at 1920x1080 (aim 8): tower fire, forest, river/ford, Outwall at dusk, combat with a wolf pack, a boss, the map, the journal. Captured in-engine at a large grid (US-119 trailer tool / capture-cinematic).
- **Trailer** 60-90 s, gameplay first (first 5 s must show the ASCII 3D look moving). Captured with the trailer tool, edited by the owner.
- Short description (<= 300 chars) + long description + Early Access questionnaire (why EA, how long, what's planned, price change, community involvement = the story vote). Writer drafts, owner signs.
- Capsule art: rendered from the engine (ASCII key art) plus a logo. **Steam requires an AI-content disclosure**; if any store or in-game art is AI-generated (for example the `output/marketing/` avatar), disclose it or don't use it. Recommendation: no AI art on the store page.

### 4.2 Price
- Comparable small indie Early Access RPGs with ~3-5 h of content sell at **$5-$10**. Recommendation: **$7.99**, launch discount 10-15 % for the first week, stated plan "price rises as chapters ship" (an honest EA promise that rewards early buyers). Use Steam's regional pricing suggestions.
- Below $5 looks like shovelware and earns little after fees; above $10 for one chapter of an alpha invites refunds.

### 4.3 Fees and payout
- Valve share 30 % (25 % above $10M, 20 % above $50M). VAT/sales tax is handled by Steam in most regions and taken before the split. Refunds (2 h played / 14 days) are deducted.
- Payout monthly, about 30 days after the month ends, once the monthly balance passes the threshold. Rule of thumb: $7.99 -> about $4.50-5.00 net per copy after VAT, Valve share and refunds, before income tax.
- The owner checks local tax/registration (Hungary: income from software sales, possible VAT registration) with an accountant before launch. Not our call.

### 4.4 Age rating, EULA, privacy
- **Age rating:** Steam's content survey (self-declared). Content: fantasy violence against animals and monsters, red blood (D-053), no sexual content, no gambling, no real-money items. Expect "Teen / 12+" style labels. IARC is not required for Steam-only release.
- **EULA:** Steam Subscriber Agreement covers a normal sale; a custom EULA is not needed for the alpha. Add an in-game "Early Access: content may change, saves migrate between patches" notice.
- **Privacy:** the alpha collects **no data of its own** (no telemetry, no own server). The story vote uses Steam Stats; feedback goes to Steam discussions. Then no privacy policy of our own is strictly needed; still put a one-paragraph privacy note on the store page and in credits ("we store no personal data; Steam stats and forums are under Valve's privacy policy"). Any later own-server feedback form = GDPR work (privacy policy, consent, data deletion) and needs a new decision.

---

## 5. Licence audit (from docs/licences.md + THIRD_PARTY_NOTICES.md)

Rule for the package: **ship only files with a written commercial-redistribution basis. Use an allowlist, not a blocklist**: the desktop packager copies `engine/`, `game/`, `content/` and the runtime `design/*.js` it needs; raw asset packs (`design/meshes/*` sources, `design/vox*`, `design/reference/`) are never copied.

| Pack | Status | Used in shipped content? | Action before alpha |
|---|---|---|---|
| Quaternius (Stylized Nature, Medieval Village, others) | CC0, verified | Yes (trees, props) | None; credit in the credits |
| Kenney Nature Kit | CC0, verified | Yes (2 meshes) | None; credit |
| **StickyBizcuit** voxel pack | Custom terms; **commercial use not explicit**; requires hidden username easter egg | Yes: 37 models + forest derivatives | **Owner emails the author for written commercial permission** (A1). Keep the easter egg (`masonChit`) + credit. No written yes by end of A3 -> replace those models |
| **Ruins** (likely Makovice) | CC0 label conflicts with "no standalone redistribution"; archive identity unconfirmed | 2 derived meshes | Ask the author; the alpha ships derived meshes inside a game (allowed by the candidate terms), never raw files. Unconfirmed by end of A3 -> drop the 2 meshes |
| **Voxel Pack** (MagicaVoxel) | Claimed CC0, publisher unknown | 8 derived models in `vp_pack.js` | Unknown publisher = cannot verify -> **replace the 8 models** (designer, A2-A3) unless the owner finds the source page |
| Cozy Nature FREE | Unverified | No derived content | Exclude from the package (allowlist does it) |
| Fonts | Browser/system fonts only | Glyph atlas | Bundle one OFL font (JetBrains Mono, SIL OFL 1.1) so the look is the same on every PC; ship its OFL text |
| Audio | Procedural WebAudio, own code | Yes | None |
| Electron / Chromium / steamworks.js / Node | MIT + Chromium's third-party licences | Yes | Ship `LICENSES.chromium.html` + Electron licence; credits link |
| Marketing avatar (ImageGen) | Generated | Not in game | Keep off the store page (AI disclosure) |
| Grass technique (SMM, MIT) | Technique only, nothing copied | n/a | None |

Also: the **GitHub repository** holds the full game and raw packs (licences.md speaks of a "public repository"). A paid product whose full source and assets are public can be played for free, and it is exactly the D-053 worry. Owner question 1.

---

## 6. Feedback loop

1. **In-game story vote** (end screen, section 1.5): the pick is stored in the save and sent as a **Steam Stat** (`vote_dir_1..4`, value 1). We read the global totals in Steamworks. Zero servers, no personal data, cannot be spammed (one account = one vote). Browser/dev builds show the screen but send nothing.
2. **"Tell us more" button** opens the pinned Steam discussions thread "Where should Wick go next?" in the Steam overlay browser.
3. **Steam discussions**: pinned threads "Story vote", "Bug reports (attach log folder)", "Known issues", "Roadmap". The PO reads them weekly and copies findings into `docs/bugs.md` as `PB-NNN` (player bug) rows, separate from the owner's OB rows.
4. **Bug report key:** the pause menu "Report a bug" opens the log folder + the bugs thread.
5. **Patch rhythm:** fixes go to the `testing` branch first, owner checks, then `default`. Minimum one patch 1 week after launch.
6. **Close the loop:** 4 weeks after launch the writer + manager read the vote + threads and write the Chapter II direction (a D-entry); the result is posted as a Steam announcement (players see their vote mattered, which is the point of the alpha).

---

## 7. Milestone plan to the alpha (sprints of 5-6 stories)

Target: **Steam Early Access launch Tuesday 2026-12-08**. If any gate fails at the end of A5, slip to **late January 2027** (do not launch into the Steam Winter Sale, about Dec 17 - Jan 5). Each sprint about one week. Sprint files: `docs/sprints/alpha-N.md`.

**Scope freeze from A1 until launch (proposal, owner question 2):** only work that serves sections 1-6 runs. D-102 editor tracks, D-090 engine catch-up stages 2-3, D-101 B/C leg rigs (A gait stays), PX epic and the engine release track pause. New owner ideas go to a "Chapter II / after alpha" list unless they fix a gate.

| Sprint | Dates | Goal (one line) | PC-B (content, quests, game) | PC-A (engine, desktop, perf) | Owner / business |
|---|---|---|---|---|---|
| **A1** | Oct 15-21 | The main chain plays as clean short quests, start to Outwall | MQ-SPLIT-01 D-103 split code + MQ-SPLIT-02 save migration; P0 blockers OB-168 markers, OB-170 Bend waystone, OB-164 marker height, OB-171 E/Q keys | DESK-00 architect note (Electron shell, app:// protocol, WebGPU switches, save IPC, ship allowlist, SteamPipe script); OB-166 load crash | Emails to StickyBizcuit / Ruins author; Steamworks account + $100 fee (starts the 30-day clock); answer section 8 |
| **A2** | Oct 22-28 | Kestrel runs as a Windows app from Steam's folder layout | PACE-01 hidden-level pacing 5 -> 10 (minLevels + gear path sim); CH1-END-01 end screen + credits + vote screen (writer text); D-108 Tobin main step; OB-169 spellbook | DESK-01 Electron shell offline (pinned Chromium, WebGPU on, dGPU forced); DESK-02 file saves atomic + 3 backups + Steam Cloud path | Store page draft (writer), capsule concept; Coming Soon page submitted for review |
| **A3** | Oct 29-Nov 4 | Chapter I content-complete (section 1 checklist green) | Bestiary subset: BEAST-06a/b spawn + respawn + caps, BEAST-05 difficulty, deer + croc models in (designer); region POI pass OB-141/OB-152; side-quest sweep + OB-136 + OB-135 names; licence replacements (Voxel Pack 8 models) | DESK-03 steamworks.js init + overlay + Stats vote + achievements (optional); DESK-04 package allowlist + bundled OFL font + licence files; G5 measure on min spec, set min spec | **Coming Soon live by Nov 4** (5 weeks of wishlists) |
| **A4** | Nov 5-11 | It feels right and looks right | OB-150 combat pass (with BEAST-03b/04 tactics), BEAST-14 boss framework + 3 bosses; OB-167 fire; loot/items pass (tiers to lv 10, no placeholders) | OB-110 flicker; perf fixes from the G5 report (D-075 order); gpucompare re-baseline on the pinned Electron | Owner walk-test #1 (RTX, Electron build); screenshots captured |
| **A5** | Nov 12-18 | **Release candidate**: every gate G1-G10 green on one build | Fixes from walk-test #1; writer final pass (all NEEDS WRITER, store text, EA questionnaire) | SteamPipe upload to `testing` branch; G3 route walk + G6 kill test on the RC; G4/G5 full runs | Owner walk-test #2 (Intel laptop); 3 stranger tests (G9); trailer cut |
| **A6** | Nov 19-Dec 2 (2 weeks, buffer) | Launch-ready: build + store reviewed, bugs from strangers fixed | Bug fixes only (P0/P1 from G8/G9) | Bug fixes only; final RC2 + gates re-run | Submit build + store for Valve review by Nov 24; set price + launch discount; launch Dec 8 |

Each sprint ends with the CLAUDE.md sprint review (PO summary + "missing to be playable" + owner walk-test request). A sprint that misses its goal moves the launch date, never the gates.

### Biggest risks
1. **Quality churn on quests/markers** (OB-168 "already the first one", 22 open OB rows). Mitigation: quest bot (G2) before any owner walk; PO triages every OB row with a priority in A1.
2. **Licence-unclear art is everywhere** (StickyBizcuit: 37 models + forest). If the author says no, A3-A4 lose designer time to replacements. Mitigation: ask in A1, decide by end of A3.
3. **WebGPU on players' GPUs** (driver blocklist, Intel iGPU perf) -> refunds. Mitigation: explicit min spec, medium default on iGPUs, clear "WebGPU required" screen.
4. **Pacing 5 -> 10 on the west bank** is thin today (OB-141 "boring out here"). Mitigation: PACE-01 sim + POI pass in A3; cut regions rather than ship them empty.
5. **Scope creep from parallel epics** (editor, engine catch-up, leg rigs). Mitigation: the freeze above; the manager rejects non-gate work until launch.
6. **Short playtime vs the 2-hour refund window.** Mitigation: G9 measures time-to-gate; price stays in the $5-10 band.
7. **Steam review / timeline slips** (30-day clock, Coming Soon 2 weeks, reviews). Mitigation: fee in A1, Coming Soon in A3, build review in A6 with 2 weeks buffer.
8. **Source exposure** (D-053): a JS game in Electron is readable by anyone who opens the package. Mitigation: private repo (question 1); optional obfuscation in the desktop packaging step only, never in `game/`.

---

## 8. Owner questions (max 5)

1. **Repository and source:** make the GitHub repo **private** before the paid alpha (the public repo contains the whole game and raw packs)? And do you accept that the JS inside the shipped app can be read (light obfuscation in the packaging step is possible but not real protection)?
2. **Scope freeze:** pause the editor tracks (D-102), engine catch-up stages 2-3 (D-090) and the leg rigs B/C (D-101) until the alpha ships, so all agents work on Chapter I?
3. **Platform, price, date:** Windows-only Early Access at **$7.99** (10-15 % launch discount), launch **Tue 2026-12-08** (fallback late January 2027)? Linux/Steam Deck later.
4. **Licence-unclear art:** will you email StickyBizcuit and the Ruins author this week, and if there is no written commercial OK by **Nov 4**, may we replace those models (and the unknown-source Voxel Pack models now)?
5. **The ending:** does Chapter I end with a short **final main quest at the Outwall gate** (closing scene, optional Siege Chief fight) after The Board of the Dead, or right at the Board hand-in? And may the vote screen offer 3-4 writer-made story directions plus a "Tell us more" link to Steam discussions?
