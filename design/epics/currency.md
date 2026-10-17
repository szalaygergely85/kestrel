# EP-CURRENCY - Coin (PO draft, 2026-10-17, owner D-121)

Rules this epic keeps: no XP (D-084/D-116: level = gear power + spells), every quest rewards something (D-106),
plain names (Coin / coins), existing meshes and the existing ASCII UI style only (no new art), no Esc hint text.

## 1. What coin is (in-world)
Coins are old brass coins that the river-road folk outside the Wall still trade with (one line for docs/game-design.md
section 3 once the writer/owner approve the wording; section 10's "currency and a trader?" open question closes).

## 2. Design
**Wallet.** Coin is a number, not a pack item: it takes no slot in the 24-slot pack. Saved in the game save
(`game.coin`, integer 0..9999, old saves load as 0). Gains show a toast "+20 coins" (existing toast).
**Where it shows.** Inventory screen: one line "Coin 123" under Wick's HP / DEF / DMG stats. HUD: a small "Coin 123"
counter that shows for 3 s after any change, then fades (no permanent HUD clutter; see owner question 1).

**How you get it.**
| Source | Amount | Notes |
|---|---|---|
| Errand quest (1 step, near giver) | 5-15 | band `errand` |
| Side quest | 15-40 | band `side` (default for non-`mq.` ids) |
| Main quest | 20-50 | band `main` (default for `mq.` ids) |
| Elite / dungeon quest (crypt, Greyback, Old Tusk ...) | 40-100 | band `elite` |
| Regular beast kill | 10 % chance, 1-5 | straight to wallet + toast, no world pickup mesh |
| Elite beast kill (respawns, D-120) | always 10-20 | every kill, the long linger keeps it from farming |
| Small chest / crate | 5-15 | added to CHEST_TABLES as `{ coin: [min,max] }` |
| Secret chest | 20-40 | |
| Crypt chest (D-114) | 30 fixed | already promised "coins" |
Coin in a quest reward is ADDED to the existing item reward, it never replaces it (items stay the interesting part).
Rough income check: ~10 quests in the first 2 h at ~25 = 250 coins + ~60 from beasts/chests = 5-6 potions plus one
gear piece. Coin should feel useful, never the main goal.

**What it buys: Bram the post-keeper is a simple trader** (Ford trade post; he already has a dialogue). His talk gets a
"Trade" choice that opens a trade screen (same panel, frame and colours as the inventory screen: left = your pack,
right = Bram's stock). Fixed stock, no restock timer, consumables unlimited:
| Item (existing ids) | Buy |
|---|---|
| Health Potion | 20 |
| Arrows x10 | 10 |
| Bomb | 15 |
| 3 gear pieces, `sturdy` tier, fixed slots (body, feet, hands) via `gearIdFor` | 80 / 100 / 120, each sold once |

**Sell: YES**, at 1/4 of value (rounded down, min 1): materials (Boar Hide 3, Boar Tusk 4, Goblin Trinket 5, Blue Sprig
1, Red Cap 2), food (Boar Meat 2), gear by tier (worn 5, sturdy 15, fine 40). Reason: the 24-slot pack fills with worn
loot and beast parts that today have no use; selling clears the pack and gives drops a point. Never sellable:
`key`, `upgrade`, `spell`, `weapon` (Old Sword), `tool`, quest items. No buy-back.

**Death / loss.** None. Coin is never lost on death or quit. No other cost of dying is added.

## 3. Stories (each <= 1 programmer day; Node tests; no new art)
| ID | Slot | Title | Depends |
|---|---|---|---|
| CUR-01 | k1 | Wallet + reward grant + save | - |
| CUR-02 | k1 | Coin display: inventory line + HUD flash | CUR-01 |
| CUR-03 | k3 | Prices + trader stock data + pure trade sim | CUR-01 |
| CUR-04 | k1 | Bram "Trade" choice + trade screen | CUR-02, CUR-03 |
| CUR-05 | k4 | Coin lint + editor coin tile enabled | CUR-01 |
| CUR-06 | k3 | Coin pass: quests, beasts, chests | CUR-01, CUR-05 |

### CUR-01 Wallet + reward grant + save [P1] [todo] (k1)
Files: new `game/js/quest/sim/wallet.js` (+ `wallet.test.js`), `game/js/questPickups.js`, `game/js/main.js` (save/load).
- [ ] `createWallet(n=0)`: `add(n)`, `spend(n)` (false + no change when short), `value`; integers only, clamped 0..9999; Node test.
- [ ] `questPickups.grantReward` pays `reward.coin` into the wallet and returns it; items behave exactly as before (existing questPickups tests green).
- [ ] questBook normalize keeps `rewards.coin` / `reward.coin` (non-negative integer, else throws "quest: invalid reward coin"); Node test.
- [ ] Toast "+N coins" (plural "coin" for 1) via the existing toast path.
- [ ] Save writes `game.coin`; an old save without it loads 0; round-trip Node test.

### CUR-02 Coin display [P1] [todo] (k1)
Files: `game/js/quest/inventoryScreen.js`, `game/js/ui/combatHud.js` (or the HUD file that owns hearts), uiStyle entries.
- [ ] Inventory screen shows "Coin N" under the stats block, colours from `uiStyle.inventory` (no new style keys beyond one text colour); inventoryScreen test checks the cell text.
- [ ] HUD shows "Coin N" next to the hearts for 3.0 s after the value changes, then fades over 0.5 s; hidden at start and while the value is unchanged; Node test on the timer (show/hide at t=0, 2.9, 3.6 s).
- [ ] No text mentions Esc; nothing else in the HUD moves.

### CUR-03 Prices, stock, trade sim [P1] [todo] (k3)
Files: new `content/economy/trade.json`, new `game/js/quest/sim/trade.js` (+ `trade.test.js`), `design/items.js` (optional `value` per item).
- [ ] `trade.json`: Bram's stock + buy prices + sell values exactly per section 2; values read by id, plain names from item defs.
- [ ] `buy(wallet, inv, stock, id)`: fails (no change) when short of coin or pack full; once-only gear leaves the stock and stays gone after save/load (`game.tradeSold`).
- [ ] `sell(wallet, inv, id, n)`: pays floor(value/4) min 1 each; refuses never-sellable kinds (key, upgrade, spell, weapon, tool, quest items) with a plain reason.
- [ ] Node tests cover buy, short, full pack, once-only gear, sell, refused sell.

### CUR-04 Trade screen [P1] [todo] (k1)
Files: new `game/js/quest/tradeScreen.js` (+ test), postkeeper dialogue file, `game/js/main.js` (open/close wiring).
- [ ] Bram's talk shows "Trade" as a choice; picking it opens the trade screen; the existing Bram quest talks are unchanged (postkeeperDialogue tests green).
- [ ] Layout reuses the inventory screen frame/colours: left = pack grid, right = stock list "Health Potion  20"; footer shows "Coin N".
- [ ] E / click buys or sells the selected entry; a short coin or full pack gives a plain one-line message ("Not enough coin", "Your pack is full").
- [ ] Q or the trade key closes it; no Esc text; the game is paused while it is open like the inventory screen.
- [ ] Node test: open, buy a potion (coin -20, potion +1), sell a Boar Hide, close.

### CUR-05 Coin lint + editor tile [P1] [todo] (k4)
Files: `tools/editor/quest/rewards.js`, `tools/editor/questPanel.js`, the quest lint (QPIPE-LINT rules), `content/economy/trade.json` read-only.
- [ ] Editor coin tile enabled (`coinPaid: true`), `COIN_NOTE` removed; conversation.test updated.
- [ ] New lint rule COIN-01: `rewards.coin` must be an integer 0..200 (error); outside the quest's band range from section 2 = warning. Band = optional `rewardBand` (`errand|side|main|elite`) in the quest, else `main` for `mq.` ids and `side` otherwise.
- [ ] COIN-02: every trade.json id exists in item defs, buy > 0, never-sellable kinds have no sell value (error).
- [ ] Lint runs in `node tools/run-tests.mjs`; fixture tests for pass, warn and error cases.

### CUR-06 Coin pass on existing content [P1] [todo] (k3)
Files: `content/quests/*.quest.json`, `content/quests/*/pack.json`, `game/js/quest/sim/chestDefs.js`, `game/js/quest/sim/lootConfig.js` / `loot.js`.
- [ ] Every quest with a giver gets `rewards.coin` in its band (set `rewardBand` for errands and elite quests); under.graves keeps 20; existing item rewards untouched.
- [ ] COIN-01 reports 0 errors and 0 warnings over all quests.
- [ ] Beasts: regular 10 % 1-5 coin, elite 10-20 every kill, through the seeded loot RNG (same result every run); loot.test covers both.
- [ ] Chests: small 5-15, secret 20-40, crypt 30; the Ford cellar comment "no coin item exists yet" goes; chest tests green.
- [ ] Quest text lines that name a coin amount match the data (grep "coins" in quest texts).

## 4. Owner questions
1. HUD: coin counter only for 3 s after a change (proposal), or always visible next to the hearts?
2. Bram sells 3 sturdy gear pieces (80-120 coins) - OK, or consumables only so gear stays a loot/quest reward?
3. Selling junk at 1/4 value - yes (proposal), or no selling at all?
