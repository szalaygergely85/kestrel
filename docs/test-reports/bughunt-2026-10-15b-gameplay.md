# Bug hunt round 2, area G (combat + player, settings, title) - 2026-10-15

Architect, read-only trace pass under the owner's 10-minute cap (no browser, no probes beyond grep/read).
Files read: game/js/quest/sim/{fireball,equipment,crafting,quickbar,vitals,difficulty,beastLevels}.js, sword.js (arc section), safeSpots.js, titleMenuHost.js, settings/options.js, beacon.js:140-160.

## Round-1 suspects
- Beacon light handle (`bughunt-2026-10-15-save-quest.md:67`): **cleared**. `game/js/quest/beacon.js:151-154` stores `lights.key.indexOf(key)` - a number (or null at :88), never an object. Canonical save is not affected.
- Double save per waystone touch: not re-probed (round 1 already rated it harmless/perf-only; no new evidence).

## Confirmed

### BH2-G1 - low/medium - Difficulty setting only scales beast hp/dmg + respawn; the other 9 multipliers are dead data
- Evidence: `grep -rn "playerDmg|difficulty\.(windup|noticeR|noticeSec|leash|groupDelta|eliteChance|gear|flank)" game/js engine` -> zero consumers outside `game/js/quest/sim/difficulty.js`. Only `d.hp`/`d.dmg` (`beastLevels.js:19`, read once at beastSim create) and `difficulty.respawn` (`spawnDirector.js:74`) are used. `difficulty.js:3-4` carries the TODO itself ("per-slot notice/leash/windup ... and the player-damage hook (playerDmg)") but the Settings > Difficulty menu (DIFF-MENU, OB-150) is shipped as a player-facing option, and `docs/bugs.md` has no row for the gap.
- Also: `beastLevels.js:2` "beastSim reads levelScale() once at create" -> a live difficulty change from the settings menu (`main.js:1977/1987 -> beasts.setDifficulty`) does not change hp/dmg of beasts until the next world load; `applyDifficulty` (difficulty.js) is not called from main.js at all (grep: only `setDifficulty`).
- Cause: BEAST-06a shipped the table, BEAST-05/06b (consumers) were never done; menu landed first.
- Fix (one line of scope): either wire `playerDmg` into `vitals.onHit` (`n = round(damage * beastDamageScale * d.playerDmg)`) + rescale hp/dmg on `setDifficulty`, or hide easy/hard until 06b and note it in docs/bugs.md. Slot: kestrel-3 (sim).

## Checked, no bug found (so the next round can skip)
- Fireball cast/mana: lock (`isEnabled`), cap, charged->tap mana fallback, cooldown, point-blank sweep all consistent (`fireball.js:104-146`).
- Equipment: equip/unequip undo paths are safe; quiver swap always fits (q.n <= stackMax, freed slot) (`equipment.js:56-100`).
- Crafting: staged pack, atomic commit, id validation incl. `__proto__` (`crafting.js`).
- Quickbar hand derivation + `set` consumers all guard `eq.ranged !== null` (main.js:2606/2686, equipPlay.js:64, quickbar.js:40/118).
- Vitals: block path returns before defence/damage, defence applied after block, respawn restores hp/mp/invuln and clears lastSafe (`vitals.js:144-213`).
- Title: Load with explicit slot falls back to onContinue (`titleMenuHost.js:59`), consistent.

Not reached within the cap: sword reach numbers vs arcHits, arrows/bow draw, HPBAR/DMGNUM views, loot drop tables, potions sip timing, aspect/quality presets.
