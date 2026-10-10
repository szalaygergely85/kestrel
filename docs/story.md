# Kestrel

Owner: Writer. Canon source: `docs/game-design.md` section 3 (D-011, incl. owner amendment 2 in `docs/decisions.md`). Updated: 2026-09-23. Replaces "ASCII Quest: Signal" and "Ember and Ash".

> **Hook:** They told you nobody lives beyond the Wall. Then someone out there started calling for help.

## 1. The story

**Ferrum.** The city climbs a hill in rings of stone and timber, and it runs on machines: brass, steam and gears. Up top the Crown keeps the airships, the gear-gates and the lamps that never gutter. Down in the Low Wards people haul coal, grease cogs and mend rope. Magic is a tale for children, and saying it too loudly gets you fined. Everyone knows the Wall Law: nobody leaves, because beyond the Wall no one survives. Out there is only the wild, the Hush.

**The signal.** Then one night a light blinks on the far horizon. Three short, three long, three short. The old relay stones under the Low Wards start to hum along with it. The Crown says it is marsh-fire, and later says there was no light at all. It comes back every night anyway. If nobody lives out there, who is asking for help?

**Wick.** He is a Low Wards lad who trims the skyworks lamps and patches Crown balloons he will never fly. He remembers every alley and every valve. He has never set foot outside the Wall. He is curious, braver than is sensible, and he knows nothing about the wild except what the Crown told him.

**The theft.** For a month Wick sights the blinking light from the skyworks roof and pencils its bearing onto a Crown sky-chart he lifted from the chart room. Then he cuts the *Kestrel* loose, a small brass patrol craft. The wall-ballistae wake late, then all at once. A bolt tears through the envelope, the burner roars, and the ground comes up to meet him through the broken roof of a tower.

**M1, "The Awakening".** Wick comes to among ash, embers and the burner ticking as it cools. He remembers all of it. His ribs ache and the chart is still in his fist, with the pencil line running straight past the Crown's print, which says BEYOND THE WALL: NOTHING. Moss grows on the stones and a bird calls somewhere, so it is not nothing. He climbs. At the summit a sword lies beside a note, Ferrum glows behind him, and ahead the signal answers. He finds the way down and out into a meadow loud with birds. (D-062: no lamp. A crystal the boars rooted up wakes the stones; see "Chapter 1 build" at the end.)

**M2, "Out of the Wreck".** He goes down into the Emberlands: moss over old roads, forests over old cities. He finds a steel sword in a ruin. Beasts roam the hills, and some of them are wrong in a way the Crown would call the Hush. The land is alive, just not safe. Each relay he wakes becomes a light he can come back to.

**M3, "The Relay Line".** His pencil line runs from tower to tower. He meets exiles, people Ferrum cast out and swore had died. They hand him an artificer's gauntlet, brass with an empty crystal socket. He looks for the flint and the spring and finds neither. Then he closes his hand and light jumps from his fingers: Spark, the first light verb. It isn't a trick. It is the magic from the children's tale, and it is real. Then brass footsteps follow him through the trees: a stray Crown sentinel, far from any wall that would claim it. Every relay he wakes flares a little brighter toward the signal, as if something at the far end has noticed.

**M4, "The Signal Source".** The line ends at an ancient ruin of pressure doors and gear locks older than the Crown's artificers. Wick fights his way to its heart and takes the first gauntlet crystal. The signal is still pulsing, steady and patient, but nobody is there.

**The mystery.** The machine is old, older than Ferrum's Wall. The relay-keeper's log counts the same pulses from long ago. Somebody built a caller where the Crown swears nobody lives. So who called for help, and who is still calling?

## 2. Magic as discovery

Wick grew up with machines only. Out here every upgrade is something he was told could not exist.
- **The stone waking** (M1): the first hint. A crystal from Burl's slope wakes the Waystone as if it knew him (D-062, no lamp). He doesn't have a word for it yet.
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
- Superseded (D-062): the `lantern` step is removed and the chain is the 11-step Chapter 1 chain (see "Chapter 1 build"). No lamp text ships.
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
| `lantern` (dropped, D-062: no lamp) | `Kestrel Lamp` | 12 | `The gondola's lamp. It still burns.` | 35 |
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
| `scrawl.boarRock` | Hillside, a boulder on the path down where the boars roam | `THEY FEAR THE LIGHT` | 19 | A quiet tip that matches canon (beasts avoid relay light). It foreshadows the woken stones (no lamp, D-062). |
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

## EP-TALK: the bear (BEAR-LINES-01, PC-B writer, 2026-10-09)

**Name:** `Burl` (`bear.name`, label `BURL`). A burl is the round knot on an old tree: slow-grown, hard to shift, and good wood.

**Personality:** Burl is an old, unhurried bear who talks like a grandmother by a hearth: dry, kind, and not at all surprised by you. She wants a quiet afternoon, a full berry bush and someone to share the bush with, as long as they don't take the blue ones. She calls Ferrum "the loud hill" and its people "cubs", and she sees it as a nest of noisy children who never come out to play.

**From the section 8 sample:** kept the ideas "check my ears for brass", "my grandmother was a cub", "sky-cub" and "the loud hill". Everything else is replaced. Section 8 stays as the old sample. The sample line "It asked for help then, too" is dropped because it gets too close to explaining the SOS.

