# Kestrel

Owner: Writer. Canon source: `docs/game-design.md` section 3 (D-011, incl. owner amendment 2 in `docs/decisions.md`). Updated: 2026-09-23. Replaces "ASCII Quest: Signal" and "Ember and Ash".

> **Hook:** They told you nobody lives beyond the Wall. Then someone out there started calling for help.

## 1. The story

**Ferrum.** The city climbs a hill in rings of stone and timber, and it runs on machines: brass, steam and gears. Up top the Crown keeps the airships, the gear-gates and the lamps that never gutter. Down in the Low Wards people haul coal, grease cogs and mend rope. Magic is a tale for children, and saying it too loudly gets you fined. Everyone knows the Wall Law: nobody leaves, because beyond the Wall no one survives. Out there is only the wild, the Hush.

**The signal.** Then one night a light blinks on the far horizon. Three short, three long, three short. The old relay stones under the Low Wards start to hum along with it. The Crown says it is marsh-fire, and later says there was no light at all. It comes back every night anyway. If nobody lives out there, who is asking for help?

**Wick.** He is a Low Wards lad who trims the skyworks lamps and patches Crown balloons he will never fly. He remembers every alley and every valve. He has never set foot outside the Wall. He is curious, braver than is sensible, and he knows nothing about the wild except what the Crown told him.

**The theft.** For a month Wick sights the blinking light from the skyworks roof and pencils its bearing onto a Crown sky-chart he lifted from the chart room. Then he cuts the *Kestrel* loose, a small brass patrol craft. The wall-ballistae wake late, then all at once. A bolt tears through the envelope, the burner roars, and the ground comes up to meet him through the broken roof of a tower.

**M1, "The Awakening".** Wick comes to among ash, embers and the burner ticking as it cools. He remembers all of it. His ribs ache and the chart is still in his fist, with the pencil line running straight past the Crown's print, which says BEYOND THE WALL: NOTHING. Moss grows on the stones and a bird calls somewhere, so it is not nothing. He takes the gondola's lamp and climbs. At the summit a dead relay sits in its crystal bowl. When the lamp comes near, it wakes. That is no machine he knows. Ferrum glows behind him, and ahead the signal answers.

**M2, "Out of the Wreck".** He goes down into the Emberlands: moss over old roads, forests over old cities. He finds a steel sword in a ruin. Beasts roam the hills, and some of them are wrong in a way the Crown would call the Hush. The land is alive, just not safe. Each relay he wakes becomes a light he can come back to.

**M3, "The Relay Line".** His pencil line runs from tower to tower. He meets exiles, people Ferrum cast out and swore had died. They hand him an artificer's gauntlet, brass with an empty crystal socket. He looks for the flint and the spring and finds neither. Then he closes his hand and light jumps from his fingers: Spark, the first light verb. It isn't a trick. It is the magic from the children's tale, and it is real. Then brass footsteps follow him through the trees: a stray Crown sentinel, far from any wall that would claim it. Every relay he wakes flares a little brighter toward the signal, as if something at the far end has noticed.

**M4, "The Signal Source".** The line ends at an ancient ruin of pressure doors and gear locks older than the Crown's artificers. Wick fights his way to its heart and takes the first gauntlet crystal. The signal is still pulsing, steady and patient, but nobody is there.

**The mystery.** The machine is old, older than Ferrum's Wall. The relay-keeper's log counts the same pulses from long ago. Somebody built a caller where the Crown swears nobody lives. So who called for help, and who is still calling?

## 2. Magic as discovery

Wick grew up with machines only. Out here every upgrade is something he was told could not exist.
- **The relay waking** (M1): the first hint. The crystal wakes to the lamp as if it knew him. He doesn't have a word for it yet.
- **Spark** (M3): the first spell. Pure wonder, and the end of his disbelief.
- **Gust and Ward, and each gauntlet crystal after that:** discoveries, found in ruins or earned, never bought. Each one is another page of the tale Ferrum called a lie.

## 3. Places