Rules: ASCII 32-126, each line <= 56 chars, each reply <= 40 chars, lengths counted by hand (text only; the speaker label is the frame's name tag). Burl never says "Wick" or explains the light. The player disbelieves, and the magic is just a bear talking.

Flow: l1 -> l2 -> l3 -> choice (a | b | c) -> one Burl line per branch -> `bear.d1.close` (rejoin, sets the talked flag). Per path: 6 lines. Total: 10.

| Key | Speaker | Text | len | Clip |
|---|---|---|---|---|
| `bear.name` | - | `Burl` | 4 | |
| `bear.d1.l1` | BURL | `Well. A cub from the loud hill, fallen out of the sky.` | 54 | `wave` |
| `bear.d1.l2` | YOU | `...Bears don't talk.` | 20 | |
| `bear.d1.l3` | BURL | `And cubs don't fly. Yet here we both are.` | 41 | |
| `bear.d1.choice.a` | YOU | `It's a trick. A speaking-tube.` | 30 | |
| `bear.d1.a.l1` | BURL | `Check my ears for brass, then. Gently.` | 38 | |
| `bear.d1.choice.b` | YOU | `Can I have a berry?` | 19 | |
| `bear.d1.b.l1` | BURL | `One. The blue ones are mine. They are all blue.` | 47 | `laugh` |
| `bear.d1.choice.c` | YOU | `Have you seen the blinking light?` | 33 | |
| `bear.d1.c.l1` | BURL | `Since my grandmother was a cub. It never tires.` | 47 | |
| `bear.d1.close` | BURL | `Go on, sky-cub. Walk soft. The wild is listening.` | 49 | |
| `bear.repeat` | BURL | `Back again? The berries are still mine. Mostly.` | 47 | |

Notes:
- `wave` is on the greeting (`l1`). `bear.d1.close` would also work as a farewell wave if the clip team wants a second one.
- Branch c only shows that the light is old (canon: it has been sending for years). It does not say who sends it or why.

## EP-TALK: the first villager (VILLAGER-LINES-01, PC-B writer, 2026-10-10)

**Name:** `Fen` (label `FEN`, entity `villager1`). A fen is a wet, low meadow. Fen stands about 6 m from Burl, near the waystone. She is one of the people Ferrum cast out. She never says so, never names the village (unnamed until M3), never calls the player Wick, and says nothing about the signal. She knows Burl the way you know a neighbour's dog. Her voice is short and practical.

Flow: l1 (two lines) -> close. Lines <= 56 chars (engine DIALOGUE_LINE_MAX), ASCII, counted by hand.

| Key | Speaker | Text | len |
|---|---|---|---|
| `villager.d1.l1` (1) | FEN | `Burl let you this close? Then you'll do, stranger.` | 50 |
| `villager.d1.l1` (2) | FEN | `The boars are tearing up the slope. Thin them out.` | 50 |
| `villager.d1.close` | FEN | `Then rest at the humming stone. It remembers faces.` | 51 |

Notes: points to the boar quest and the waystone, and echoes `toast.waystone.saved` ("The stone will remember."). If M1/M2 must stay NPC-free on screen, the label can go back to `VILLAGER` without changing any line.

## EP-QUEST: Burl's boars (QG-W1, PC-B writer, 2026-10-10)

Texts for D-058 / architecture 38.35. ASCII only, lengths counted by hand (text only, no speaker label). Limits: dialogue lines <= 56, replies (choices) <= 40, HUD / objective / returnText / toasts <= 38. No Esc hints. Burl keeps her BEAR-LINES-01 voice: dry, kind, unhurried, "sky-cub", berries, the blue ones. Owner pick: **no item reward**, so the thanks line promises nothing (no coin, no gift). QG-03 pastes these into `content/quests/burl.boars.quest.json`, `m1.quest.json` and `bear.dialogue.json`; this section edits no JSON.

Flow: offer (3 lines) -> choice Accept | Later -> accepted / later reply (end). Active = reminder (end). Ready = ready line -> thanks node (node `setFlag: q.burl.boars.handin`, end). Done = after line (end).

| Key | Where / speaker | Text | chars |
|---|---|---|---|
| `quest.burl.boars.title` | Quest title (log) | `Boars in the Berries` | 20 |
| `bear.q.offer` (1) | BURL | `Five boars have found my berry slope.` | 37 |
| `bear.q.offer` (2) | BURL | `They root up the bushes, and they do not share.` | 47 |
| `bear.q.offer` (3) | BURL | `I am too old to chase. You have steel, sky-cub.` | 47 |
| `bear.q.choice.accept` | YOU (choice) | `I'll thin them out.` | 19 |
| `bear.q.choice.later` | YOU (choice) | `Not yet.` | 8 |
| `bear.q.accepted` | BURL | `Good. Mind the tusks. They charge straight, turn slow.` | 54 |
| `bear.q.later` | BURL | `Then sit a while. The boars will still be rude.` | 47 |
| `bear.q.active` | BURL (reminder) | `Still snorting down there. I can hear them chewing.` | 51 |
| `bear.q.ready` | BURL (ready entry) | `Quiet. Listen. Only bees now, and the wind.` | 43 |
| `bear.q.thanks` | BURL (hand-in node) | `Thank you, sky-cub. The slope can breathe again.` | 48 |
| `bear.q.done` | BURL (after hand-in) | `Quiet slope, full bushes. Still not the blue ones.` | 50 |
| `quest.burl.boars.beasts` | Step text (HUD), `burl.boars` | `Bring down the five wild boars` | 30 |
| `quest.burl.boars.beasts.done` | Step done line (optional) | `The slope goes quiet again.` | 27 |
| `quest.burl.boars.returnText` | HUD / log tag when ready | `Tell Burl the slope is quiet` | 28 |
| `m1.beasts` (new `text`) | m1 HUD line, replaces the boar line | `Find the old bear on the hillside` | 33 |
| `m1.beasts.hint` (optional) | m1 hint | `Look for the bear near the waystone.` | 35 |
| `toast.quest.accepted` | Toast | `Quest accepted` | 14 |
| `toast.quest.complete` | Toast | `Quest complete` | 14 |
| `quest.log.active` | Log header | `Active` | 6 |
| `quest.log.done` | Log header | `Done` | 4 |

Notes:
- `m1.beasts` says "the old bear", not "Burl": the player may reach this step before meeting her, and the name tag only shows in the dialogue box. Once accepted, the HUD follows `tracked()` and shows the `burl.boars` step / returnText (which can say "Burl", because she has introduced herself by then).
- The m1 `beasts` done line (`The hill goes quiet again.`) stays as is.
- `bear.q.accepted` echoes `quest.note1` (charge straight, turn slow), so the torn notes and Burl agree.
- `bear.q.done` needs an entry `{node: bear.q.done, requires: q.burl.boars.done}` before `bear.talked`; without it, done falls through to `bear.repeat`, which also works.
- Clips (optional): `laugh` on `bear.q.later`, `wave` on `bear.q.thanks`.

## World stage 1: relay waystones (WS1-W1)

Texts for D-060 / architecture 38.36 (PC-B writer, 2026-10-10). The relays are the waystones: a woken relay heals, saves, sets the respawn point and becomes a travel point on the M card. ASCII only, lengths counted by hand. Limits (the stricter of the backlog row and the brief): prompts <= 24, toasts / HUD / done <= 38, hint <= 40, map labels <= 14, map header <= 30. No Esc hints, no rewards promised, no line names Wick or says who sends the signal.

**Name:** the road-bend relay is `Bend Relay`: plain, the way a Low Ward hand would name a mast by where it stands. The meadow stone keeps its name, `The Waystone` (`place.waystone`).

| Key | Where | Text | chars |
|---|---|---|---|
| `place.relay.ws_roadBend` | Toast title, save-slot `{place}`, map label for `ws_roadBend` | `Bend Relay` | 10 |
| `map.label.waystone` | Map label for the meadow stone (= `place.waystone`) | `The Waystone` | 12 |
| `prompt.relay.wake` | Interact line, dead relay | `[E] Wake the relay` | 18 |
| `prompt.relay.touch` | Interact line, awake relay (heal + save) | `[E] Touch the relay` | 19 |
| `toast.relay.woken` (1) | Wake toast, line 1 (title `place.relay.ws_roadBend`) | `The relay hums awake.` | 21 |
| `toast.relay.woken` (2) | Wake toast, line 2 | `Saved. The relay will remember.` | 31 |
| `toast.relay.saved` | Touch on an awake relay (line 2 alone) | `Saved. The relay will remember.` | 31 |
| `toast.relay.healed` | Under the saved line (reuse) | `Warmth in the hands. Hearts full.` | 33 |
| `fade.respawn.relay` | Death fade / wake line, respawn at a relay | `I wake under the humming relay.` | 31 |
| `lore.relay` | Optional echo, first wake | `Brass, crystal. Older than the Wall.` | 36 |
| `map.travel.header` | M card, bottom line header | `Travel: press a number` | 22 |
| `map.travel.line` (example) | M card list, built from labels by `order` | `1 The Waystone  2 Bend Relay` | 28 |
| `toast.travel.here` | Digit pressed within 6 m of the target (optional; silent no-op also fine) | `Already here.` | 13 |
| `m1.relay1` | Optional 7th m1 objective (WS1-09), HUD | `Wake the relay at the road bend` | 31 |
| `m1.relay1.done` | Done line | `A second light on the pencil line.` | 34 |
| `m1.relay1.hint` (optional) | Hint | `Follow the road west. Press E there.` | 36 |

Notes:
- `toast.relay.saved` echoes `toast.waystone.saved` ("The stone will remember.") on purpose: stone and relay are the same kind of place.
- `toast.relay.healed` is the same text as `toast.waystone.healed`; one shared key is fine.
- The wake beat stays wordless beyond the toast (canon: he has no word for it yet). "Hums" ties it to the relay stones under the Low Wards.
- If the label list grows past two, keep the pattern `<digit> <label>` with two spaces between entries; 9 labels of <= 14 do not fit one 60-char line, so stage 2 needs a second line or shorter labels.
- `lore.relay` follows canon (the machine part is older than Ferrum's Wall) and adds nothing new.

## Chapter 1 build (CH1-W1..W5)

Texts for D-062 / architecture 38.37 (PC-B writer, 2026-10-10). Source: `docs/chapters/chapter-1-beyond-the-wall.md`; its lines are kept verbatim wherever they fit. ASCII only, lengths counted by hand (text only, no speaker label). Limits: dialogue / bark / note lines <= 56, choices <= 40, HUD / objective / toast <= 38, prompts <= 24, notice title <= 30 and body <= 38. No Esc hints, no rewards promised. Speaker labels: `BURL`, `FEN`, player `YOU`. A key with (1), (2) ... is one node with several lines, in order.

**No lamp (D-062).** Every lamp line is rewritten to the crystal the boars give. The four existing tower notes (`keeperLog`, KEEP THE LIGHT, STEEL FOR THE HUSH, the mason's chit) have no lamp in them and stay as they are, except that the sword scrap now carries note 1's text (below). The lamp is mentioned in two `storyHints` (`burner`, `exit`), and those are rewritten in q01. The crystal's in-world name avoids the word "aether", because Fen is the first to say it (q07).

### ESCALATE TO MANAGER (canon text, GDD section 3)
1. GDD 3 still says "M1: the relay wakes to the lamp" and "No dialogue in M1". D-062 replaces both: the crystal from the boars wakes the stones, and Chapter 1 has dialogue. Proposal: the PO updates GDD 3 to match.
2. D-013 says that nobody says "Wick" before the M3 exiles. The owner's script has Fen say it (and Wick says it himself). Below, the script text is the default because the owner approved it. Each line that uses the name has a name-free alternative (`alt`), ready if the manager keeps D-013. Proposal: Fen counts as an exile (cast out, knows Ferrum), so the name rule becomes "first spoken by an exile". The GDD needs a one-line change for that.
3. The script's end-of-chapter state lists "his Kestrel lamp". That should read: sword, sky-chart and the crystal.

### q01 A Blade in the Ashes (CH1-W1)

| key | who | text | chars |
|---|---|---|---|
| `m1.section.q01` | title | `A Blade in the Ashes` | 20 |
| `m1.section.q02` | title | `Leave the Tower` | 15 |
| `m1.section.q03` | title | `Boars in the Woods` | 18 |
| `m1.section.q04` | title | `Follow the Bear` | 15 |
| `m1.section.q05` | title | `Awaken the Stone` | 16 |
| `m1.section.q06` | title | `The Next Light` | 14 |
| `m1.section.q07` | title | `Not Alone` | 9 |
| `toast.section.complete` | toast | `Quest complete: {title}` (longest: q01 = 36) | 36 |
| `m1.wake` | HUD | `Get up from the wreck` (unchanged) | 21 |
| `m1.breach` | HUD | `Climb to the top of the tower` | 29 |
| `m1.sword` | HUD | `Pick up the sword` | 17 |
| `m1.leave` | HUD | `Find a way out of the tower` | 27 |
| `m1.beasts` | HUD | `Find the voice among the berries` | 32 |
| `m1.follow` | HUD | `Follow Burl to the Waystone` | 27 |
| `m1.waystone` | HUD | `Wake the Waystone` | 17 |
| `m1.road` | HUD | `Follow the western road` | 23 |
| `m1.relayFound` | HUD | `Find Bend Relay` | 15 |
| `m1.relay1` | HUD | `Wake Bend Relay` | 15 |
| `m1.fen` | HUD | `Speak to the stranger` | 21 |
| `note.steelHush.title` | note 1 | `A note by the sword` | 19 |
| `note.steelHush` (1) | note 1 | `To whoever finds this place:` | 28 |
| `note.steelHush` (2) | note 1 | `` (empty row) | 0 |
| `note.steelHush` (3) | note 1 | `The road beyond is no longer safe.` | 34 |
| `note.steelHush` (4) | note 1 | `Take the blade. You may need it.` | 32 |
| `note.steelHush` (5) | note 1 | `` (empty row) | 0 |
| `note.steelHush` (6) | note 1 | `And if you hear something below, do not answer.` | 47 |
| `note.leave.title` | note 2 | `A note by the stair` | 19 |
| `note.leave` (1) | note 2 | `These stones are not as dead as they seem.` | 42 |
| `note.leave` (2) | note 2 | `` (empty row) | 0 |
| `note.leave` (3) | note 2 | `Do not stay here after dark.` | 28 |
| `note.leave` (4) | note 2 | `Something moves beneath the tower.` | 34 |
| `note.leave` (5) | note 2 | `` (empty row) | 0 |
| `note.leave` (6) | note 2 | `Leave while there is still light.` | 33 |
| `bark.wick.sword` | YOU | `Better than empty hands.` | 24 |
| `prompt.door.unbar` | prompt | `[E] Pry the bar loose` | 21 |
| `toast.door.open` | toast | `The sword bites. The bar gives.` | 31 |
| `hint.burner` | story hint | `The burner ticks. The Kestrel is done.` | 38 |
| `hint.exit` | story hint | `The top. Look west through the breach.` | 38 |

Notes:
- The bar is jammed, not locked, so the sword is what pries it. That explains the `tower.sword.taken` gate without saying it.
- `hint.burner` replaces "Take what light you can." Suggested `skipIfState`: `tower.sword.taken`, so it stays quiet on the way back down. That is a code choice for CH1-02.
- `hint.exit` no longer says the breach is a way out or that the chapter ends there. The scrawl `NOT NOTHING` stays on the breach parapet, where it now marks the overlook.
- `STEEL FOR THE HUSH` stays as wall scrawl if the decal is kept. The note panel shows the script text.

### q02 Leave the Tower (CH1-W1)

| key | who | text | chars |
|---|---|---|---|
| `bark.wick.meadow` (1) | YOU | `Nothing, they said.` | 19 |
| `bark.wick.meadow` (2) | YOU | `Looks like plenty of nothing.` | 29 |

Fires when `leave` completes (outside the door, in the meadow). The step and section toasts come from q01.

### q03 Boars in the Woods (CH1-W2, CH1-W3)

**QG-W1 keys replaced:** `quest.burl.boars.title`, `bear.q.offer`, `bear.q.choice.accept`, `bear.q.accepted`, `bear.q.active`, `bear.q.ready`, `bear.q.thanks`, `quest.burl.boars.returnText`, `m1.beasts`. **Dropped:** `bear.q.done` (the follow offer in q04 takes its entry), `m1.beasts.hint`, and BEAR-LINES-01 `bear.d1.*` (replaced by `bear.call` + `bear.meet`). **Kept:** `bear.name`, `bear.repeat`, `bear.q.choice.later`, `bear.q.later`, `quest.burl.boars.beasts`, `quest.burl.boars.beasts.done`, `toast.quest.*`, `quest.log.*`.

| key | who | text | chars |
|---|---|---|---|
| `quest.burl.boars.title` | log | `Boars in the Woods` | 18 |
| `quest.burl.boars.returnText` | HUD | `Return to Burl` | 14 |
| `bear.call` (1) | BURL (bark) | `Well, well. The falling cub lives.` | 34 |
| `bear.call` (2) | YOU (bark) | `Who's there?` | 12 |
| `bear.call` (3) | BURL (bark) | `Down here. Among the berries.` | 29 |
| `bear.meet` (1) | BURL | `Quite a fall you took, sky-cub.` | 31 |
| `bear.meet` (2) | YOU | `...You just spoke.` | 18 |
| `bear.meet` (3) | BURL | `I did.` | 6 |
| `bear.meet` (4) | YOU | `Bears don't talk.` | 17 |
| `bear.meet` (5) | BURL | `And people don't fall from the sky.` | 35 |
| `bear.meet` (6) | BURL | `Yet here you are.` | 17 |
| `bear.meet` (7) | YOU | `This isn't possible.` | 20 |
| `bear.meet` (8) | BURL | `You folk from the loud hill are odd.` | 36 |
| `bear.meet` (9) | BURL | `You believe a balloon can fly,` | 30 |
| `bear.meet` (10) | BURL | `but a bear with words troubles you?` | 35 |
| `bear.meet.choice.crash` | YOU (choice) | `You saw me fall?` | 16 |
| `bear.meet.choice.west` | YOU (choice) | `I'm going west.` | 15 |
| `bear.crash` (1) | BURL | `Hard to miss a burning sky-boat.` | 32 |
| `bear.crash` (2) | BURL | `Thought the whole hill would catch fire.` | 40 |
| `bear.crash` (3) | YOU | `It's called an airship.` | 23 |
| `bear.crash` (4) | BURL | `Not much of one now.` | 20 |
| `bear.q.offer` (1) | BURL | `If you're heading west, mind the woods.` | 39 |
| `bear.q.offer` (2) | BURL | `Boars have taken over my berry slope.` | 37 |
| `bear.q.offer` (3) | BURL | `Mean things. No respect for blueberries.` | 40 |
| `bear.q.offer` (4) | YOU | `I'm looking for something.` | 26 |
| `bear.q.offer` (5) | BURL | `Aren't we all?` | 14 |
| `bear.q.offer` (6) | YOU | `A light. It blinks in the distance.` | 35 |
| `bear.q.offer` (7) | BURL | `Ah. The far light.` | 18 |
| `bear.q.offer` (8) | BURL | `There is an old Waystone past the trees.` | 40 |
| `bear.q.offer` (9) | BURL | `Might help you find your way.` | 29 |
| `bear.q.offer` (10) | BURL | `But first, those boars need moving.` | 35 |
| `bear.q.choice.accept` | YOU (choice) | `I'll clear the path.` | 20 |
| `bear.q.choice.later` | YOU (choice) | `Not yet.` (kept) | 8 |
| `bear.q.accepted` (1) | BURL | `Five ought to convince the others.` | 34 |
| `bear.q.accepted` (2) | BURL | `Mind their tusks, sky-cub.` | 26 |
| `bear.q.later` | BURL | `Then sit a while. The boars will still be rude.` (kept) | 47 |
| `bear.q.active` (1) | BURL | `Still hearing those greedy snouts.` | 34 |
| `bear.q.active` (2) | BURL | `Five boars. No need to chase the whole herd.` | 44 |
| `toast.crystal.found` | toast | `A crystal glints where the boar fell.` | 37 |
| `item.aetherCrystal.name` | item | `Teal Crystal` | 12 |
| `item.aetherCrystal.desc` | item | `Warm, and it hums like the old stones.` | 38 |
| `bear.q.ready` (1) | BURL | `Ah! I can smell the berries again!` | 34 |
| `bear.q.ready` (2) | YOU | `The path is clear.` | 18 |
| `bear.q.ready` (3) | BURL | `And my breakfast is saved.` | 26 |
| `bear.q.ready` (4) NEW | BURL | `What's that in your paw? It glows.` | 34 |
| `bear.q.ready` (5) NEW | YOU | `It was under the last boar.` | 26 |
| `bear.q.ready` (6) NEW | BURL | `So that's what they were rooting for.` | 36 |
| `bear.q.ready` (7) NEW | BURL | `Keep it close. Old stones like that light.` | 41 |
| `bear.q.thanks` | BURL (hand-in node) | `You've done an old bear a kindness.` | 35 |

Notes:
- `bear.call` is the architecture's first-call bark, the first time the player comes within 14 m after `leave`. Its three lines are the script's opening, so the dialogue (`bear.meet`) starts at "Quite a fall you took".
- Both choices after `bear.meet` flow into `bear.q.offer` (the crash branch first plays `bear.crash`). The node sets `bear.talked`.
- The crystal lines (4-7) explain why the boars took the slope (they were rooting for it). They hint at "old stones" and say nothing more. "Teal" and "hums" tie it to the relay stones under the Low Wards. The toast fires at the last boar, at the teal burst. If the pack is full, the lines still read right.
- `bear.q.thanks` flows straight into `bear.follow` (q04).

### q04 Follow the Bear (CH1-W2)

| key | who | text | chars |
|---|---|---|---|
| `bear.follow` (1) | BURL | `Come along, sky-cub.` | 20 |
| `bear.follow` (2) | BURL | `I'll show you that old stone.` | 29 |
| `bear.follow` (3) | YOU | `You're coming with me?` | 22 |
| `bear.follow` (4) | BURL | `Wouldn't want you getting lost.` | 31 |
| `bear.follow` (5) | BURL | `You already fell out of the sky once.` | 37 |
| `bear.walk1` (1) | BURL (bark) | `Hear those birds?` | 17 |
| `bear.walk1` (2) | YOU (bark) | `What about them?` | 16 |
| `bear.walk1` (3) | BURL (bark) | `They sing when the woods are at peace.` | 37 |
| `bear.walk1` (4) | BURL (bark) | `Not everything out here means you harm.` | 38 |
| `bear.walk2` (1) | YOU (bark) | `Where does this road lead?` | 26 |
| `bear.walk2` (2) | BURL (bark) | `West. To the river, and farther.` | 32 |
| `bear.walk2` (3) | BURL (bark) | `Older roads cross it. Older stones too.` | 38 |
| `bear.walk2` (4) | YOU (bark) | `Who built them?` | 15 |
| `bear.walk2` (5) | BURL (bark) | `Good question.` | 14 |
| `bear.walk2` (6) | BURL (bark) | `The stones aren't telling.` | 26 |

`bear.follow` is used both by the hand-in flow and by entry 4 (`q.burl.boars.done`, not following yet). Its last node sets `s.burl.follow`.

### q05 Awaken the Stone (CH1-W2, CH1-W3)

| key | who | text | chars |
|---|---|---|---|
| `bear.stone` (1) | BURL | `There we are.` | 13 |
| `bear.stone` (2) | BURL | `The Waystone.` | 13 |
| `bear.stone` (3) | YOU | `It's an old machine.` | 20 |
| `bear.stone` (4) | BURL | `Not quite.` | 10 |
| `bear.stone` (5) | YOU | `Looks like one.` | 15 |
| `bear.stone` (6) | BURL | `That's because you look with your eyes.` | 39 |
| `bear.stone` (7) | YOU | `What else should I look with?` | 29 |
| `bear.stone` (8) | BURL | `Your head, for a start.` | 23 |
| `bear.stone` (9) | BURL | `These stones remember those who wake them.` | 42 |
| `bear.stone` (10) | BURL | `If you fall, their light calls you home.` | 39 |
| `bear.stone` (11) | BURL | `They remember your journey too.` | 31 |
| `bear.stone` (12) | BURL | `And when you wake another stone,` | 32 |
| `bear.stone` (13) | BURL | `you can travel between them.` | 28 |
| `bear.stone` (14) | YOU | `Without walking?` | 16 |
| `bear.stone` (15) | BURL | `That's the idea.` | 16 |
| `bear.stone` (16) | YOU | `That's impossible.` | 18 |
| `bear.stone` (17) | BURL | `You've said that before.` | 24 |
| `bear.stone` (18) REWRITE | BURL | `Try holding that crystal to the bowl.` | 36 |
| `prompt.stone.wake` | prompt | `[E] Hold up the crystal` | 23 |
| `notice.waystone.title` | notice | `WAYSTONE AWAKENED` | 17 |
| `notice.waystone` (1) | notice | `Your journey is remembered here.` | 32 |
| `notice.waystone` (2) | notice | `You will return here if you fall.` | 32 |
| `notice.waystone` (3) | notice | `Find more Waystones to unlock travel.` | 37 |
| `bear.woken` (1) | YOU | `What is that?` | 13 |
| `bear.woken` (2) | BURL | `An old kind of light.` | 21 |
| `bear.woken` (3) | YOU | `No gears. No steam.` | 19 |
| `bear.woken` (4) | BURL | `Not everything needs them.` | 26 |
| `bear.woken` (5) | BURL | `Well done, sky-cub.` | 19 |
| `bear.woken` (6) | BURL | `The next stone lies west, by the road bend.` | 43 |
| `bear.woken` (7) | BURL | `Follow the old road and your little chart.` | 42 |
| `bear.woken` (8) | YOU | `You're not coming?` | 18 |
| `bear.woken` (9) | BURL | `These paws have walked far enough today.` | 40 |
| `bear.woken` (10) | BURL | `And my berries won't eat themselves.` | 36 |
| `bear.woken` (11) | YOU | `Thank you, Burl.` | 16 |
| `bear.woken` (12) | BURL | `Take care out there.` | 19 |
| `bear.woken` (13) | BURL | `The world is wider than your Wall.` | 33 |
| `bear.departing` | BURL | `Go on, sky-cub. The road is west.` | 33 |

**Stage note (not on screen; replaces "Wick raises the Kestrel's lamp"):** Wick holds the teal crystal out over the bowl. A low hum rises from the brass mount and the mirrors turn. Teal light runs from his hand into the bowl and spreads through the stone, lighting old marks under the moss. The crystal in his hand stays whole and warm, so it is not spent.

Notes:
- `bear.stone` (18) replaces "Try bringing your lamp closer." Its last node sets `bear.stone.told`.
- `bear.woken` is entry 2 (`s.waystone.waystone.woken`). Lines 1-4 are the script's reaction lines, which play after the notice. Its last node sets `s.burl.depart`. `bear.departing` is entry 1, the farewell repeat.

### q06 The Next Light (CH1-W3)

| key | who | text | chars |
|---|---|---|---|
| `m1.section.q06.desc` (1) | log | `The Waystone has awakened.` | 26 |
| `m1.section.q06.desc` (2) | log | `Another lies west along the old road.` | 37 |
| `m1.section.q06.desc` (3) | log | `Find it to open a path between stones.` | 38 |
| `bark.wick.relay` (1) | YOU | `Another one.` | 12 |
| `bark.wick.relay` (2) | YOU | `Let's see if Burl was right.` | 27 |
| `prompt.relay.wake` | prompt | `[E] Hold up the crystal` (replaces WS1-W1 text) | 23 |
| `notice.relay.title` | notice | `BEND RELAY AWAKENED` | 19 |
| `notice.relay` (1) | notice | `Travel unlocked.` | 16 |
| `notice.relay` (2) | notice | `You can now travel between` | 26 |
| `notice.relay` (3) | notice | `awakened Waystones.` | 19 |

**Stage note (replaces "Wick holds his lamp beside the crystal"):** Wick holds the teal crystal beside the dormant bowl. The bowl begins to hum, and teal light flows through the old brass.

Notes:
- `bark.wick.relay` fires on entering the `bendRelay` area (step `relayFound`).
- The notice replaces the WS1-W1 `toast.relay.woken` (both lines). `toast.relay.saved` / `healed` stay for later touches. `m1.relay1` (above) replaces the WS1-W1 text "Wake the relay at the road bend".
- `notice.relay` lines 2-3 are the script's one sentence split to fit 38.

### q07 Not Alone (CH1-W4)

Graph: `fen.meet` -> choice 1 -> `fen.who` | `fen.startled` -> `fen.ask` ... -> choice 2 -> `fen.things` | `fen.boars` -> `fen.aether` ... -> choice 3 -> `fen.chart` | `fen.nothing` -> `fen.signal` ... -> `fen.end` (sets `s.fen.met`). Every choice rejoins, so no script line is lost on the "ask" path. A key with (1), (2) ... changes node at every change of speaker.

| key | who | text | chars |
|---|---|---|---|
| `fen.meet` (1) | FEN | `By the old stones...` | 19 |
| `fen.meet` (2) | FEN | `Another person!` | 15 |
| `fen.meet` (3) | FEN | `I thought I was the only soul on this road!` | 43 |
| `fen.choice.who` | YOU (choice 1) | `Who are you?` | 12 |
| `fen.choice.startled` | YOU (choice 1) | `You startled me.` | 16 |
| `fen.who` | FEN | `Fen. Just Fen.` | 14 |
| `fen.startled` (1) | FEN | `Forgive me. You learn to hide out here.` | 38 |
| `fen.startled` (2) | FEN | `Fen, by the way. Just Fen.` | 26 |
| `fen.ask` (1) | FEN | `And you?` | 8 |
| `fen.ask` (2) | YOU | `Wick.` (alt `Just a lamp-trimmer.` 20) | 5 |
| `fen.ask` (3) | FEN | `Well met, Wick!` (alt `Well met, then!` 15) | 15 |
| `fen.ask` (4) | FEN | `It's good to hear a human voice again.` | 38 |
| `fen.ask` (5) | FEN | `Hold on...` | 10 |
| `fen.ask` (6) | FEN | `That coat. You're from Ferrum?` | 30 |
| `fen.ask` (7) | YOU | `Yes.` | 4 |
| `fen.ask` (8) | FEN | `How in the world did you get out?` | 32 |
| `fen.ask` (9) | YOU | `I borrowed an airship.` | 22 |
| `fen.ask` (10) | FEN | `Borrowed?` | 9 |
| `fen.ask` (11) | YOU | `It didn't survive.` | 18 |
| `fen.ask` (12) | FEN | `Ha! I suppose that explains the smoke.` | 38 |
| `fen.ask` (13) | FEN | `You picked a strange road to wander.` | 35 |
| `fen.ask` (14) | FEN | `These woods are beautiful, aren't they?` | 38 |
| `fen.ask` (15) | YOU | `More than I expected.` | 21 |
| `fen.ask` (16) | FEN | `Aye. But don't let that fool you.` | 33 |
| `fen.ask` (17) | FEN | `Not everything here is friendly.` | 32 |
| `fen.ask` (18) | FEN | `There are thieves on the western roads.` | 39 |
| `fen.ask` (19) | FEN | `And things in the old ruins...` | 30 |
| `fen.ask` (20) | FEN | `Things best left sleeping.` | 26 |
| `fen.choice.things` | YOU (choice 2) | `What kind of things?` | 20 |
| `fen.choice.boars` | YOU (choice 2) | `I've met the boars.` | 18 |
| `fen.things` | FEN | `Old guardians. Beasts. Stranger things.` | 38 |
| `fen.boars` | FEN | `Boars are the least of it, friend.` | 34 |
| `fen.aether` (1) | FEN | `This land still holds aether.` | 29 |
| `fen.aether` (2) | YOU | `Aether?` | 7 |
| `fen.aether` (3) | FEN | `Magic, Wick.` (alt `Magic, lad.` 11) | 12 |
| `fen.aether` (4) | YOU | `Magic isn't real.` | 17 |
| `fen.aether` (5) | FEN | `Is that what Ferrum teaches now?` | 32 |
| `fen.aether` (6) | YOU | `It's a children's tale.` | 23 |
| `fen.aether` (7) | FEN | `Then how did you wake that stone?` | 33 |
| `fen.aether` (8) | YOU | `I don't know.` | 13 |
| `fen.aether` (9) | FEN | `There's a great deal you don't know yet.` | 40 |
| `fen.aether` (10) | FEN | `But that's what makes a journey worth taking.` | 45 |
| `fen.aether` (11) | FEN | `What's that you've got?` | 23 |
| `fen.choice.chart` | YOU (choice 3) | `A sky-chart.` | 12 |
| `fen.choice.nothing` | YOU (choice 3) | `Nothing much.` | 13 |
| `fen.chart` | FEN | `And that line?` | 14 |
| `fen.nothing` | FEN | `Crown ink, and a pencil line. Not nothing.` | 42 |
| `fen.signal` (1) | YOU | `Something is sending a signal.` | 29 |
| `fen.signal` (2) | YOU | `Three short. Three long. Three short.` | 37 |
| `fen.signal` (3) | FEN | `A signal?` | 9 |
| `fen.signal` (4) | YOU | `From beyond the Wall.` | 20 |
| `fen.signal` (5) | FEN | `Well...` | 7 |
| `fen.signal` (6) | FEN | `I've seen a light on the far hills.` | 35 |
| `fen.signal` (7) | FEN | `Never knew what to make of it.` | 29 |
| `fen.signal` (8) | YOU | `I intend to find out.` | 21 |
| `fen.signal` (9) | FEN | `Then you'll want the river road.` | 32 |
| `fen.signal` (10) | FEN | `It leads to a ford, farther west.` | 33 |
| `fen.signal` (11) | FEN | `And beyond that, there are people.` | 34 |
| `fen.signal` (12) | YOU | `People?` | 7 |
| `fen.signal` (13) | FEN | `More than you'd think.` | 22 |
| `fen.signal` (14) | FEN | `Some might even welcome you.` | 27 |
| `fen.signal` (15) | FEN | `Just remember one thing.` | 23 |
| `fen.signal` (16) | YOU | `What?` | 5 |
| `fen.signal` (17) | FEN | `Out here, a friendly face means more` | 36 |
| `fen.signal` (18) | FEN | `than any fine coat or polished blade.` | 37 |
| `fen.signal` (19) | FEN | `Choose your friends carefully.` | 30 |
| `fen.end` (1) | YOU | `I'll remember.` | 14 |
| `fen.end` (2) | FEN | `Good.` | 5 |
| `fen.end` (3) | FEN | `May the old lights guide you, Wick.` (alt `... you, lad.` 34) | 34 |
| `fen.repeat` (1) | FEN | `The river road, Wick. West, to the ford.` (alt `The river road. West, to the ford.` 34) | 39 |
| `fen.repeat` (2) | FEN | `Mind the thieves. And mind the ruins.` | 37 |
| `fen.repeat` (3) | FEN | `May the old lights guide you.` | 28 |

Notes:
- Fen is a man now (D-062). VILLAGER-LINES-01 (Fen as a woman near Burl) stays superseded.
- "Then how did you wake that stone?" / "I don't know." still reads right with the crystal: Wick knows what he held up, not why it worked. That is canon's "he has no word for it yet". The line stays.
- `fen.nothing` echoes the Crown print `BEYOND THE WALL: NOTHING`, like the `NOT NOTHING` scrawl.
- New lines (not in the script): `fen.choice.startled`, `fen.startled`, `fen.choice.boars`, `fen.boars`, `fen.choice.nothing`, `fen.nothing`, `fen.repeat`.

### Chapter complete + journal (CH1-W5)

| key | who | text | chars |
|---|---|---|---|
| `chapter.card.title` | card | `CHAPTER COMPLETE` | 16 |
| `chapter.card.name` | card | `Beyond the Wall` | 15 |
| `chapter.card.next` | card | `Next chapter: The River and the Forgotten` (if a 38 cap applies: `Next: The River and the Forgotten` 33) | 41 |
| `quest.log.done.m1` | log | `Beyond the Wall` | 15 |
| `journalCh1.title` | note panel | `Pencil, on the back of the chart` | 32 |
| `journalCh1` (1) | note | `I thought the Wall kept the world out.` | 37 |
| `journalCh1` (2) | note | `` (empty row) | 0 |
| `journalCh1` (3) | note | `Now I wonder what it kept hidden.` | 33 |
| `journalCh1` (4) | note | `` (empty row) | 0 |
| `journalCh1` (5) | note | `A talking bear. Stones that shine without fire.` | 47 |
| `journalCh1` (6) | note | `A stranger who says magic is real.` | 33 |
| `journalCh1` (7) | note | `` (empty row) | 0 |
| `journalCh1` (8) | note | `And somewhere ahead, that same blinking light.` | 46 |
| `journalCh1` (9) | note | `` (empty row) | 0 |
| `journalCh1` (10) | note | `Three short. Three long. Three short.` | 37 |
| `journalCh1` (11) | note | `` (empty row) | 0 |
| `journalCh1` (12) | note | `Someone is still calling.` | 25 |
| `journalCh1` (13) | note | `- W.` | 4 |

Notes:
- The journal is the script's text, line for line, with one addition: the "W." signature from canon (his pencil notes are signed W.).
- Every line fits the note panel's 56-column wrap, so none of them wraps.