- **Ferrum.** A walled, tiered city of stone, timber and machines. Lamplight and brass at the top, smoke and rope at the bottom. From outside you only ever see its lights on the horizon.
- **The Wall.** A ring of stone lined with ballistae. It was built to keep people in, and what it says about the outside is a lie.
- **The Hollow Watchtower.** A roofless round relay tower wrapped in moss and ivy, with the *Kestrel* smashed through its broken crown. Canvas hangs in the stairwell and the burner smolders on the floor.
- **The *Kestrel*.** A Crown patrol balloon: a brass gondola, a copper burner and a lamp that still works. Now it is wreckage, and it was the only way out.
- **The Relay Line.** Old signal towers strung across the Emberlands, each with an aether-crystal bowl in a brass-and-mirror mount. Every one is dead until you wake it.
- **The Signal Tower.** A far spire where a teal light pulses at the end of his pencil line.

## 4. Relay-keeper's log (US-021, each line <= 60 chars)

```
Day 1. Relay cold. Wall says no one is out here. Liar.
The far tower blinks at night. 3 short, 3 long, 3 short.
Mirror cracked. Bowl still holds light if you feed it.
No reply from Ferrum. They hear it. They choose not to.
If you read this, keep climbing. The light is up top.
```

## 5. Title card (US-017 / US-015)

**Title:** `KESTREL`
**Subtitle:** `SOMEONE IS CALLING`

**Hints:**
```
The burner still glows. Take what light you can.
Climb. You cannot see the signal from down here.
Press M to read the chart.
```

**Map card (US-015, shown once after waking; `M` re-opens):**
```
      CROWN SKY-CHART  -  your pencil
  FERRUM [#]                          * SIGNAL
   (wall)   \                        /
             x HOLLOW TOWER --o---o---o
               (you are here)   old relays
  Crown print: "BEYOND THE WALL: NOTHING"
  Your pencil: "Then who is blinking?"
  Your pencil: "Follow the old towers."
        - any key -
```

## 6. Proposals (ESCALATE TO MANAGER)

1. **Hero name: Wick.** It is short, it suits a lamp-trimmer's boy, and it fits pillar 1 "Light is life". It is already the internal name, so nothing internal changes. GDD 3 still says "nameless on screen". Amendment 2 asks for a name, so the manager should confirm where it shows (the title card, the log, or the exiles in M3).
2. **SOS pattern.** The pulse is 3 short, 3 long, 3 short, the old sailor's SOS. It is used in the log and in the story. It needs canon confirmation, and the P2 pulse animation should match it.
3. **The log is old.** The keeper counted the same signal years ago. That hints the SOS is older than Wick's escape. It is kept vague on purpose, but it constrains the eventual reveal.
4. **Exile village name.** It is still unnamed. Candidate: **Outwall**.
5. **GDD section 3 is stale.** It still lists partial amnesia, the "Crown mages" and a handwritten map. The PO needs to update it to amendment 2: no amnesia, a machine-only Ferrum, magic real outside, and the map as a Crown sky-chart with Wick's pencil course.

## 7. M4 reveal candidates (for manager)

Per D-013 item 3. Each keeps "the SOS has been sending for years" and "nobody is there".

**A. The shut-out people.** The caller was built by the people who lived here before the Wall. When the Crown's founders sealed the gates, they left them outside to die, and the machine still repeats their last call. The Crown has always heard it, and the Wall exists so no one inside has to answer.
- Setups: relay glyphs older than Crown script (M2); the log line "They hear it. They choose not to." (M1, done); exiles' songs about "the ones before" (M3).

**B. The keeper's lamp.** The relay-keeper was an exile who found the dead caller and re-woke it years ago, hoping someone in Ferrum would come. He walked the line to keep it fed and never came back. The machine calls on alone, and now Wick is the one feeding it.
- Setups: the same hand in every log (M1-M3); a keeper's empty camp at one relay (M2); exiles remember "the lamp man" who went to the far tower (M3).

**C. The land is calling.** The crystals are one living web, and the SOS is the wild itself asking for help. Ferrum's lamps that never gutter burn stolen aether, and the drain is what turns beasts wrong. Nobody is at the source because the source is everywhere.
- Setups: "lamps that never gutter" (M1, done); relays dimmer and Hush beasts thicker near the Wall (M2); a Crown crystal crate at the sentinel (M3).

## 8. Talking animals: sample dialogue (US-042)

First talking animal, M2, on the tower path. Speaker labels: `BEAR`, `YOU`. The bear never says "Wick" (D-013). Lines <= 56 chars for the 3x56 box.

*Stage: a bear sits by the path, eating berries. The player walks up, sees `[E] Talk` and presses E.*

```
BEAR: You're the one who fell out of the sky.
YOU:  ...Bears don't talk.
BEAR: Boys don't fly. And yet, all that smoke.
YOU:  It's a trick. A speaking-tube. Brass.
BEAR: Check my ears for brass, then. Carefully.
YOU:  No. No, thank you.
BEAR: Your city calls us a tale. We call it the loud hill.
BEAR: You're following the blinking light.
YOU:  You've seen it?
BEAR: It blinked when my grandmother was a cub.
BEAR: It asked for help then, too. Nobody came.
BEAR: Go on, sky-cub. Leave the berries.
```

## 9. APPROVED (owner, 2026-09-25): the vanished one (option A, Maren)

Not canon. From `docs/owner-ideas/2026-09-24-story-and-progression.md`. Items marked ESCALATE TO MANAGER need a canon call.

**1. Who vanished**
- **A. Maren, his older sister (recommended).** She trimmed the skyworks lamps before him and taught him the trade. It keeps the bond warm without romance, and it makes his job an inheritance.
- **B. Hob, his father, a lamp-master.** Weightier and more mournful. It pulls the story toward grief and makes Wick a boy chasing a grown man's choices.
- **C. Isa, a girl from the next ward.** Adds longing, but it's a romance thread to carry through M6, and it leans toward cliche.

Why Maren: she was the one who said the relay stones under the Low Wards *sing*. Magic is a tale Ferrum fines you for, and she was fined for it.

**2. How she vanished (seven years ago)**
Maren was fined twice for "stone-talk". One winter night she didn't come down from the skyworks. The Crown posted her name on the Low Wards board: FELL. LOST TO THE HUSH. They returned her lamp to the family, and it was the reason Wick never believed them. It had been trimmed, shuttered and set down neatly. Nobody trims a wick before they fall. She put that light out herself. (Fits canon: the exiles are "people Ferrum cast out and swore had died".)

**3. The SOS and the jump (hope, not proof)**
- There is no signature in the signal. The logic is simple: nobody lives beyond the Wall, so a call for help from out there means *someone is alive*. If one person can be, then so can Maren. Wick has no proof, only hope.
- **The ambiguous detail:** the SOS makes the relay stones under the Low Wards hum, and those are the stones Maren was fined for saying *sing*. That doesn't prove anything, but Wick can't stop thinking about it.
- The call is old (canon), and nobody in Ferrum will say for how long. That leaves room to hope it started around the winter she disappeared.
- **Why alone, and why now:** telling anyone means telling the Crown, and the Low Wards only shrug that the dead don't signal. After a month of charting, Crown masons come down to mortar over the humming stones. That night, before the last thread to her is sealed, he cuts the *Kestrel* loose.

**4. Crash intro (~38 s, ends on the current wake)**
1. (4 s) Black screen. A far teal `*` pulses 3 short, 3 long, 3 short, and the stones below hum `~ ~ ~` in time with it.
2. (6 s) A skyworks roof at night under Ferrum's amber lamps. A knife saws through a mooring rope `|` until it snaps, and the *Kestrel* lifts in `~ )` canvas.
3. (5 s) Burner flare. The Wall slides past below, and its lamps snap on one by one, left to right.
4. (5 s) A ballista swivels. A bolt streaks up as a `---->` line.
5. (6 s) The envelope tears into flying `~` glyphs. The burner roars white, the horizon tilts and the teal star swings across the view.
6. (6 s) Falling. The chart flutters and a hand closes on it. A moss-stone ring rushes up out of the dark.
7. (6 s) Impact, a white flash and scattered glyphs. Then black, a few drifting embers and the burner ticking as it cools, which hands off to the wake.

**5. Magic, relays and wells**
- Maren heard the stones sing inside a city with no magic. Outside the Wall, she was right. The things Wick was told could not exist are the things she was punished for saying.
- **Relays** (the owner's "beacons") and **aether wells** (new: springs where crystals grow) are where the land's light gathers, and where Wick draws power. Maren passed some of them first.
- **ESCALATE TO MANAGER:** the owner's spell tree (fireball, freeze, lightning, one big spell, gained at relays, wells and quests) differs from canon (Spark, Gust and Ward, from gauntlet crystals, never bought). Proposal: keep them as light verbs. Spark becomes fire, a cold light becomes freeze, a struck light becomes lightning, and the big spell stays unnamed until late.
- **Hooks (no ending):**
  - The exiles' gauntlet (M3) was made for a smaller hand. They go quiet when he asks whose it was.
  - At a well, a lamp-trimmer's knot is tied to the winch, the one the skyworks hands use. Anyone from the skyworks could have tied it, though.
  - A stray Crown sentinel's record drum reads: `M. - CAST OUT - RECORDED DEAD`.
- It stays compatible with the section 7 candidates. She may have found the caller (A or C) or fed it (B). In M4, "nobody is there" still holds, because she had been there and was gone.

**6. M1 lines to adjust later (not changed here)**
- Section 1 "The signal" says "one night a light blinks". Canon says the SOS has been sending for years, so this should read that it was always there and one night it *ended differently*.
- Map card: `Your pencil: "Then who is blinking?"` could become `Your pencil: "Someone is alive. So she could be. W."`, which also adds the canon "W." that the card still lacks.
- Hint `The burner still glows. Take what light you can.` could echo her: `Trim the wick. Take what light you can.`
- End card `Someone is out there.` could become `She is out there.` (the relay-woken variant only), or stay as it is to keep M1 unspoiled.
- Relay-keeper's log: no change. It must not know Maren or Wick.
- Maren's name never appears on screen in M1. The hope stays implied ("she", nothing more).

## Scrawl (wall text, ASCII, each line <= 60 chars)

| Where | Text | Notes |
|---|---|---|
| Hollow Watchtower, north face of the stair column, beside the ruin-steel sword in the rubble (US-078) | `STEEL FOR THE HUSH` | Kept as the designer proposed. Knife-scratched capitals, shallow and old, with moss in the grooves and no signature. "Hush" is Ferrum's word for the wild, so whoever cut it came from inside the Wall, long ago. It fits B (the keeper) and the Maren hooks, and it doesn't contradict A or C. It says nothing about the signal. |

### The keeper's corner (ENV-02, decal `scrawlKeeper`)

Scratched on the north face of the grate column, by the bedroll, the log book, the broken stool and the cold candle, just beside KEEP THE LIGHT. It is the same knife hand, cut lower and smaller, as if the keeper did it sitting on the floor. One glyph per cell, 3 lines, 24 chars or fewer.

**Chosen:**
```
IIII IIII IIII IIII IIII
IIII IIII IIII IIII III
... --- ...  STILL
```
- The tallies are nights. Two rows of them show a long vigil without any number to pin the reveal to.
- The last group stops at `III`. The count was never finished. That is enough, and it doesn't say why.
- `STILL` points two ways: it is still calling, and he is still waiting. It fits all three M4 candidates and doesn't name a sender.
- Wick can read the signal line at a glance. It is the pattern he charted for a month, cut here long before he flew.

**Alternatives:**
1. Nobody came, with a little hope left in it:
```
IIII IIII IIII IIII IIII
IIII IIII II
... --- ...  NO ONE YET
```
2. The pattern never changes:
```
... --- ...
IIII IIII IIII IIII IIII
SAME. SAME. SAME.
```

**Keeper's log book (later readable item, not placed; lines <= 60 chars):**
```
Ink gone. The wall keeps the count now.
Stool broke. Watched it from the floor. Same hour, same blink.
If it ever stops, someone answered. It has not stopped.
```
It uses the same hand and voice as the section 4 log. It doesn't know Wick or Maren, has no dates, and says nothing about who is calling. The first line explains the tallies, so the wall reads as the log's continuation.

## Credits / easter eggs

OWN-REQ-013: the StickyBizcuit voxel pack licence asks for a hidden in-game nod to the username. It must contain the exact string `StickyBizcuit` (keep the case), stay legible, be skippable and never be pointed at by any hint.

**Chosen (option 1): a mason's mark.**

| Where | Text | Medium |
|---|---|---|
| Hollow Watchtower, ground floor. A low wall stone behind the stair column, on the side away from the sword scrawl, at knee height and facing the wall. You only see it by walking round the column and looking down. | `Stones set by StickyBizcuit.` | Wall scrawl (same system as US-078). Small, shallow and chisel-cut rather than knife-scratched, moss in the grooves, dimmer than `STEEL FOR THE HUSH`. |

Why it fits: towers have builders, and builders sign their stones. It reads as an old mason's mark, so it doesn't break the world and it says nothing about the signal. The mixed case is the wink.

Rejected:
2. A maker's stamp on an SB-pack crate or barrel in the walk-out, `Made by StickyBizcuit`. This works, but it depends on which props get placed and it reads more like a shop label.
3. A boulder in a walk-out corner, `StickyBizcuit was here`. This is the classic graffiti line, but it is too modern for the tone.

Credits screen (later): `Voxel assets by StickyBizcuit`.

## Opening sequence (panels)

Voice: Wick, first person, present tense. He is never named or shown, only his hands. One caption per still and ASCII only. It replaces the beat list in section 9.4 with five panels, ending on the existing wake.

```
1. Thirty nights on the skyworks roof. Same light, same
   pattern. I pencil its bearing.
2. Midnight. A knife, a mooring rope, a Crown ship that
   was never mine. The rope gives.
3. The Wall slides under me. Its lamps wake one by one.
   Then the ballistae.
4. A bolt through the envelope. The burner roars. Below,
   a broken tower opens like a mouth.
5. Stone, moss, a rain of brass. The chart still in my
   fist. Then nothing.
```

Panel 5's "Then nothing" deliberately echoes the Crown print `BEYOND THE WALL: NOTHING`. The wake then shows that it is not nothing.

## Death card

Shown when Wick falls, before he wakes at the last save point (relay or autosave). It uses the same voice as the opening panels: first person, present tense, never named, ASCII only, 8 words or fewer.

1. `The dark again. The light still blinks.` **(PICK)** The signal is still sending, so he gets up. It answers "nothing" without saying the word.
2. `Cold stone. Not nothing. Not yet.` This one echoes the Crown print directly. It is stronger, but it leans close to panel 5.
3. `Ash in my mouth. I am still here.` The most bodily of the three, and the plainest.

## Sprint 8 texts

Writer pass for S8-A-11, S8-A-12 and S8-A-13 (2026-10-08). All strings are ASCII only, and lengths were counted by hand. Programmers and lane C paste these strings into the data files; this section does not edit any code or JSON. Name rule (D-013): "Wick" appears only in save-slot labels. No objective, item, scrawl or prompt says it.

### S8-A-11 Objectives (`content/quests/m1.quest.json`)

The chain is wake -> lantern -> breach -> sword -> beasts -> waystone. Max 38 chars for HUD and done lines, max 40 for hints. Keep the ids. Paste the HUD line into `objectives[id].text`. The quest file has no done/hint fields today. If S8-C-12/S8-C-13 add them, use the key names `done` and `hint` (a proposal, not a schema decision).

| Objective id | `text` (HUD) | len | `done` | len | `hint` | len |
|---|---|---|---|---|---|---|
| `wake` | `Get up from the wreck` | 21 | `Up. Ribs aching. Still here.` | 28 | `Move with WASD. Look with the mouse.` | 36 |
| `lantern` | `Take the Kestrel's lamp` | 23 | `Warm light in hand. Now climb.` | 30 | `The warm glow by the burner. Press E.` | 37 |
| `breach` | `Climb to the breach at the top` | 30 | `Ferrum behind. The signal ahead.` | 32 | `Space jumps the gap. E pulls the lever.` | 39 |
| `sword` | `Take up the ruin steel` | 22 | `Old steel. It still holds an edge.` | 34 | `Look where the stone says STEEL.` | 32 |
| `beasts` | `Bring down the two wild boars` | 29 | `The hill goes quiet again.` | 26 | `Wait out the charge, then strike.` | 33 |
| `waystone` | `Walk the pencil line to the waystone` | 36 | `The stone hums. The signal answers.` | 35 | `Press M. The pencil line leads on.` | 34 |

Notes:
- The id `lantern` stays, but the on-screen word is "lamp" (canon: the *Kestrel*'s gondola lamp).
- The `sword` hint points at the `STEEL FOR THE HUSH` scrawl, which is cut beside the sword wherever it is placed (US-078).
- "Waystone" is treated as an old road-marker stone on the pencil line. It adds no lore beyond "it hums with the signal", like the relay stones do.

Quest-level strings (for the quest log, S8-C-12):

| Key | Text | len |
|---|---|---|
| `quest.m1.title` | `The Awakening` | 13 |
| `quest.m3.title` | `Steel and Hush` | 14 |
| `quest.m1.done` | `The pencil line runs on.` | 24 |
| `quest.log.header` | `PENCIL NOTES` | 12 |
| `quest.log.empty` | `Nothing yet. Not nothing.` | 25 |

If the M3 beats (`breach`, `sword`, `beasts`) move to a separate quest file under S8-C-13, the objective rows above move with their ids unchanged.

### S8-A-12 Title, settings and credits labels

Max 20 chars unless marked LONG. `{n}` = slot number (1-3).

| Key | Text | len |
|---|---|---|
| `title.heading` | `KESTREL` | 7 |
| `title.pressEnter` | `Press Enter` | 11 |
| `title.new` | `New game` | 8 |
| `title.continue` | `Continue` | 8 |
| `title.continue.disabled` | `Continue (no save)` | 18 |
| `title.settings` | `Settings` | 8 |
| `title.credits` | `Credits` | 7 |
| `title.delete` | `Delete slot` | 11 |
| `title.back` | `Back` | 4 |
| `title.chooseSlot` | `Choose a slot` | 13 |
| `slot.empty` | `Slot {n}: Empty` | 15 |
| `slot.unavailable` | `Slot {n}: Unreadable` | 20 |
| `slot.filled` (LONG, D-013) | `Slot {n}: Wick - {place} - {h:mm}` | ~40 |
| `confirm.delete` | `Delete slot {n}?` | 16 |
| `confirm.replace` | `Overwrite slot {n}?` | 19 |
| `confirm.yes` | `Yes` | 3 |
| `confirm.cancel` | `Cancel` | 6 |
| `msg.slotEmpty` | `This slot is empty.` | 19 |
| `msg.loadFail` | `Could not read slot.` | 20 |
| `msg.deleteFail` | `Could not delete.` | 17 |
| `msg.deleted` | `Slot deleted.` | 13 |
| `title.keys` (LONG) | `Arrows select  Enter choose  Del delete  Esc back` | 49 |

Place names for `{place}` in slot labels (save meta):

| Key | Text | len |
|---|---|---|
| `place.tower` | `Hollow Watchtower` | 17 |
| `place.summit` | `Tower Summit` | 12 |
| `place.hillside` | `The Hillside` | 12 |
| `place.waystone` | `The Waystone` | 12 |

Settings (`uiStyle.settings.labels`; the ids follow `options.js` and the S8-C-04 rows):

| Key | Label | len | Values |
|---|---|---|---|
| `settings.title` | `SETTINGS` | 8 | - |
| `quality` | `Quality` | 7 | `Low` / `Medium` / `High` / `Ultra` |
| `shadows` | `Shadows` | 7 | `off` / `soft` / `sharp` |
| `grid` | `Grid` | 4 | as now (`480x180 ultra`) |
| `volume` | `Volume` | 6 | `0`..`10` |
| `mute` | `Mute` | 4 | `off` / `on` |
| `textSize` | `Text size` | 9 | `Small` / `Normal` / `Large` |
| `reduceMotion` | `Reduce motion` | 13 | `off` / `on` |
| `fullscreen` | `Fullscreen` | 10 | `off` / `on` |
| `mouseSensitivity` | `Mouse speed` | 11 | number as now |
| `invertY` | `Invert look` | 11 | `off` / `on` |
| `controls` | `Controls` | 8 | - |
| `back` | `Back` | 4 | - |
| note `reduceMotion` (LONG) | `Less head bob and camera kick` | 29 | shown when selected |
| note `quality.Ultra` (LONG) | `Needs a fast GPU` | 16 | shown when selected |

Credits (`creditsView.js`):

| Key | Text | len |
|---|---|---|
| `credits.title` | `CREDITS` | 7 |
| `credits.madeBy` | `Made by` | 7 |
| `credits.assets` | `Third-party assets` | 18 |
| `credits.thanks` | `With thanks` | 11 |
| `credits.stickyBizcuit` (LONG, OWN-REQ-013) | `Voxel assets by StickyBizcuit` | 29 |
| `credits.closing` | `Thanks for flying.` | 18 |
| `credits.keys` | `Esc back` | 8 |

The credit names come from `docs/licence-inventory.json`, and the writer does not invent any.

### S8-A-13 Items (`design/items.js` defs, S8-C-08 ids)

Max 14 chars for names and 38 for lines. The first 12 rows match the S8-A-07 icon list (the potion icon = `orb.hp`; canon says no potions in M4). New ids are marked NEW: they are proposals for S8-C-08, and the designer checks them before drawing icons. All ids are lowercase dot ids, like the existing ones. The old line in `sword.desc` held control text; that text moves to the inventory key hints.

| Id | Name | len | Line (`desc`, item-get card) | len |
|---|---|---|---|---|
| `sword` | `Ruin Steel` | 10 | `Old watch steel. Nicked, still true.` | 36 |
| `shield` NEW | `Brass Buckler` | 13 | `Gondola plate, bent round a strap.` | 34 |
| `lantern` NEW (quest item id) | `Kestrel Lamp` | 12 | `The gondola's lamp. It still burns.` | 35 |
| `orb.hp` (potion icon) | `Herb Flask` | 10 | `Bitter herbs under red wax. Heals.` | 34 |
| `key.small` NEW | `Small Key` | 9 | `Iron, brown with rust. Fits one lock.` | 37 |
| `bow` NEW | `Hunter's Bow` | 12 | `Yew and gut. Quiet, and it reaches.` | 35 |
| `bomb` NEW | `Blast Pot` | 9 | `Clay, black powder, a short fuse.` | 33 |
| `heart.piece` NEW | `Heart Piece` | 11 | `A warm red stone. Four make a heart.` | 36 |
| `cog` NEW (currency) | `Brass Cog` | 9 | `Ferrum's small change. Worth a trade.` | 37 |
| `boar.hide` | `Boar Hide` | 9 | `Coarse, bristled. Good for something.` | 37 |
| `boar.tusk` | `Boar Tusk` | 9 | `Yellow ivory, sharp at the tip.` | 31 |
| `brass.scrap` NEW (material 3) | `Brass Scrap` | 11 | `From the Kestrel. Ferrum, in pieces.` | 36 |
| `spell.fireball` | `Ember` | 5 | `A coal that answers the hand.` | 29 |
| `torch` | `Torch` | 5 | `Pitch and rag on a stick. See by it.` | 36 |
| `boar.meat` | `Boar Meat` | 9 | `A haunch, still warm. Eat to heal.` | 34 |
| `orb.mp` | `Cold Shard` | 10 | `A sliver of teal light. Restores MP.` | 36 |

Open points:
- `cog`: currency is an open owner question (GDD 10). This is only a proposal: salvaged Crown brass as small change.
- `spell.fireball` "Ember" stays a demo spell. It is not Spark and must not be called Spark: Spark stays the gauntlet's first light verb.
- After this pass, `placeholderName` can be set to false for every existing id in the table.

Prompts (interact line, `[E]` style per GDD 7.4):

| Key | Text | len |
|---|---|---|
| `prompt.chest` | `[E] Open chest` | 14 |
| `prompt.lootBoar` | `[E] Loot boar` | 13 |
| `prompt.takeSword` | `[E] Take sword` | 14 |
| `card.continue` | `- any key -` | 11 |

### S8-A-13 Scrawl (M1 area; no dialogue in M1)

Wall-scrawl system as US-078. Capitals are knife-cut and ASCII, one glyph per cell. None of them is signed or names anyone.

| Key | Where | Text | len | Why |
|---|---|---|---|---|
| `scrawl.hiddenChest` | Hillside, on the rock that hides the chest, low and facing the chest | `FOR THE NEXT ONE OUT` | 20 | Someone else got out before, and left something for whoever came after. This fits the exiles ("cast out") and all three M4 candidates. |
| `scrawl.breach` | Summit, inside face of the breach parapet, at eye height as you step out | `NOT NOTHING` | 11 | Answers the chart's `BEYOND THE WALL: NOTHING` at the exact place where the world opens. Not the same text as the death card. |
| `scrawl.boarRock` | Hillside, a boulder on the path down where the boars roam | `THEY FEAR THE LIGHT` | 19 | A quiet tip that matches canon (beasts avoid relay light). It gives a reason to carry the lamp. |
| `scrawl.waystone` | Base of the waystone, half under moss | `... --- ...  FURTHER ON` | 23 | The SOS pattern in the keeper's notation, pointing on along the line. It hints that the signal goes further without saying who sends it. |

NPC lines: M1 has no NPCs and no dialogue (GDD 7). The first speaking NPC is the bear (section 8, M2), so no new NPC lines are written here.

### Waystone (WAYSTONE-01w)

Touching the stone saves, heals and sets the respawn point (GDD 11: rest = save + heal + respawn point). Toasts are max 38 chars. Use `place.waystone` (`The Waystone`) as the toast title. The healing comes from the stone, not from a potion. The fade lines use the death card's voice: first person, never named.

| Key | Where | Text | len |
|---|---|---|---|
| `prompt.waystone` | Interact line, near the stone | `[E] Touch the waystone` | 22 |
| `toast.waystone.saved` | HUD toast after the touch | `Saved. The stone will remember.` | 31 |
| `toast.waystone.healed` | HUD toast after the touch, under the saved toast | `Warmth in the hands. Hearts full.` | 33 |
| `fade.respawn.waystone` | Death fade / wake line, respawn at the stone | `I wake against the humming stone.` | 33 |
| `fade.respawn.start` | Same slot, no stone touched yet (spawn point) | `No stone yet. I wake by the wreck.` | 34 |
| `lore.waystone` | Optional echo (first touch, or the item-card line) | `Old road stone. The signal hums in it.` | 38 |

The quest `done` line `The stone hums. The signal answers.` stays on the objective. `lore.waystone` is a separate line and does not replace it.

## Sprint 8 texts - M3 additions (PC-B writer, 2026-10-09)

ASCII only, lengths counted by hand. No line names Wick (D-013). The notes are unsigned and say nothing about who sends the SOS (M4 reason stays open).

| Key | Where | Text | len |
|---|---|---|---|
| `demo.endcard` | Demo end card at the waystone (above Restart / Keep exploring) | `End of the demo. Not of the line.` | 33 |
| `demo.endcard.sub` | Second line, optional | `The signal still blinks, further on.` | 36 |
| `demo.titleTag` | Small tag on the title menu | `Demo build` | 10 |
| `death.line` (DEATH-FLOW-01) | Centred line in the death fade | `Dark again. The light still blinks.` | 35 |
| `quest.note1` (QUEST-TEXT-02) | Torn note, hillside | `Boars on this slope. They charge straight and turn slow.` | 56 |
| `quest.note2` (QUEST-TEXT-02) | Second note, further down | `Thin them out before dark. The stone down the line hums.` | 56 |
| `obj.beasts5` | Objective HUD, 5-boar variant | `Bring down the five wild boars` | 30 |
| `obj.beasts2` | Objective HUD, 2-boar variant (same as `beasts` above) | `Bring down the two wild boars` | 29 |
| `hint.combat.block` (COMBAT-HINT-01) | Combat hint | `Shield up as it comes. Then cut.` | 32 |
| `hint.combat.dodge` (COMBAT-HINT-01) | Combat hint | `Step aside late. Boars turn slow.` | 33 |

Notes:
- `death.line` is the picked death card (`The dark again. The light still blinks.`, 39) shortened to fit 38.
- No `place.waystone.toast` key: the waystone already has `toast.waystone.saved` and `toast.waystone.healed` (WAYSTONE-01w above, title `place.waystone`). Use those.
- The notes give no boar count, so they work with either the 2- or the 5-boar objective.
