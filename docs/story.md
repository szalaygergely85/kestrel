# Kestrel

Owner: Writer. Canon source: `docs/game-design.md` section 3 (D-011, incl. owner amendment 2 in `docs/decisions.md`). Updated: 2026-09-23. Replaces "ASCII Quest: Signal" and "Ember and Ash".

> **Hook:** They told you nobody lives beyond the Wall. Then someone out there started calling for help.

## 1. The story

**Ferrum.** The city climbs a hill in rings of stone and timber, and it runs on machines: brass, steam and gears. Up top the Crown keeps the airships, the gear-gates and the lamps that never gutter. Down in the Low Wards people haul coal, grease cogs and mend rope. Magic is a tale for children, and saying it too loudly gets you fined. Everyone knows the Wall Law: nobody leaves, because beyond the Wall no one survives. Out there is only the wild, the Hush.

**The signal.** Then one night a light blinks on the far horizon. Morse spells ALIVE. The old relay stones under the Low Wards start to hum along with it. The Crown says it is marsh-fire, and later says there was no light at all. It comes back every night anyway. If nobody lives out there, who is asking for help?

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
- **The map names** (sea, coast, mountains, lake, marsh, forests, river, map labels): see "Places on the chart (MAP-27)" at the end.

## 4. Relay-keeper's log (US-021, each line <= 60 chars)

```
Day 1. Relay cold. Wall says no one is out here. Liar.
The far tower blinks at night. Morse ALIVE.
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
2. **ALIVE pattern (D-112).** The light repeats Morse `.- .-.. .. ...- .`, the word ALIVE. The log, story and pulse animation use that same word.
3. **The log is old.** The keeper counted the same signal years ago. That hints the ALIVE signal is older than Wick's escape. It is kept vague on purpose, but it constrains the eventual reveal.
4. **Exile village name.** It is still unnamed. Candidate: **Outwall**.
5. **GDD section 3 is stale.** It still lists partial amnesia, the "Crown mages" and a handwritten map. The PO needs to update it to amendment 2: no amnesia, a machine-only Ferrum, magic real outside, and the map as a Crown sky-chart with Wick's pencil course.

## 7. M4 reveal candidates (for manager)

Per D-013 item 3. Each keeps "the ALIVE signal has been sending for years" and "nobody is there".

**A. The shut-out people.** The caller was built by the people who lived here before the Wall. When the Crown's founders sealed the gates, they left them outside to die, and the machine still repeats their last call. The Crown has always heard it, and the Wall exists so no one inside has to answer.
- Setups: relay glyphs older than Crown script (M2); the log line "They hear it. They choose not to." (M1, done); exiles' songs about "the ones before" (M3).

**B. The keeper's lamp.** The relay-keeper was an exile who found the dead caller and re-woke it years ago, hoping someone in Ferrum would come. He walked the line to keep it fed and never came back. The machine calls on alone, and now Wick is the one feeding it.
- Setups: the same hand in every log (M1-M3); a keeper's empty camp at one relay (M2); exiles remember "the lamp man" who went to the far tower (M3).

**C. The land is calling.** The crystals are one living web, and the ALIVE signal is the wild itself asking for help. Ferrum's lamps that never gutter burn stolen aether, and the drain is what turns beasts wrong. Nobody is at the source because the source is everywhere.
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

**3. The ALIVE signal and the jump (hope, not proof)**
- There is no signature in the signal. The logic is simple: nobody lives beyond the Wall, so a call for help from out there means *someone is alive*. If one person can be, then so can Maren. Wick has no proof, only hope.
- **The ambiguous detail:** the ALIVE signal makes the relay stones under the Low Wards hum, and those are the stones Maren was fined for saying *sing*. That doesn't prove anything, but Wick can't stop thinking about it.
- The call is old (canon), and nobody in Ferrum will say for how long. That leaves room to hope it started around the winter she disappeared.
- **Why alone, and why now:** telling anyone means telling the Crown, and the Low Wards only shrug that the dead don't signal. After a month of charting, Crown masons come down to mortar over the humming stones. That night, before the last thread to her is sealed, he cuts the *Kestrel* loose.

**4. Crash intro (~38 s, ends on the current wake)**
1. (4 s) Black screen. A far teal `*` pulses Morse ALIVE, and the stones below hum `~ ~ ~` in time with it.
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
- Section 1 "The signal" says "one night a light blinks". Canon says the ALIVE signal has been sending for years, so this should read that it was always there and one night it *ended differently*.
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
.- .-.. .. ...- .  STILL
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
.- .-.. .. ...- .  NO ONE YET
```
2. The pattern never changes:
```
.- .-.. .. ...- .
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

Superseded by v2 (D-111), see "Opening sequence v2" below.

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

## Opening sequence v2 (D-111, slideshow)

DRAFT, owner to approve. Eight stills, ~4 s each (~32 s), AI-generated and converted to real ASCII glyphs. One caption per still, 1-2 lines, each line <= 60 chars, ASCII only. Voice as before: Wick, first person, present tense, never named. His sister is "she" / "my sister" only; her name stays off screen (section 9.6). The last still hands off to the wake in the wreck.

Note on "one night": canon says the signal has sent for years. The caption says the night *he* sees it, not the night it starts.

**1.**
```
Ferrum. Rings of stone and brass, lamps that never gutter.
Inside, everyone knows: nobody lives beyond the Wall.
```
IMAGE: Ferrum at dusk from a high distance. Tiered rings of stone and timber climb a hill, amber lamps on every tier, steam plumes, and the dark ring of the Wall with no lights outside it.

**1b. (owner 2026-10-15: "shouldn't we have one before with the sister?"; draft caption by the PC-A main session, writer may polish)**
```
My sister trimmed the skyworks lamps. I carried her oil.
She said the old stones under the Wards could sing.
```
IMAGE: Dusk on the skyworks roof. A young woman from behind, in soft silhouette, trims a tall brass street lamp with shears; the boy (young Wick) from behind holds up her oil can. Warm, happy. Her face stays hidden (kept for a possible later reveal). The intro is now 9 stills, ~36 s.

**2.**
```
Seven winters ago my sister went up to the skyworks.
Her lamp came back trimmed and shuttered. She did not.
```
IMAGE: Close still life, cold grey morning light through a Low Wards window. A brass hand-lamp on a bare table, wick trimmed, shutter closed, one notice slip beside it reading FELL. No people.

**3.**
```
One night, far beyond the Wall, a light.
Short and long. A word. Again. Again.
```
IMAGE: Night from the skyworks roof, looking out over the Wall into black land. One tiny teal point on the far horizon; the only light past the Wall. Wick from behind at the roof edge, small in frame, face never shown.

**4.**
```
Morse. She taught me with a shuttered lamp.
In the shut Factory, where merchants once signalled.
```
IMAGE: Memory, warm and dim. Inside an empty merchant hall: dusty ledger shelves, a big shuttered signal lamp on a sill, its slats half open, one beam across the floor. Two children from behind at the sill, the taller girl working the shutter, the boy (young Wick) watching; no faces.

**5.**
```
It is one word: ALIVE.
The Crown says marsh-fire. Thirty nights, I map it.
```
IMAGE: Lamplit desk at night. A printed Crown sky-chart, a pencil line running off the printed edge toward a small star mark, the word ALIVE pencilled in the margin. Over Wick's shoulder as he hunches over the chart, pencil in hand, the far teal point in the window beyond.

**6.**
```
Midnight. A knife, a mooring rope, a Crown ship that
was never mine. The rope gives.
```
IMAGE: Skyworks mooring deck at midnight under amber lamps. The *Kestrel*, small brass gondola and patched envelope, straining on one rope. Wick from behind in the gondola, knife half through the rope, the city lamps beyond him.

**7.**
```
The Wall slides under me. Its lamps wake one by one.
Then the ballistae. A bolt through the envelope.
```
IMAGE: Over Wick's shoulder at the gondola rail, looking down at the Wall at night, a line of lamps flaring left to right, one ballista swung up, a bolt streak rising, canvas tearing at the top of frame.

**8.**
```
The burner roars. A broken tower opens like a mouth.
Stone, moss, brass. The map in my fist. Then nothing.
```
IMAGE: Falling, pre-dawn blue. A roofless round stone tower seen from above, mossy rim rushing up, burner glare white in the corner. Wick from behind clinging to the tilted gondola, chart in his fist, the opening below. Hard cut to black, then the wake.

"Then nothing" keeps the echo of the Crown print `BEYOND THE WALL: NOTHING`; the wake shows it is not nothing.

Why the shuttered lamp twice: a shutter is how you talk in Morse. Her lamp came back shuttered (section 9.2), and she taught him the code with a shuttered lamp. The image does the work; nobody says it.

**The Factory (lore, not on screen):** a shut merchant trading house in the Low Wards, from before the Wall Law, when caravans and river barges still went out. Its factors talked tower to tower with shuttered lamps. Children play in it; Maren took Wick there and taught him the code for fun. Old enough that nobody in Ferrum reads it any more, which is why only he sees a word in the light.

**Alternatives: the code's name**
1. **Morse** (D-112). Learned at the Factory; this supersedes the earlier code-name alternatives.
2. **Tally-light.** A clerk's word: lamps counting cargo, tower to tower.
3. **Barge-blink.** River-trade slang; warmer, more Low Wards.

**Alternatives: how "alive" is phrased (slide 5, line 1)**
1. `It is one word: ALIVE.` (chosen above)
2. `In the old code it means: STILL ALIVE.` - softer, sounds like a reply to a question.
3. `On the Factory ledgers that mark meant: crew alive.` - the caravan meaning (cargo lost, crew alive), so "alive" is his reading, not a fact.

ESCALATE TO MANAGER (proposals for `docs/game-design.md` section 3; not edited here):
1. **Signal meaning (resolved by D-112):** the light repeats Morse ALIVE, `.- .-.. .. ...- .`. Maren taught Wick with a shuttered lamp at the Factory. The word names no sender; M4 stays open.
2. **Motive:** add Maren (section 9, approved 2025-09-25) to canon: the vanished sister is why Wick flies. Her name stays off screen in M1.
3. **New place:** the Factory, a shut pre-Wall merchant house in the Low Wards where Wick learned the code from her.
4. **Hero on screen:** canon says "first-person, never seen". Owner decided (2026-10-15): the intro stills show Wick from behind / over the shoulder, face never shown. Add that exception to section 3.
5. **Crown's reading:** "The Crown denies it" becomes "the Crown calls it marsh-fire, then says there was no light". No change in substance.
6. **Section 9.3 trigger** (masons mortaring the humming stones): not in the slideshow. Keep as lore or drop; the slideshow does not need it.

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
| `scrawl.waystone` | Base of the waystone, half under moss | `.- .-.. .. ...- .  FURTHER ON` | 27 | The ALIVE signal pattern in the keeper's notation, pointing on along the line. It hints that the signal goes further without saying who sends it. |

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

ASCII only, lengths counted by hand. No line names Wick (D-013). The notes are unsigned and say nothing about who sends the ALIVE signal (M4 reason stays open).

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

**From the section 8 sample:** kept the ideas "check my ears for brass", "my grandmother was a cub", "sky-cub" and "the loud hill". Everything else is replaced. Section 8 stays as the old sample. The sample line "It asked for help then, too" is dropped because it gets too close to explaining the ALIVE signal.

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
| `note.keepLight.title` | note 0 | `A scrap, nailed up` | 18 |
| `note.keepLight` (1) | note 0 | `Up. Do not stay down here.` | 26 |
| `note.keepLight` (2) | note 0 | `` (empty row) | 0 |
| `note.keepLight` (3) | note 0 | `Climb the stair to the very top.` | 32 |
| `note.keepLight` (4) | note 0 | `A blade waits by the broken wall.` | 33 |
| `note.keepLight` (5) | note 0 | `` (empty row) | 0 |
| `note.keepLight` (6) | note 0 | `Do not go out without it.` | 25 |
| `note.steelHush.title` | note 1 | `A note by the sword` | 19 |
| `note.steelHush` (1) | note 1 | `To whoever finds this place:` | 28 |
| `note.steelHush` (2) | note 1 | `` (empty row) | 0 |
| `note.steelHush` (3) | note 1 | `The road beyond is no longer safe.` | 34 |
| `note.steelHush` (4) | note 1 | `Take the blade. You may need it.` | 32 |
| `note.steelHush` (5) | note 1 | `` (empty row) | 0 |
| `note.steelHush` (6) REWORD (QL-W1) | note 1 | `And if something follows you at dusk, do not run.` | 48 |
| `note.leave.title` | note 2 | `A note by the stair` | 19 |
| `note.leave` (1) | note 2 | `These stones are not as dead as they seem.` | 42 |
| `note.leave` (2) | note 2 | `` (empty row) | 0 |
| `note.leave` (3) | note 2 | `Do not stay here after dark.` | 28 |
| `note.leave` (4) REWORD (QL-W1) | note 2 | `Something walks the woods at night.` | 35 |
| `note.leave` (5) | note 2 | `` (empty row) | 0 |
| `note.leave` (6) | note 2 | `Leave while there is still light.` | 33 |
| `bark.wick.sword` | YOU | `Better than empty hands.` | 24 |
| `prompt.door.unbar` | prompt | `[E] Pry the bar loose` | 21 |
| `toast.door.open` | toast | `The sword bites. The bar gives.` | 31 |
| `hint.burner` | story hint | `The burner ticks. The Kestrel is done.` | 38 |
| `hint.exit` | story hint | `The top. Look west through the breach.` | 38 |
| `hint.stone` REWRITE | story hint | `Someone hums on the hillside.` | 29 |

Notes:
- `note.keepLight` (PC-B writer, owner request 2026-10-10): the pinned scrap behind the wake spot gives the first quest. Same unknown writer as `note.steelHush`; it points up to the blade by the breach ("broken wall") without repeating that note. Key kept for the level prop; replaces the old KEEP THE LIGHT scrawl.
- `toast.door.open` (PC-B writer, owner-authorised while PC-A offline): fires once when `door.unbar` succeeds. `game/js/quest/doorUnbar.js` does not show it yet (code follow-up).
- The bar is jammed, not locked, so the sword is what pries it. That explains the `tower.sword.taken` gate without saying it.
- `hint.burner` replaces "Take what light you can." Suggested `skipIfState`: `tower.sword.taken`, so it stays quiet on the way back down. That is a code choice for CH1-02.
- `hint.exit` no longer says the breach is a way out or that the chapter ends there. The scrawl `NOT NOTHING` stays on the breach parapet, where it now marks the overlook.
- `hint.stone` (`storyHints.stone`, zone `hintStone`; PC-B writer, owner-authorised; PO-CH1-06): was "A stone stands below. Go to it." That sent the player past Burl into the boars before the chain allows the stone. Now it fires on the first terrain step after the door and points at Burl, the next one to see (he hums among his berries), without naming him.
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
| `toast.crystal.found` | toast | `A teal crystal lay under the last boar.` (PC-B writer, owner-authorised; PO-CH1-13, replaces `A crystal glints where the boar fell.`) | 32 |
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
| `bear.following` | BURL | `Keep up, sky-cub. The stone won't come to us.` | 45 |
| `bear.wait` | BURL (bark) | `Easy, sky-cub. These are old legs.` | 34 |
| `bear.stone.again` (1) | BURL | `The stone won't wake itself, sky-cub.` | 37 |
| `bear.stone.again` (2) | BURL | `Hold that crystal up to the carved mark.` (kept) | 40 |

`bear.wait` and `bear.stone.again` (PC-B writer, owner-authorised; PO-CH1-14): `bear.wait` is the escort bark when the player gets > 12 m ahead, repeating every 20 s at most. One line (the bark format plays its array as a sequence, not as variants), so it stays short and wry. `bear.stone.again` line 1 replaces the programmer's "Go on, sky-cub." (too close to `bear.departing`).

OPEN (PO-CH1-13, needs PO/programmer): the toast now says Burl GIVES the crystal, but `game/js/quest/crystal.js` still grants it at quest READY (last boar, burst at the corpse), and `bear.q.ready` lines 4-7 still say "It was under the last boar." For the gift to read right, the grant should move to `q.burl.boars.handin` (no corpse burst), and `bear.q.ready` (4)-(7) become, keeping the node shape BURL / YOU / BURL:
- (4) BURL `Here. This is what they were rooting for.` (41)
- (5) YOU `It's warm. And it glows.` (24)
- (6) BURL `No use to a bear. Keep it close.` (32)
- (7) BURL `Old stones like that light.` (27)
Not yet applied to `bear.dialogue.json` so the current build stays consistent.

`bear.following` (PC-B writer, owner-authorised while PC-A offline): talking to Burl while `s.burl.follow` is set and before he arrives. One line, no flags. Replaces the "NEEDS WRITER" line in `content/dialogue/bear.dialogue.json`.

| Key | Speaker | Text | Chars |
|---|---|---|---|
| `bear.early` (1) | BURL | `Out of the tower already, sky-cub? Empty-pawed?` | 47 |
| `bear.early` (2) | BURL | `Climb back up. The top holds more than a view.` | 46 |

| Key | Speaker | Text | Chars |
|---|---|---|---|
| `bear.blade.wait` (1) | BURL | `The tower's not done with you yet, sky-cub.` | 43 |
| `bear.blade.wait` (2) | BURL | `Finish up there. I'll be here. Bears keep.` | 42 |

`bear.blade.wait` (PC-B writer, owner-authorised): entry for `q.tower.blade.active` (note read or sword taken, blade quest not finished). Dry nudge back to the tower; names neither the blade nor the player. End node, no flags. Replaces the "NEEDS WRITER" placeholder.

`bear.early` (PC-B writer, owner-authorised): the fallback entry, talking to Burl before `q.tower.blade.ready` (the blade is not taken yet). Nudges the player back up the tower, echoing `note.keepLight` ("Climb the stair to the very top") without naming the blade or the player. End node, no flags. Replaces the "Come back when you've found your feet." placeholder.

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
| `bear.stone` (18) REWRITE | BURL | `Hold that crystal up to the carved mark.` | 40 |
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

**Stage note (not on screen; replaces "Wick raises the Kestrel's lamp"; no bowl, D-064):** Wick holds the teal crystal up to the carved mark on the stone's face. A low hum rises from deep in the stone. Teal light runs from his hand into the mark and spreads through the stone, lighting old marks under the moss. The crystal in his hand stays whole and warm, so it is not spent.

Notes:
- `bear.stone` (18) replaces "Try bringing your lamp closer." Its last node sets `bear.stone.told`.
- `bear.stone` (18) (PC-B writer, owner-authorised; PO-CH1-05): was "Try holding that crystal to the bowl." The waystone has no bowl (D-064); the line now names the carved mark and matches the prompt `[E] Hold up the crystal`.
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
| `hint.relay.nocrystal` | toast | `Cold stone. Your hands are not enough.` | 38 |

`hint.relay.nocrystal` (PC-B writer, owner-authorised while PC-A offline): E on a dormant relay or the dormant meadow Waystone without `aether.attuned`. Used for both kinds, so it says "stone", not "relay". It hints that an object is needed without naming the crystal the player may not have yet. Replaces the placeholder `hint.relay.nocrystal.PLACEHOLDER` / "The relay stays dark." in `game/js/quest/relayWake.js`.

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
| `fen.signal` (2) | YOU | `ALIVE. In Morse.` | 16 |
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
| `journalCh1` (6) REWRITE | note | `A crystal that wakes the old stones.` | 35 |
| `journalCh1` (7) | note | `` (empty row) | 0 |
| `journalCh1` (8) | note | `And somewhere ahead, that same blinking light.` | 46 |
| `journalCh1` (9) | note | `` (empty row) | 0 |
| `journalCh1` (10) | note | `ALIVE. In Morse.` | 16 |
| `journalCh1` (11) | note | `` (empty row) | 0 |
| `journalCh1` (12) | note | `Someone is still calling.` | 25 |
| `journalCh1` (13) | note | `- W.` | 4 |

Notes:
- The journal is the script's text, line for line, with one addition: the "W." signature from canon (his pencil notes are signed W.).
- Every line fits the note panel's 56-column wrap, so none of them wraps.
- `journalCh1` (6) (PC-B writer, owner-authorised; PO-CH1-03): was "A stranger who says magic is real." Fen is removed (D-064), so the chapter now ends on the crystal and the stones it woke, last of them the Bend Relay.

## Quest line Ch1-2 (QL-W1, PC-B writer, 2026-10-11)

Moved from `docs/questline-2026-10-10.md` (ratified, D-065) and finished. This section is now the text source; the questline doc keeps only the design. ASCII only, lengths counted by hand (text only, no speaker label). Limits: dialogue / note lines <= 56, choices <= 40, HUD / objective / toast / item desc <= 38, prompts <= 24, journal titles <= 28. Speakers: `BURL`, `ROOK`, player `YOU`. No magic word, no "aether" on screen, nobody says "Wick", no Esc hints. Keys named `bark.wick.*` are ids only; the name never shows.

### Journal titles (J log, `quest.<id>.title`)

All six quests in `content/quests/` already carry a `title` (checked 2026-10-11; no JSON change needed). Titles for the new rows, to paste when their JSON is written:

| key | text | chars |
|---|---|---|
| `quest.mq.bend.call.title` | `The Call Carries` | 16 |
| `quest.mq.ford.mirror.title` | `The Missing Glass` | 17 |
| `quest.mq.smoke.title` | `Smoke in the North` | 18 |
| `quest.sq.wreck.plate.title` | `Gondola Plate` | 13 |
| `quest.sq.rook.shiny.title` | `Shiny Things` | 12 |
| `quest.sq.honey.title` | `Honey for a Crow` | 16 |
| `quest.sq.rook.caps.title` | `Red Caps` | 8 |
| `quest.sq.packet.title` | `The Oilcloth Packet` | 19 |
| `quest.sq.straw.title` | `Three Straw Men` | 15 |
| `chapter2.card.name` | `The River and the Forgotten` | 27 |

Existing (kept): `m1` Beyond the Wall, `tower.blade` A Blade in the Ashes, `burl.boars` Boars in the Woods, `sq.burl.blue` The Blue Ones, `mq.river.road` The River Road, `mq.ford.stones` Stones in the Water.

### HUD objectives (all <= 38)

| key | text | chars |
|---|---|---|
| `mq.bend.call.1` | `Watch the relay light` | 21 |
| `mq.bend.call.2` | `Look at the knot on the mount` | 29 |
| `mq.bend.call.3` | `Go back to Rook` | 15 |
| `mq.river.road` | `Follow the road to the river` | 28 |
| `mq.ford.stones` | `Cross the stepping stones` | 25 |
| `mq.ford.mirror.1` | `Ask Rook about the cold relay` | 29 |
| `mq.ford.mirror.2` | `Take the glass from Rook's nest` | 31 |
| `mq.ford.mirror.3` | `Wake the Ford Relay` | 19 |
| `mq.smoke.1` | `Look at the mark on the relay` | 29 |
| `mq.smoke.2` | `Follow the footpath north` | 25 |
| `sq.burl.blue.1` | `Pick six blue sprigs` | 20 |
| `sq.burl.blue.2` | `Bring the sprigs to Burl` | 24 |
| `sq.wreck.plate.1` | `Find hide for a strap` | 21 |
| `sq.wreck.plate.2` | `Bring the hide to the gondola` | 29 |
| `sq.rook.shiny.1` | `Find four brass scraps` | 22 |
| `sq.rook.shiny.2` | `Bring the brass to Rook` | 23 |
| `sq.honey` | `Bring Burl's honeycomb to Rook` | 30 |
| `sq.rook.caps.1` | `Pick five red caps by the river` | 31 |
| `sq.rook.caps.2` | `Bring the caps to Rook` | 22 |
| `sq.packet` | `Leave the packet at the ford post` | 33 |
| `sq.straw` | `Hit the three straw men` | 23 |

`sq.burl.blue` says six to match the built JSON (`berry1..6`, count 6). If MAP-21 places only five, change "six"/"Six" in `sq.burl.blue.1`, `burl.blue.offer` (3) and `bear.blue.active` to five; nothing else changes.

### mq.bend.call "The Call Carries" (Ch1 close)

| key | who | text | chars |
|---|---|---|---|
| `bark.wick.relayPulse` | YOU | `It's blinking. The same word: ALIVE.` | 35 |
| `bark.wick.relayPulse2` | YOU | `It's passing the call along.` | 28 |
| `prompt.knot` | prompt | `[E] Look at the knot` | 20 |
| `note.knot.title` | note | `A knot on the brass` | 19 |
| `note.knot` (1) | note | `A skyworks hitch. Lamp-trimmers tie it.` | 39 |
| `note.knot` (2) | note | `Pulled tight. Weathered grey. Years old.` | 40 |
| `rook.name` | label | `Rook` | 4 |
| `rook.meet` (1) | ROOK | `Ha. The fell-bird walks.` | 24 |
| `rook.meet` (2) | YOU | `...You talk too.` | 17 |
| `rook.meet` (3) | ROOK | `Talk. Count. Keep. Crows do all three.` | 38 |
| `rook.meet` (4) | ROOK | `Rook, the others call me.` | 25 |
| `rook.meet` (5) | ROOK | `Your stone blinks now. Like the far one.` | 40 |
| `rook.meet` (6) | YOU | `It's passing the call along. Toward home.` | 41 |
| `rook.meet` (7) | ROOK | `The loud hill? The loud hill never listens.` | 43 |
| `rook.meet` (8) | ROOK | `Watch it blink. Count. Then see the knot.` | 41 |
| `rook.call.active` | ROOK | `Count the blinks. Then the knot. Then me.` | 41 |
| `rook.call.ready` (1) | ROOK | `Counted? Thirteen blinks, then quiet. Again.` | 44 |
| `rook.call.ready` (2) | YOU | `That knot. A lamp-trimmer tied it.` | 34 |
| `rook.call.ready` (3) | ROOK | `Long ago. Nobody untied it. I tried.` | 36 |
| `rook.call.ready` (4) | ROOK | `Here. Paper. River on it. Not shiny.` | 36 |
| `rook.call.ready` (5) | ROOK | `West is the river. The next stone is cold.` | 42 |
| `rook.call.ready` (6) | ROOK | `I will be there first. Wings.` | 29 |
| `rook.repeat` | ROOK | `River. West. Do not drown, fell-bird.` | 37 |
| `toast.chart.river` | toast | `Chart piece: the river and the ford.` | 36 |

Notes: `rook.meet` gives the quest (main quest, no choice). `rook.call.ready` is the hand-in; its last node grants `chart.river` and plays the Ch1 chapter card (`journalCh1` unchanged). The knot is the Maren hook (section 9.5); nobody names her. "Thirteen blinks" = the 13 marks of Morse ALIVE (D-112).

### Chapter 2 main

| key | who | text | chars |
|---|---|---|---|
| `bark.wick.river` | YOU | `Water. Loud as the steam mains.` | 31 |
| `rook.ford` (1) | ROOK | `Slow walker. Wet boots?` | 23 |
| `rook.ford` (2) | YOU | `The relay here is dead. Its glass is gone.` | 42 |
| `rook.ford` (3) | ROOK | `Gone? No. Kept. Kept is different.` | 34 |
| `rook.ford` (4) | YOU | `You took it.` | 12 |
| `rook.ford` (5) | ROOK | `It fell. I found it. Then it was mine.` | 38 |
| `rook.ford` (6) | ROOK | `Old house by the crossing. Inside.` | 34 |
| `rook.ford` (7) | ROOK | `I have other shinies. Many.` | 27 |
| `rook.mirror.active` | ROOK | `Old house by the crossing. Look inside.` | 39 |
| `rook.mirror.done` (1) | ROOK | `It blinks. Like Bend. Like the far one.` | 39 |
| `rook.mirror.done` (2) | ROOK | `My glass, your stone. A fair loan.` | 34 |
| `rook.ford.repeat` | ROOK | `North, smoke. Fires. People, maybe. Go look.` | 44 |
| `rook.ford.repeat2` | ROOK | `Wet boots, full pack. Still a slow walker.` | 42 |
| `hint.relay.nomirror` | toast | `The mount is empty. Glass is missing.` | 37 |
| `item.relay.mirror` | item | `Relay Glass` / `Round, silvered, scratched by claws.` | 11 / 35 |
| `place.relay.ws_ford` | toast title, save slot, map label | `Ford Relay` | 10 |
| `notice.relayFord.title` | notice | `FORD RELAY AWAKENED` | 19 |
| `prompt.fordMark` | prompt | `[E] Look at the mark` | 20 |
| `note.fordMark.title` | note | `A mark cut in the base` | 22 |
| `note.fordMark` (1) | note | `Three rings and a line through them.` | 36 |
| `note.fordMark` (2) | note | `The same mark as the stones under the Wards.` | 44 |
| `note.fordMark` (3) | note | `The ones that hum.` | 18 |
| `bark.wick.smoke` | YOU | `Smoke. Cookfires. Out here?` | 27 |
| `chapter2.card.name` | card | `The River and the Forgotten` | 27 |
| `journalCh2.title` | note panel | `Pencil, under the river` | 23 |
| `journalCh2` (1) | note | `The relays are not lamps. They are a voice.` | 43 |
| `journalCh2` (2) | note | `` (empty row) | 0 |
| `journalCh2` (3) | note | `Someone built a line to reach the city.` | 39 |
| `journalCh2` (4) | note | `Ferrum stopped answering.` | 25 |
| `journalCh2` (5) | note | `` (empty row) | 0 |
| `journalCh2` (6) | note | `North of the ford, smoke. People.` | 33 |
| `journalCh2` (7) | note | `If people live out here, so could she.` | 38 |
| `journalCh2` (8) | note | `- W.` | 4 |

Rook entry order at the ford: `rook.caps.*` / `rook.shiny.*` / `rook.honey.done` states first, then `rook.ford` (mirror available), `rook.mirror.active`, `rook.mirror.done` (once, right after the wake), `rook.ford.repeat` (until `mq.smoke` done), `rook.ford.repeat2`. At the Bend (Ch1): `rook.meet`, `rook.call.active`, `rook.call.ready`, then `rook.repeat`.

### Burl back home (QL-05)

| key | who | text | chars |
|---|---|---|---|
| `bear.home` (1) | BURL | `There you are. I took the long way home.` | 41 |
| `bear.home` (2) | BURL | `The stone hums all night now. I sleep better.` | 45 |
| `bear.home` (3) | BURL | `Sit a while, sky-cub. Mind the blue ones.` | 41 |
| `burl.blue.offer` (1) | BURL | `The boars trampled half my bushes, sky-cub.` | 43 |
| `burl.blue.offer` (2) | BURL | `The blue sprigs by the north trees still stand.` | 47 |
| `burl.blue.offer` (3) | BURL | `Six would do. Don't eat any. I'll know.` | 39 |
| `bear.blue.accepted` | BURL | `Blue ones. North trees.` (as built) | 23 |
| `bear.blue.active` | BURL | `Blue ones. North trees. Six. I'm counting.` | 42 |
| `burl.blue.done` (1) | BURL | `Oh, look at them. Not one nibbled.` | 34 |
| `burl.blue.done` (2) | BURL | `A cloak was on my slope. Smells of smoke.` | 41 |
| `burl.blue.done` (3) | BURL | `Yours, I think. Nights get cold, sky-cub.` | 41 |
| `bear.blue.after` | BURL | `Warm enough? The nights out here bite.` | 38 |
| `burl.honey.offer` (1) | BURL | `That crow on the old stone. Loud thing.` | 39 |
| `burl.honey.offer` (2) | BURL | `Take it this comb. Tell it we're square.` | 40 |
| `bear.honey.active` | BURL | `Give the crow the comb. Then we're square.` | 42 |

`bear.home` plays once, the first talk after `s.burl.home` (sets `s.burl.home.met`), then flows into `burl.blue.offer` if that is available. It does not say where she went or how long it took.

### Side quest texts

| key | who | text | chars |
|---|---|---|---|
| `prompt.gondola` | prompt | `[E] Look at the gondola` | 23 |
| `note.gondola` (1) | note | `The side plate hangs by one rivet.` | 34 |
| `note.gondola` (2) | note | `Bent round. Light. A strap would hold it.` | 41 |
| `note.gondola.done` | note | `Hide strap, brass plate. A buckler now.` | 38 |
| `toast.buckler` | toast | `Brass Buckler. Hold {block} to block.` (`{block}` = binding label, e.g. `RMB` -> 33) | 33 |
| `rook.shiny.offer` (1) | ROOK | `Your sky-boat dropped shinies. Everywhere.` | 42 |
| `rook.shiny.offer` (2) | ROOK | `Four brass bits. Bring them. I trade fair.` | 42 |
| `rook.shiny.active` | ROOK | `Four brass bits. Your sky-boat sheds them.` | 42 |
| `rook.shiny.done` (1) | ROOK | `One, two, three, four. Good count.` | 34 |
| `rook.shiny.done` (2) | ROOK | `A bow, from the river. Not shiny. Yours.` | 40 |
| `toast.bow` | toast | `Hunter's Bow and ten arrows.` | 27 |
| `rook.honey.done` (1) | ROOK | `Sticky. From the bear? Hm. Square, then.` | 40 |
| `rook.honey.done` (2) | ROOK | `Sticks with feathers. Hunters lose them.` | 40 |
| `rook.honey.done` (3) | ROOK | `And this. On a branch. Fits a fell-bird.` | 40 |
| `rook.caps.offer` | ROOK | `Red caps grow by the water. Five. I'm hungry.` | 45 |
| `rook.caps.active` | ROOK | `Red caps. By the water. I am still hungry.` | 42 |
| `rook.caps.done` | ROOK | `Red, red, red, red, red. Take this. Warm stone.` | 46 |
| `prompt.packet` | prompt | `[E] Look at the packet` | 22 |
| `note.packet.title` | note | `Oilcloth, tied with twine` | 25 |
| `note.packet` (1) | note | `Stitched on the cloth: FOR THE FORD POST.` | 41 |
| `note.packet` (2) | note | `It has waited here a long time.` | 31 |
| `prompt.post` | prompt | `[E] Look at the post` | 20 |
| `note.post` (1) | note | `A basket on a post. Arrows inside, and a tag:` | 45 |
| `note.post` (2) | note | `TAKEN. LEAVE WHAT YOU CAN SPARE.` | 32 |
| `toast.packet.left` | toast | `Packet left. Arrows taken. Fair trade.` | 38 |
| `note.straw` (1) | note | `Three straw men. Three arrows. Three hits.` | 42 |
| `note.straw` (2) | note | `The quiver under the post is for whoever can.` | 45 |
| `toast.straw.done` | toast | `Three hits. The quiver is yours.` | 32 |

The `TAKEN` tag is fresh, unsigned handwriting: the second sign of people after the smoke. It names nobody.

### Items (name / desc <= 38)

| key | name | desc | chars |
|---|---|---|---|
| `item.heart.piece` | `Heart Piece` | `A warm red stone. Four make a heart.` | 36 |
| `item.cloak` | `Smoke-Grey Cloak` | `Wool, singed at the hem. Warm.` | 30 |
| `item.hood` | `Rook's Hood` | `Dark cloth, one black feather sewn in.` | 38 |
| `item.boots` | `River Boots` | `Greased leather. Wet stones, sure feet.` | 38 |
| `item.tunic` | `Wayfarer Tunic` | `Patched twice. Left for the next one.` | 37 |
| `item.buckler` | `Brass Buckler` | `Kestrel plate on a boar-hide strap.` | 35 |
| `item.bow` | `Hunter's Bow` | `Ash wood, river-damp. Still true.` | 33 |
| `item.arrow` | `Arrow` | `Grey-fletched. Pick them up again.` | 34 |
| `item.quiver` | `Big Quiver` | `Room for twenty more.` | 21 |
| `item.honeycomb` | `Honeycomb` | `Sticky. One corner already licked.` | 34 |
| `item.packet` | `Oilcloth Packet` | `Tied with twine. For the ford post.` | 35 |
| `item.redcap` | `Red Cap` | `A river mushroom. Crows love them.` | 34 |
| `item.berry.blue` | `Blue Sprig` | `Burl's favourite. Do not eat it.` | 32 |
| `item.brass.scrap` | `Brass Scrap` | `A bent rivet plate from the Kestrel.` | 36 |
| `item.chart.river` | `Chart Piece` | `The river, the ford, a crossing road.` | 37 |

### No dungeon: tower note rewording (D-065)

`note.leave` (4) and `note.steelHush` (6) in "q01 A Blade in the Ashes" above now point outside (marked REWORD). Old: `Something moves beneath the tower.` / `And if you hear something below, do not answer.` New: `Something walks the woods at night.` / `And if something follows you at dusk, do not run.` Paste needed in `design/models/notes.js` (designer/programmer; the writer does not edit design data).

### The Sealed Gate (locked, inspect)

| key | where | text | chars |
|---|---|---|---|
| `place.sealedGate` | map label, toast title | `The Sealed Gate` | 15 |
| `prompt.sealedGate` | prompt | `[E] Look at the gate` | 20 |
| `note.sealedGate.title` | note | `A gate across the pass` | 22 |
| `note.sealedGate` (1) | note | `Iron bars. A lock the size of a fist.` | 37 |
| `note.sealedGate` (2) | note | `` (empty row) | 0 |
| `note.sealedGate` (3) | note | `The keyhole is clean. No rust in it.` | 36 |
| `note.sealedGate` (4) | note | `Someone still keeps a key.` | 26 |
| `hint.sealedGate` | toast, push / repeat E | `Locked. The bars do not even rattle.` | 36 |

The clean keyhole says the gate is used, not who uses it. Nothing names what lies beyond (Part II).

## Places on the chart (MAP-27, PC-B writer, 2026-10-11)

The Crown chart prints nothing beyond the Wall, so every name here is what ends up pencilled on it. Plain names, the way a Low Ward hand names a mast by where it stands. Approved/proposed names from `docs/world-map-2026-10-11.md` are kept; this adds only the missing ones (marked NEW). Map labels <= 16, ASCII.

| feature | label key | label | chars | note |
|---|---|---|---|---|
| sea (south) NEW | `map.label.sea` | `The Quiet Sea` | 13 | Ferrum has never heard it. |
| river NEW | `map.label.river` | `The Braid` | 9 | It plaits round the stones at the ford; a rope-mender's word. |
| river mouth NEW | `map.label.estuary` | `Braidmouth` | 10 | The estuary at (1180,1725). |
| river source | `map.label.tarn` | `Highspring Tarn` | 15 | |
| sand coast | `map.label.strand` | `The Long Strand` | 15 | |
| cliff coast (west) NEW | `map.label.cliffs` | `The Shearcliffs` | 15 | Replaces "The Heath coast (P)"; Gull Cove and Signal Head stay. |
| north range | `map.label.whitecombs` | `The Whitecombs` | 14 | |
| west range | `map.label.fells` | `The West Fells` | 14 | |
| highest peak | `map.label.oldPale` | `Old Pale` | 8 | |
| lake | `map.label.lake` | `Glasswater` | 10 | |
| marsh | `map.label.marsh` | `The Reedmire` | 12 | |
| pine forest | `map.label.northwood` | `Northwood` | 9 | |
| old twisted wood | `map.label.thornwood` | `The Thornwood` | 13 | |
| broadleaf belts NEW | `map.label.hollins` | `The Hollins` | 11 | The heartland woods on both banks (hollin = holly). |
| downs | `map.label.downs` | `The Downs` | 9 | |
| burnt heath | `map.label.ashMile` | `The Ash Mile` | 12 | |
| alpine meadows | `map.label.pastures` | `High Pastures` | 13 | |
| fishing village | `map.label.gullhaven` | `Gullhaven` | 9 | |
| signal hill | `map.label.signalHill` | `Signal Hill` | 11 | |
| sea cape | `map.label.signalHead` | `Signal Head` | 11 | |
| the gate | `place.sealedGate` | `The Sealed Gate` | 15 | |
| the wall | `map.label.wall` | `Ferrum's Wall` | 13 | |
| the city | `map.label.ferrum` | `Ferrum` | 6 | |
| tower | `map.label.tower` | `The Watchtower` | 14 | Short form of the Hollow Watchtower. |
| crossroads | `map.label.crossroads` | `The Crossroads` | 14 | |
| Bend relay | `place.relay.ws_roadBend` | `Bend Relay` | 10 | existing |
| Ford relay | `place.relay.ws_ford` | `Ford Relay` | 10 | |
| village (stage 3) | `map.label.outwallSmoke` | `Cookfire Smoke` | 14 | Until M3 names the village (GDD 3: unnamed in M1/M2); never show "Outwall" before that. |

Owner question OQ-MAP-1 (the (P) names) still applies to all names above; none of them is canon until approved.

## Ch1-2 errands (QL-B1)

PC-B writer, 2026-10-11. Text for the 21 side errands in `content/quests/ch12/pack.json` (pasted there already: `title`, step `objText`, `returnText`, `lines.{offer,active,ready,done}` per architecture 38.44). ASCII only. Limits: title <= 28, HUD objective / returnText <= 38, lines <= 56. `ready` plays at the hand-in site (`turnIn`, else the giver); the other three at the giver.

Voices: **Burl** (she) warm, slow, "sky-cub". **Relays** a clockwork ticker in caps: TICK, HELD, LOGGED, LINE HOLDS. It never explains itself, never names a builder or the signal, and reads the same whether the relay is lit or still dark (the Ford Relay can be talked to before its glass returns). **Post / note post** are written tags and what the player sees; the hand is fresh and unsigned (same hand as `note.post`'s TAKEN tag), naming nobody.

Title changes: `sq.burl.hint` "The Writing Stone" -> `The Hill Path` (no writing stone exists; zone `hintStone` is the hillside below the tower door, terrain-shaped). `sq.fc.smoke` "Smoke Watch" -> `North Watch` (keeps the smoke reveal for `mq.smoke` / `bark.wick.smoke`). `sq.fc.cross` "The Crossroads Arm" -> `The Crossroads Report`. Others kept.

Straw reward is 20 arrows (no Big Quiver). Replaces in "Side quest texts": `note.straw` (2) -> `The bundle under the post is for whoever can.` (45); `toast.straw.done` -> `Three hits. The bundle is yours.` (32). `item.quiver` is unused.

| key | who | text |
|---|---|---|
| **sq.tm.nub** title | | `Where's Nub?` |
| obj 1 / 2 / 3 | HUD | `Look for small tracks by the stone` / `Follow the tracks to the tower door` / `Follow the wet prints down the road` |
| return | HUD | `Tell Burl where the tracks went` |
| offer | BURL | `Have you seen my Nub? Small. Round. Never listens.` / `He was by the waystone at sunup. Then he wasn't.` / `Take this. A hunter left it on my slope, long ago.` / `A bow sees further than a bear. Find his tracks.` (bow + 10 arrows given here; `toast.bow`) |
| active | BURL | `Small tracks, sky-cub. Smaller than mine. Follow them.` |
| ready | BURL | `Down the road west? All that way, on those legs.` / `...Smell that? Wet cub. He came home behind you.` / `He followed your tracks while you followed his.` / `For your trouble. It was in his mouth. Still warm.` |
| done | BURL | `Nub sleeps. Sleeps! First time in three days.` |
| **sq.burl.boars.n** title | | `The North Boars` |
| obj / return | HUD | `Drive off the three north boars` / `Tell Burl the north is quiet` |
| offer | BURL | `More boars, sky-cub. Three, up by the north trees.` / `They smelled the empty slope and came back for it.` |
| active | BURL | `Three. North trees. Listen for the chewing.` |
| ready | BURL | `Quiet up north. I can hear the bees again.` / `Here. Red, and bitter. It mends what tusks tear.` |
| done | BURL | `North is quiet. West, though. Hear that?` |
| **sq.burl.boars.w** title | | `The West Boars` |
| obj / return | HUD | `Drive off the two west boars` / `Tell Burl the west is quiet` |
| offer | BURL | `Two more, down the west side. Young ones, loud.` / `Young is not slow. Mind your feet.` |
| active | BURL | `Two, west side. Loud. You won't miss them.` |
| ready | BURL | `West is quiet. Only two, and so much noise.` / `Sticks with feathers. Hunters lose them everywhere.` |
| done | BURL | `West is quiet. The south slope still grunts.` |
| **sq.burl.boars.s** title | | `The South Boars` |
| obj / return | HUD | `Drive off the three south boars` / `Tell Burl the south is quiet` |
| offer | BURL | `Last of them. Three, on the south slope, by the rocks.` / `The big one leads. Don't let him get behind you.` |
| active | BURL | `South slope, by the rocks. Mind the big one.` |
| ready | BURL | `All of them! The whole slope is mine again.` / `A walker left this by the rocks. It fits you better.` |
| done | BURL | `No boars. Just bees, and berries, and a sky-cub.` |
| **sq.burl.meat** title | | `Meat for Winter` |
| obj / return | HUD | `Bring Burl a piece of boar meat` / `Give Burl the boar meat` |
| offer | BURL | `Berries are summer food. Winter wants fat.` / `Those boars owe me. Bring me a haunch, sky-cub.` |
| active | BURL | `A haunch. Boar. You know where they grunt.` |
| ready | BURL | `Mm. Still warm. The boars pay their rent at last.` / `Trade you. It's bitter, but it mends.` |
| done | BURL | `One haunch. Winter is long, sky-cub. But it's a start.` |
| **sq.burl.stone** title | | `Check on the Stone` |
| obj / return | HUD | `Go and look at the waystone` / `Tell Burl the stone hums` |
| offer | BURL | `The stone by the meadow hums at night now.` / `I don't go near it. Old habit. Go see it for me?` |
| active | BURL | `The stone. Put your paw on it. Your hand. Whichever.` |
| ready | BURL | `Warm, and humming. Like a hive in the ground.` / `I'll sleep near it, then. Here. Feathered sticks.` |
| done | BURL | `The stone hums. I hum back. Nobody minds.` |
| **sq.burl.hint** title | | `The Hill Path` |
| obj / return | HUD | `Walk the hill path below the tower` / `Tell Burl the hill path is clear` |
| offer | BURL | `The path down from your tower. The boars dug at it.` / `Walk it for me. Tell me if it still holds a foot.` |
| active | BURL | `The hill path, under your tower. Walk it.` |
| ready | BURL | `Holds, does it? Good. Old legs like a sure path.` / `A red one. For the bruises you didn't tell me about.` |
| done | BURL | `Path holds, stone hums. Good hill, this.` |
| **sq.burl.tower** title | | `Look at the Tower Door` |
| obj / return | HUD | `Look at the tower door` / `Tell Burl about the door` |
| offer | BURL | `You came out of the tower by its old door.` / `Something scratches at it at night. Go and look?` |
| active | BURL | `The tower door. Look low down, for the scratches.` |
| ready | BURL | `Claw marks, low down? Badgers. Rude, but not boars.` / `Feathered sticks. You use them better than I do.` |
| done | BURL | `Badgers at the door. You could do worse for neighbours.` |
| **sq.burl.scout** title | | `Scout the River` |
| obj 1 / 2 / return | HUD | `Walk down to the river bank` / `Find the stones at the ford` / `Tell Burl about the river` |
| offer | BURL | `West, past the bend, there's a river. Loud water.` / `I haven't seen it since I was a cub. Is it still there?` |
| active | BURL | `The river. West. You'll hear it before you see it.` |
| ready | BURL | `Still there. Still loud. Good. Some things should stay.` / `Someone left this on my slope once. It fits a walker.` |
| done | BURL | `Loud water, stones to cross. Don't fall in, sky-cub.` |
| **sq.burl.ask** title | | `Word from the Crossroads` |
| obj / return | HUD | `Read the note post at the crossroads` / `Tell Burl what the post says` |
| offer | BURL | `Birds say there's a post at the crossroads. With paper.` / `I can't read, sky-cub. Go and read it for me?` |
| active | BURL | `The post at the crossroads. Read it, then tell me.` |
| ready | BURL | `Straw men, and arrows? Someone out there practises.` / `Practising means staying. Here, sky-cub. A red one.` |
| done | BURL | `Someone at the crossroads. I hope they like berries.` |
| **sq.burl.walk** title | | `Walk Burl to the Bend` |
| obj / return | HUD | `Walk with Burl to the Bend Relay` / `Talk to Burl at the Bend Relay` |
| offer | BURL | `The bend stone blinks now, you say. I want to see it.` / `Old legs. Walk slow with me?` |
| active | BURL | `Slow, sky-cub. Bears don't hurry. Bears arrive.` |
| ready | BURL | `There. Blink, blink, blink. Like it's calling someone.` / `Thank you for the slow walk. Sticks, for your bow.` |
| done | BURL | `I'll sit here a while. Then the long way home.` |
| **sq.burl.parcel** title | | `Meat for the Basket` |
| obj / return | HUD | `Leave the meat in the post basket` / `Put the meat in the trade post basket` |
| offer | BURL | `There's a basket on a post, by the crossroads.` / `Whoever fills it feeds whoever comes. Take this meat.` / `Two haunches. I have more than one bear needs.` |
| active | BURL | `Two haunches, in the basket. Don't eat them on the way.` |
| ready | post (written) | `You lay the meat in the basket, under the tag:` / `TAKEN. LEAVE WHAT YOU CAN SPARE.` / `Beneath it, a bundle of arrows. Twine. Fresh knots.` |
| done | BURL | `Fed someone, did we? Good. The slope can spare it.` |
| **sq.post.spare** title | | `Leave What You Can Spare` |
| obj / return | HUD | `Carry three arrows to the note post` / `Leave the arrows at the note post` |
| offer | post (written) | `A second tag, tied under the first:` / `THREE ARROWS TO THE NOTE POST. FOR PRACTICE.` / `Three arrows lie beside it, set apart.` |
| active | post | `The tag sways: THREE ARROWS TO THE NOTE POST.` |
| ready | note post | `A clip on the post. You leave the three arrows in it.` / `In the clip already: a red draught, stoppered.` |
| done | post | `The basket waits. The tags turn in the wind.` |
| **sq.straw** title | | `Three Straw Men` |
| obj 1 / 2 / 3 | HUD | `Hit the first straw man` / `Hit the second straw man` / `Hit the third straw man` |
| return | HUD | `Take the bundle from the note post` |
| offer | note post | `Three straw men. Three arrows. Three hits.` / `The bundle under the post is for whoever can.` |
| active | note post | `Three straw men. Three hits. The bundle waits.` |
| ready | note post | `Three hits. Under the post, a bundle of arrows.` / `Twenty, tied with twine. Fresh knots.` |
| done | note post | `A new line on the tally. Yours, this time.` |
| **sq.rb.shield** title | | `Left at the Bend` |
| obj / return | HUD | `Wear the buckler to the ford` / `Show the buckler at the Ford Relay` |
| offer | BEND RELAY | `TICK. TICK-TICK. A drawer slides out of the mount.` / `HELD: ONE BUCKLER. LEFT FOR THE NEXT WALKER.` / `NO NAME. CARRY IT WORN. SHOW THE FORD.` (buckler given here; `toast.buckler`) |
| active | BEND RELAY | `TICK. BUCKLER WORN? FORD. WEST.` |
| ready | FORD RELAY | `TICK. BUCKLER SEEN. CARRIER LOGGED.` / `KEEP IT. ONE DRAUGHT, HELD FOR YOU.` |
| done | BEND RELAY | `TICK. CARRIER LOGGED AT THE FORD. LINE HOLDS.` |
| **sq.rb.regards** title | | `Word for Burl` |
| obj / return | HUD | `Carry the relay's word to Burl` / `Go back to the Bend Relay` |
| offer | BEND RELAY | `TICK. BEAR ON THE SLOPE. KNOWN.` / `MESSAGE: ROAD CLEAR. LIGHT HOLDS. CARRY IT.` |
| active | BEND RELAY | `TICK. MESSAGE FOR THE BEAR. NOT YET CARRIED.` |
| ready | BEND RELAY | `TICK. MESSAGE CARRIED. LOGGED.` / `FIVE ARROWS, HELD FOR YOU.` |
| done | BEND RELAY | `TICK. LINE QUIET. ALL WELL.` |
| `burl.regards.heard` (needs a Burl node on `talk.burl`; not in the pack schema) | BURL | `The stone sends word? Hm. Tell it the bear says hello.` |
| **sq.rb.road** title | | `Down the Road West` |
| obj 1 / 2 / return | HUD | `Walk back along the road` / `Come back to the Bend Relay` / `Report to the Bend Relay` |
| offer | BEND RELAY | `TICK. ROAD CHECK DUE. LAST CHECK: LONG AGO.` / `WALK TO THE OLD TURN. RETURN. REPORT.` |
| active | BEND RELAY | `TICK. ROAD CHECK OPEN. WALK. RETURN.` |
| ready | BEND RELAY | `TICK. ROAD CHECKED. LOGGED.` / `FIVE ARROWS, HELD FOR YOU.` |
| done | BEND RELAY | `TICK. NEXT ROAD CHECK: LONG FROM NOW.` |
| **sq.fc.ford** title | | `Wet Boots` |
| obj 1 / 2 / return | HUD | `Walk down to the river bank` / `Cross to the west bank` / `Report to the Ford Relay` |
| offer | FORD RELAY | `TICK. FORD STONES: UNCHECKED.` / `CROSS. COUNT THE STONES. RETURN.` |
| active | FORD RELAY | `TICK. FORD UNCHECKED. CROSS. RETURN.` |
| ready | FORD RELAY | `TICK. FORD CROSSED. WALKER WET.` / `DRY BOOTS, HELD FOR YOU. TAKE THEM.` |
| done | FORD RELAY | `TICK. FORD CHECKED. MIND THE MOSS.` |
| **sq.fc.smoke** title | | `North Watch` |
| obj / return | HUD | `Climb to the lookout north of the ford` / `Report to the Ford Relay` |
| offer | FORD RELAY | `TICK. NORTH WATCH DUE. NO WATCHER.` / `CLIMB. LOOK NORTH. RETURN. REPORT.` |
| active | FORD RELAY | `TICK. NORTH WATCH OPEN. CLIMB. LOOK.` |
| ready | FORD RELAY | `TICK. NORTH WATCH DONE. LOGGED.` / `TEN ARROWS, HELD FOR YOU.` |
| done | FORD RELAY | `TICK. NORTH WATCH LOGGED. LINE HOLDS.` |
| **sq.fc.cross** title | | `The Crossroads Report` |
| obj / return | HUD | `Walk the west road to the crossroads` / `Report to the Ford Relay` |
| offer | FORD RELAY | `TICK. CROSSROADS: NO REPORT IN YEARS.` / `WALK THERE. RETURN. REPORT.` |
| active | FORD RELAY | `TICK. CROSSROADS REPORT OPEN.` |
| ready | FORD RELAY | `TICK. CROSSROADS REPORTED. LOGGED.` / `ONE DRAUGHT, HELD FOR YOU.` |
| done | FORD RELAY | `TICK. ALL ROADS REPORTED. ALMOST.` |
| **sq.fc.again** title | | `Back Across` |
| obj / return | HUD | `Come back to the river bank` / `Report to the Ford Relay` |
| offer | FORD RELAY | `TICK. FORD CHECK, RETURN LEG. DUE.` / `CROSS BACK. RETURN. REPORT.` |
| active | FORD RELAY | `TICK. RETURN LEG OPEN. CROSS BACK.` |
| ready | FORD RELAY | `TICK. BOTH LEGS LOGGED. FORD SOUND.` / `TEN ARROWS, HELD FOR YOU.` |
| done | FORD RELAY | `TICK. FORD SOUND. WALKER SOUND. LINE HOLDS.` |

Notes:
- Nub never appears (no entity): he "came home behind you", so the quest needs no cub on screen. Nub is still on the roadmap's owner-OK list (quest-roadmap 2b); if the owner drops him, swap the name for "my cub" in five lines.
- `sq.burl.tower`: low claw marks are badgers. Nothing is behind the door (D-065, no dungeon).
- The buckler at the Bend is "left for the next walker, no name": the same unsigned kindness as the TAKEN tag. It does not say who.
- `sq.rb.road` area `roadWest` lies back toward the tower (m1 chain order), so the HUD says "back along the road", not "west"; the title is kept.
- Design flag: zone `hintStone` is terrain-shaped and `once`; if `used.world.hintStone` is already set, `sq.burl.hint` may never fire or complete at once. PO/architect to check.

## Ch1-2 errands batch 2 (QL-B2)

PC-B, 2026-10-11. 18 side errands in `content/quests/ch12/pack.json`. Voices: Burl warm ("sky-cub"), Rook dry and clever, relays terse TICK, notes written. Keys: `quest.<id>.title`, step objText, returnText, `lines.{offer,active,ready,done}`.

| id | title | HUD | return |
|---|---|---|---|
| sq.tm.gap | The Open Gate | Look at the gap in the meadow fence | Tell Burl about the fence |
| sq.tm.wood | The Woodcutter's Corner | Check the woodcutter's stack | Tell Burl the stack is dry |
| sq.tm.cart | The Cart on the Road | Look at the cart by the road | Tell Burl about the cart |
| sq.rb.lamps | Lamps on the Verge | Walk along the lamps by the road | Report to the Bend Relay |
| sq.rb.rocks | Rocks at the Forest Edge | Check the rocks by the forest edge | Report to the Bend Relay |
| sq.rb.parcel | Brass for the Ford | Carry the brass to the Ford Relay | Set the brass at the Ford Relay |
| sq.he.wallow | The Boar Wallow | Look at the wallow south of the road | Tell Rook what you saw |
| sq.he.farm | Plates for Three | Look at the river farm gate | Tell Burl what you found |
| sq.dw.bees | Where the Bees Go | Follow the bees to the old bee farm | Tell Burl where the bees go |
| sq.dw.stones | The Standing Stones | Walk to the ring of standing stones | Tell Burl about the stones |
| sq.fc.stores | Boars in the Stores | Drive off the two boars at the post | Take what the post left for you |
| sq.fc.caps | Red Caps | Pick five red caps on tree trunks | Bring the caps to Rook |
| sq.fc.well | The Dry Well | Look at the dry well north of the post | Tell Rook about the well |
| sq.fc.shrine | The Fallen Shrine | Look at the fallen shrine by the post | Read the note post |
| sq.fc.jetty | Rotten Planks | Walk out on the old jetty | Report to the Ford Relay |
| sq.fc.cog | A Cog for the Bend | Carry the cog to the Bend Relay | Set the cog at the Bend Relay |
| sq.fc.ask | Ask the Bear | Ask Burl if bears eat crows | Tell Rook what the bear said |
| sq.rook.gift | A Gift for the Bear | Give the brass scrap to Burl | Give Burl the brass scrap |

Lines (offer / active / ready / done) are pasted in the pack rows; each <= 56 chars.

## This side - look-at texts (2026-10-11)

PC-B writer. Look-at notes for the props on this side of the river. Each one is a title plus 1-4 lines (title <= 28, lines <= 56, prompt <= 24), ASCII only, with no magic word and no names. They echo the errand lines already in `ch12/pack.json`: the cart is tipped and empty, the well is dry with no echo, the shrine pillar leans west, the stack is dry and old. Together they hint at four things without explaining them: the wreck, the Wall, the emptied homesteads and the relays.

**Wiring (programmer, not writer):** nothing resolves `inspect.text` keys yet. The only live inspect texts are constants in `game/js/quest/errands.js` (`KNOT_*`, `GATE_*`), and `load()` adds interactables only for `knot` and `sealedGate`. The four `rsInspect*` anchors are not interactable yet. Paste these as a key -> {prompt, title, lines} table and add a generic `qi.<id>` for any entity with `components.inspect`.

| key | where | text | chars |
|---|---|---|---|
| `prompt.wagon` | prompt | `[E] Look at the cart` | 20 |
| `inspect.wagon.title` | note (`rsInspectWagon`) | `A cart off the road` | 19 |
| `inspect.wagon` (1) | note | `Tipped on its side. The axle snapped clean.` | 43 |
| `inspect.wagon` (2) | note | `Crates split open. Straw gone grey. Nothing in them.` | 52 |
| `inspect.wagon` (3) | note | `The ruts run east, toward the Wall.` | 35 |
| `inspect.wagon` (4) | note | `Nobody came back for it.` | 24 |
| `prompt.well` | prompt | `[E] Look at the well` | 20 |
| `inspect.well.title` | note (`rsInspectWell`) | `A dry well` | 10 |
| `inspect.well` (1) | note | `Planks across the mouth. One brick gone.` | 40 |
| `inspect.well` (2) | note | `You drop a pebble. No splash. No echo.` | 38 |
| `inspect.well` (3) | note | `The bucket rope was cut, not rotted.` | 36 |
| `inspect.well` (4) | note | `Someone did not want it used again.` | 36 |
| `prompt.shrine` | prompt | `[E] Look at the shrine` | 22 |
| `inspect.shrine.title` | note (`rsInspectShrine`) | `A fallen shrine` | 15 |
| `inspect.shrine` (1) | note | `A stone niche on its back. The pillar leans west.` | 49 |
| `inspect.shrine` (2) | note | `Three rings cut in the base, worn soft.` | 39 |
| `inspect.shrine` (3) | note | `The same mark as the relays.` | 28 |
| `inspect.shrine` (4) | note | `In the niche, a cup of rainwater. Fresh.` | 40 |
| `prompt.woodpile` | prompt | `[E] Look at the stack` | 21 |
| `inspect.woodpile.title` | note (`rsInspectWoodpile`) | `A woodcutter's stack` | 20 |
| `inspect.woodpile` (1) | note | `Split logs, stacked bark-up against the rain.` | 46 |
| `inspect.woodpile` (2) | note | `Grey with age. Moss along the top row.` | 38 |
| `inspect.woodpile` (3) | note | `A tally cut in the end post stops mid-row.` | 43 |
| `inspect.woodpile` (4) | note | `Ash on the top logs. Blown from the tower.` | 42 |
| `note.sealedGate.again` (1) | note, 2nd+ look at `sealedGate` (before `hint.sealedGate`) | `Oil on the hinges. Fresh this season.` | 37 |
| `note.sealedGate.again` (2) | note | `Whoever keeps the key keeps the gate.` | 37 |
| `prompt.gateLamp` | prompt | `[E] Look at the lanterns` | 24 |
| `inspect.gateLamp.title` | note (`sgLamp1..6`, optional) | `Lanterns at the gate` | 20 |
| `inspect.gateLamp` (1) | note | `Floor lanterns, set in a row. Burning.` | 38 |
| `inspect.gateLamp` (2) | note | `Out here, at the far end of the road.` | 37 |
| `inspect.gateLamp` (3) | note | `Someone wants this gate found.` | 30 |
| `prompt.lamp` | prompt | `[E] Look at the lamp` | 20 |
| `inspect.roadLamp.title` | note (`rsLamp1`, `rsLamp2`, optional) | `A lamp on a crate` | 17 |
| `inspect.roadLamp` (1) | note | `Brass, set on an old crate by the road.` | 39 |
| `inspect.roadLamp` (2) | note | `It is lit. Nobody comes to light it.` | 36 |
| `inspect.roadLamp` (3) | note | `The oil never seems to go down.` | 31 |
| `inspect.tradeLamp.title` | note (`tradeLamp`, optional; prompt `prompt.lamp`) | `A lamp on the counter` | 21 |
| `inspect.tradeLamp` (1) | note | `Brass, on the trade post counter. Lit.` | 38 |
| `inspect.tradeLamp` (2) | note | `The flame is trimmed low and even.` | 34 |
| `inspect.tradeLamp` (3) | note | `Skyworks neat. Out here.` | 24 |
| `prompt.nest` | prompt | `[E] Look at the nest` | 20 |
| `inspect.nest.title` | note (`nest`, optional) | `A crow's nest` | 13 |
| `inspect.nest` (1) | note, glass still there | `Sticks, wire, a bootlace, a bent spoon.` | 40 |
| `inspect.nest` (2) | note | `In the middle, a round glass. Kept, not lost.` | 45 |
| `inspect.nest.empty` (1) | note, after `relay.mirror` is taken | `Sticks, wire, a bootlace, a bent spoon.` | 40 |
| `inspect.nest.empty` (2) | note | `A round hollow where the glass sat.` | 35 |
| `inspect.nest.empty` (3) | note | `Someone has already counted what is left.` | 42 |

Notes:
- The knot (`note.knot`) already has its text. It is unchanged.
- The cut well rope, the stopped tally and the cart ruts running east hint that the homesteads were emptied on purpose and in a hurry. They do not say who did it or where the people went, so the reason stays open (it pairs with `sq.he.farm`'s "gate chained from outside"). The shrine's three rings are the `note.fordMark` mark.
- On the lamps, "nobody comes to light it" and "the oil never seems to go down" are quiet wonder, with no magic word. "Trimmed low and even... skyworks neat" is a soft Maren echo (section 9.2): hope, not proof.
- The nest is a `questPickup`. If a look-at would clash with the pickup prompt, drop `inspect.nest` and keep only `inspect.nest.empty`.
- No `TODO-WRITER` or placeholder text was found in `content/quests/**`. All 18 QL-B2 rows have full lines. Animals get no barks.

## M4 story quests (QL-09..12 text, programmer)

Built from the QL-W lines above (no new voices). Quest rows in `content/quests/ch12/pack.json`: `sq.wreck.plate` (giver object `gondola`, fetch `boar.hide`, Brass Buckler), `sq.honey` (Burl -> Rook, `honeycomb`, 10 arrows + Rook's Hood = `gear.head.hood.worn`), `sq.rook.shiny` (Rook, 4 `brass.scrap` pickups brass1..4, Hunter's Bow + 10 arrows), `sq.packet` (giver object `packet`, deliver `packet` to the post, 20 arrows). New item texts: `honeycomb` "Honeycomb" / `Sticky gold. It is for the crow.`; `packet` "Cloth Packet" / `Tied with twine. FOR THE FORD POST.` Lines not in the tables above: `sq.wreck.plate` active `A plate and a strap. Boar hide would do.` / done `The gondola creaks. The plate is yours now.`; `sq.honey` active `The comb is for the crow. Do not lick it.` / done `Square with the crow. Good. I hate owing.`; `sq.rook.shiny` done `Shiny things. I keep them. You keep the bow.`; `sq.packet` active `The packet. The ford post, by the crossroads.` / done `The basket waits. The tags turn in the wind.`

## Ch3 opening (QL-21, PC-B writer, 2026-10-11)

Rows in `content/quests/ch3/pack.json`; look-at texts in `content/dialogue/inspect.json`. No new voices and no personal names (the 12 Ch3 names are not owner-approved). The village is not named on screen yet: the player has met nobody there, so it stays "the smoke" / "the palisade" until `mq.ow.names` (GDD 3: "Outwall" is a working name).

| id | title | HUD | return |
|---|---|---|---|
| mq.ow.path | Cookfire Smoke | Follow the track toward the smoke | - |
| mq.ow.fence | Wolves at the Fence | Drive the wolves from the goose pen | - |
| sq.hw.piers | The Pulled Bridge | Read the stone north of the road | - |
| sq.fc.sign | The West Arm | Find the sign arm in the shallows | Bring the sign arm to the ford post |

Givers: `sq.hw.piers` = the stone itself (what the player sees); `sq.fc.sign` = a basket tag at the ford post (same unsigned caps hand as TAKEN). Lines are in the pack rows (<= 56 chars).

| key | where | text | chars |
|---|---|---|---|
| `place.relay.ws_outwall` | toast title, save slot, map label | `Palisade Relay` | 14 |
| `prompt` (`note.owBoard`) | prompt | `[E] Read the board` | 18 |
| `note.owBoard.title` | note (`owBoard`) | `Notices, nailed up` | 18 |
| `note.owBoard` (1) | note | `Crown notices, printed in Ferrum. Rain-soft.` | 44 |
| `note.owBoard` (2) | note | `FELL BEYOND THE WALL. Name after name.` | 38 |
| `note.owBoard` (3) | note | `Carried out here and nailed up, one by one.` | 43 |
| `note.owBoard` (4) | note | `One line cut away. On the nail, a skyworks knot.` | 48 |
| `prompt` (`note.pierStone`) | prompt | `[E] Read the stone` | 18 |
| `note.pierStone.title` | note (`pierStone`) | `A standing stone` | 16 |
| `note.pierStone` (1) | note | `A dressed block, set on end beside the track.` | 45 |
| `note.pierStone` (2) | note | `Old mortar on one face. Once part of a bridge pier.` | 51 |
| `note.pierStone` (3) | note | `A Crown stamp, half chiselled away.` | 35 |
| `note.pierStone` (4) | note | `The bridge was pulled down. Not by the river.` | 45 |

Notes:
- `Palisade Relay`, not "Outwall Relay": the name is still a working name. Swap once the owner fixes it. Wiring (programmer): add `ws_outwall: 'Palisade Relay'` to `RELAY_TITLES` in `game/js/quest/wire/waystone.js`.
- The board is the `mq.ow.board` "Board of the Dead": Ferrum's FELL notices for the exiles. The cut line and the skyworks knot (same hitch as `note.knot`) are a soft Maren echo, not proof.
- The pier stone says the bridge was pulled down on purpose, Crown stamp chiselled off, without saying who or why.
- "West points west again" answers the shrine note's "IT WAS ALWAYS WEST" from the same unsigned hand.

## Gear names - proposal (owner to approve)

PC-B writer, 2026-10-11, for EQ-20 / EQ-21. Option A is the writer's pick. Names <= 14, desc <= 38, ASCII only. No new character names, no spell words (Spark/Gust/Ward avoided).

**Armour tier prefixes** (replace `T4` / `T5` in `tierPrefix`, `design/items.js`). Prefix <= 7 chars, so the longest bases (Jerkin, Gloves) stay <= 14. One desc line per tier; the base name can lead it (e.g. `Riveted jerkin. Iron rivets...`) only if it still fits 38.

| tier | A | B | desc (A / B) |
|---|---|---|---|
| tempered (4) | `Riveted` | `Banded` | `Iron rivets through boiled hide.` (32) / `Iron bands, laced tight. It holds.` (34) |
| warden (5) | `Watch` | `Relay` | `Old watch make, from a fallen tower.` (36) / `Keeper's make, from a relay store.` (34) |

Longest: `Riveted Jerkin` / `Riveted Gloves` 14, `Watch Jerkin` 12. "Watch" ties to Ruin Steel ("Old watch steel"): the old relay watch, older than the Wall.

**Weapons** (`design/itemsWeapons.js`, ids `gear.<slot>.<base>.<tier>`)

| id | A | B | desc |
|---|---|---|---|
| sword.sturdy | `Reforged Steel` (14) | `Outwall Blade` (13) | `Ruin steel, hammered true again.` (32) |
| sword.fine | `Keeper's Edge` (13) | `Relay Edge` (10) | `A relay-keeper's blade. Still keen.` (35) |
| bow.sturdy | `Braid Bow` (9) | `Exile's Bow` (11) | `River ash, cured in the ford mist.` (34) |
| bow.fine | `Rigging Bow` (11) | `Skyworks Bow` (12) | `Strung with Kestrel rigging wire.` (33) |
| shield.sturdy | `Oak Targe` (9) | `Palisade Board` (14) | `Oak boards, iron rim. Takes a blow.` (35) |
| shield.fine | `Relay Brass` (11) | `Crown Plate` (11) | `Old relay brass. Older than the Wall.` (37) |

Notes:
- `Outwall Blade` only if the owner fixes "Outwall" as the village name (GDD 3: working name; Ch3 text still avoids it on screen). `Reforged Steel` follows GDD 3 "sword (ruin steel, then reforged at forges)" and fits the Outwall forge chest.
- `Crown Plate` B desc instead: `Crown brass from the wreck. Light.` (34). The worn shield is already the gondola `Brass Buckler`, so A avoids a second wreck shield.
- `Keeper's Edge` names no person: "the keeper" is the unnamed relay-keeper of the log.

## Prompt names (OB-058/066)

PC-B writer, 2026-10-11. Plain names for `[E] <Verb> <name>`, lower case, ASCII. `promptFor` caps the whole prompt at 28, so after `[E] Inspect ` a name must be <= 16. Sources: `LABELS` / `labelOf` in `game/js/quest/errands.js` (object givers), `prompt` fields in `content/levels/tower.level.json`, and `content/dialogue/inspect.json`.

| id (source) | old | new | reason |
|---|---|---|---|
| `gondola` (labelOf, giver of sq.wreck.plate) | `gondola` | `wrecked airship` | What the player sees and woke beside; "gondola" is a ship-part word |
| `post` (LABELS) | `basket` | `trade basket` | Says which basket: the one at the trade post |
| `notePost` (LABELS) | `note post` | `notice post` | Plain English for a post with notes pinned to it |
| `packet` (labelOf, giver of sq.packet) | `packet` | `cloth packet` | Matches its item name "Cloth Packet" |
| `noteKeepLight` / `noteSteelHush` / `noteLeave` (tower json; LABELS) | `pinned page` | `pinned note` | "Note" is the everyday word; same for all three |
| `noteKeeperLog` (tower json) | `keeper's log` | `old logbook` | The keeper is unmet at this point; a logbook is obvious |
| `noteMason` (tower json) | `mason's chit` | `scrap of paper` | "Chit" is obscure; the hidden find should read as a find |
| `inspect.woodpile` (inspect.json) | `the stack` | `the woodpile` | "Stack" of what? (24 chars with the verb, at the limit) |

Unchanged, already plain: door, sword, the relay, knot, gate, cart, well, shrine, lanterns, lamp, nest, mark, board, stone.

Follow-ups (text only, for the programmer with the above): HUD `sq.wreck.plate.2` -> `Bring the hide to the wrecked airship` (36); done line `The gondola creaks. The plate is yours now.` -> `The wreck creaks. The plate is yours now.` (41); `prompt.gondola` -> `[E] Look at the wreck` (21) if that key is ever wired. Mixed verbs ("Inspect" vs "Look at") are the PO's call; the names fit both.

## QL-22 west-bank errands

PC-B writer, 2026-10-12. Rows in `content/quests/ch3/pack.json` (fields as QL-B1: `title`, step `objText`, `returnText`, `lines.{offer,active,ready,done}`). Limits: title <= 24, HUD <= 38, lines <= 56, ASCII. No voices and no names: the village has not spoken to Wick yet, so every giver is an object. The board errands are fresh notes in an unsigned caps hand, nailed over the Crown FELL notices (the exiles answer the board in their own hand). The village stays unnamed on screen. `ready` plays at the hand-in, the rest at the giver.

**sq.ow.wolves** (giver `owBoard`)

| key | text | chars |
|---|---|---|
| title | `Wolf Bounty` | 11 |
| obj | `Drive three wolves from the goose pen` | 37 |
| offer | `A new nail, over the Crown notices. A fresh hand:` / `WOLVES AT THE GEESE AGAIN. THREE FEWER, FAIR PAY.` | 49 / 50 |
| active | `The note: WOLVES. GOOSE PEN. THREE.` | 35 |
| ready | `Under the note now, tied with twine: arrows, a red vial.` | 56 |
| done | `Someone has written under it: GEESE COUNTED. ALL HERE.` | 54 |

**sq.ow.boars** (giver `owBoard`)

| key | text | chars |
|---|---|---|
| title | `Boar Bounty` | 11 |
| obj | `Drive off two boars on the west bank` | 36 |
| offer | `Another note, same hand, nailed over a FELL notice:` / `TWO BOARS ROOTING ON THE WEST BANK. MIND THE TUSKS.` | 50 / 51 |
| active | `The note: TWO BOARS. WEST BANK. TUSKS.` | 38 |
| ready | `Under the note, wrapped in sacking: old gear, oiled.` | 52 |
| done | `Under the note, a new line: THE BANK IS QUIET. THANKS.` | 54 |

**sq.ow.parcel** (giver `owBoard`, hand-in `owForge`)

| key | text | chars |
|---|---|---|
| title | `Parcel for the Forge` | 20 |
| obj | `Take the parcel to the forge` | 28 |
| offer | `A parcel hangs from a nail, wrapped in oilcloth.` / `Tag: FOR THE FORGE. LEAVE IT BY THE DOOR.` | 48 / 41 |
| active | `The tag: FOR THE FORGE. BY THE DOOR.` | 36 |
| ready | `You set the parcel by the forge door. It clinks.` / `On the step, waiting: two red vials.` | 48 / 36 |
| done | `The parcel tag is gone. The nail is bare.` | 41 |

Item clash: the pack reuses `packet`, whose desc reads `FOR THE FORD POST.` (sq.packet). Use a new item instead: `parcel` "Oilcloth Parcel" (15) / `Heavy for its size. FOR THE FORGE.` (34). If `packet` must stay, change the obj to `Take the packet to the forge` (28) and accept the wrong desc. The forge is cold (sets up `sq.ow.forge` "Cold Forge"); the clink is metal, left unexplained.

**sq.ow.ford** (giver `pierStone`, same voice as `sq.hw.piers`: what the player sees)

| key | text | chars |
|---|---|---|
| title | `Scout the Far Bank` | 18 |
| obj | `Cross the ford to the west bank` | 31 |
| offer | `Across the water, the other half of the old pier.` / `Someone pulled the bridge from that side. Go and see.` | 49 / 53 |
| active | `The far pier. Across the ford, on the west bank.` | 48 |
| ready | `The west pier: rope grooves, worn deep. A crossing.` / `In a dry crack of the stone: fifteen arrows, waxed.` | 51 / 51 |
| done | `Two piers, one river. Neither side built it back.` | 48 |

**Barley gate fetch** (new; giver `barleyGate`, a tag on the gate; suggested id `sq.ow.seed`)

| key | text | chars |
|---|---|---|
| title | `Spilled Seed` | 12 |
| obj | `Find the seed sack on the track` | 31 |
| return | `Bring the seed sack to the barley gate` | 38 |
| offer | `A tag on the barley gate, same caps hand:` / `SEED SACK FELL OFF THE CART. SOMEWHERE ON THE TRACK.` / `FIND IT BEFORE THE CROWS DO.` | 41 / 52 / 28 |
| active | `The tag: SEED SACK. TRACK. BEFORE THE CROWS.` | 44 |
| ready | `You hang the sack on the gate. A crow watches.` / `Tied to the gate for you, in twine: a fair share.` | 46 / 49 |
| done | `The tag is turned over: SEED SAFE. THE CROWS SULK.` | 50 |

New item: `seedSack` "Seed Sack" (9) / `Barley seed. A crow has been at it.` (35). If the sack lies somewhere other than the track, swap "track" in obj/offer/active for the place (keep obj <= 38).

**Path post shoot** (new; giver `owPathPost`, a tag on the post; suggested id `sq.ow.marks`)

| key | text | chars |
|---|---|---|
| title | `Three White Marks` | 17 |
| obj | `Shoot the three white marks` | 27 |
| return | `Go back to the post by the track` | 32 |
| offer | `A tag on the post, the same caps hand:` / `CAN YOU SHOOT? HIT THE THREE WHITE MARKS.` / `WE WATCH FROM THE FENCE. WE WILL SEE.` | 38 / 41 / 36 |
| active | `The tag: THREE WHITE MARKS. WE ARE WATCHING.` | 44 |
| ready | `A new line on the tag: GOOD EYE. THAT IS YOURS.` / `Under it, tied in twine, a bundle left for you.` | 47 / 47 |
| done | `The tag is gone. At the fence, a face, then none.` | 48 |

The targets need a visible white mark (chalk or lime) so "white marks" matches what the player sees; if the design uses straw targets instead, read `three straw targets` (obj `Shoot the three straw targets`, 29). The watching from the fence follows `mq.ow.fence` (faces watch from it): the village tests the stranger before anyone speaks.

## FB-02 Burl's fire

PC-B writer, 2026-10-12. Quest `sq.burl.fire` (D-069 FB-02), giver Burl at her berry slope, prereq `sq.ls.salt`. Fetch 3, return, she shows the fire, no fight. Limits: title <= 24, HUD <= 38, lines <= 56, ASCII. Burl says "fire", never "magic". The fire is for beasts only (owner default), and she says so. The title replaces the working "Burl's Spark" (Spark stays the gauntlet's light verb) and matches the spell's item name `Ember` (`spell.fireball`), so the reward popup and the title agree.

Collect site: **Cinder Hollow**, a lightning-burnt dip in band 5 where red pods grow in the ash (temporary name for the PO row; if the map puts the site elsewhere, swap the place name in obj/offer/remind and keep obj <= 38).

New item: `emberpod` "Emberpod" (8) / `A dry red pod. Warm as a held coal.` (35). Quest item, count 3, removed at hand-in.

| key (FB-02 key / pack field) | speaker | text | chars |
|---|---|---|---|
| `ql.burl.fire.title` / title | - | `Burl's Ember` | 12 |
| `ql.burl.fire.obj1` / obj | HUD | `Find three emberpods in Cinder Hollow` | 37 |
| `ql.burl.fire.obj2` / returnText | HUD | `Bring the emberpods to Burl` | 27 |
| `burl.fire.offer` (1) / offer | BURL | `Salt in my larder, sky-cub. Now a thing for you.` | 48 |
| `burl.fire.offer` (2) | BURL | `Down in Cinder Hollow, red pods grow in the ash.` | 48 |
| `burl.fire.offer` (3) | BURL | `Bring me three. Warm ones. I'll show you fire.` | 46 |
| `burl.fire.remind` (1) / active | BURL | `Three pods, sky-cub. Red, and warm to the paw.` | 46 |
| `burl.fire.remind` (2) | BURL | `Cinder Hollow. Follow the smell of old smoke.` | 45 |
| `burl.fire.turnin` (1) / ready | BURL | `Warm still. Good. Now watch, and don't blink.` | 45 |
| `burl.fire.turnin` (2) (show) | narration | `She cracks a pod between two claws. A coal glows.` | 49 |
| `burl.fire.turnin` (3) (show) | narration | `She breathes on it. It leaps and bursts on a stump.` | 51 |
| `burl.fire.reward` (1) | BURL | `That's fire, sky-cub. Close your fist on it. Throw.` | 51 |
| `burl.fire.reward` (2) | BURL | `It's for teeth and tusks. Not for bushes. Not mine.` | 51 |
| `burl.fire.reward` (3) | BURL | `Take this, for when your fire runs low.` | 39 |
| `burl.fire.done` / done | BURL | `Feed your fire slow, sky-cub. It's always hungry.` | 49 |
| `hint.fireball.cast` (1) | HUD | `[Hold L] charge fire. Let go: throw.` | 36 |
| `hint.fireball.cast` (2) | HUD | `Each throw costs MP.` | 20 |
| `hint.fireball.nomp` | HUD | `The fire fizzles. No MP left.` | 29 |

Notes:
- Order at hand-in: turnin (1) Burl, (2)-(3) narration (the frame's name tag off, or shown as plain text like the QL-22 object lines), then reward (1)-(3); `unlock:fireball` + the mana potion fire after reward (1), so (3) "Take this" lands with the potion popup.
- `hint.fireball.cast`: no fire key text exists in this file yet. `L` stands for the real binding label (FB-03: not hard-coded), written `[Hold {fist}]`. Line 1 stays <= 38 for a label of up to 3 chars (`LMB` gives 38).
- reward (2) is the in-world reason the fire hurts only enemies and doesn't burn bushes (owner default). If bushes become burnable later, that line still holds as Burl's own rule.
- "sky-cub" appears in 4 of the 9 Burl lines, as in her other errands.

## Ch3 main line: names, relay, board

PC-B writer, 2026-10-12. Rows `mq.ow.names`, `mq.ow.relay`, `mq.ow.board` in `content/quests/ch3/pack.json` (QL-B1 fields). Limits: title <= 24, HUD <= 38, lines <= 56, ASCII. Speaker labels: `HESK`, `DORRIN`, `-` = narration (name tag off). Hesk is a woman (quest-roadmap section 2). Both names still need the owner OK (quest-roadmap 2b); until then the labels can read `ELDER` / `SMITH`.

Voices: **Hesk** is slow and wary, weighs each word, and gives short sentences with a pause in them. **Dorrin** is blunt and practical and doesn't look up. He admits the fault at once and doesn't dress it up.

Name rule (D-013, GDD 3): Hesk is the first person to say "Wick". Wick's own answer is narration ("You tell her your name"), so the first time the name appears in speech, it comes from her. Every Hesk and Dorrin line after the beat may use it.

**mq.ow.names** (giver Hesk, Outwall gate, talk; reward gear T3)

| key | speaker | text | chars |
|---|---|---|---|
| title | - | `A Name at the Gate` | 18 |
| obj | HUD | `Speak to the woman at the gate` | 30 |
| offer (1) | HESK | `Stop there. Hands where I can see them.` | 39 |
| offer (2) | HESK | `You came over the river. Nobody comes over the river.` | 53 |
| offer (3) | HESK | `Ferrum says we're dead. Who are you?` | 36 |
| active | HESK | `Well? A name. Or the river back the way you came.` | 49 |
| ready (1) | - | `You tell her your name. She turns it over, slowly.` | 50 |
| ready (2) | HESK | `Wick.` | 5 |
| ready (3) | HESK | `We watched you at the fence. The wolves, too.` | 45 |
| ready (4) | HESK | `I'm Hesk. Come in, Wick. Keep your blade low.` | 45 |
| ready (5) | HESK | `Here. Ferrum's dead don't let a guest go cold.` | 46 |
| ready (opt) | HESK | `We call it Outwall. Somebody had to call it something.` | 54 |
| done | HESK | `Ferrum's dead are busy, Wick. Mind the geese.` | 45 |

ready (2) is the name beat: one word, then a held beat (about 1 s, or a key press) before (3). The gear T3 popup fires after (5). The `opt` line names the village. Use it only if the owner fixes "Outwall" (GDD 3: it is a working name). Without it, the village stays unnamed and `Palisade Relay` stays as it is.

**mq.ow.relay** (giver Hesk -> Dorrin at the forge -> barley gate (975,900) -> Outwall relay (912,952); reward travel Outwall)

| key | speaker | text | chars |
|---|---|---|---|
| title | - | `The Village Relay` | 17 |
| offer (1) | HESK | `The old relay in the yard. You came for it, I think.` | 52 |
| offer (2) | HESK | `We hear the call too. Nights. The stone here stays dark.` | 56 |
| offer (3) | HESK | `Something's missing from it. Ask Dorrin. At the forge.` | 54 |
| offer (4) | HESK | `He'll look at his boots. Let him. Then ask again.` | 49 |
| step 1 objText | HUD | `Ask Dorrin at the forge` | 23 |
| step 1 talk (1) | DORRIN | `Relay. Aye. The brass collar off the top. That was me.` | 54 |
| step 1 talk (2) | DORRIN | `Barley gate lost its hinge in the first winter.` | 47 |
| step 1 talk (3) | DORRIN | `No iron to spare. That brass was just sitting there.` | 52 |
| step 1 talk (4) | DORRIN | `Stone's been dark since. I knew. Didn't say.` | 44 |
| step 1 talk (5) | DORRIN | `Barley farm, east. Pull the brass. I'll rope the gate.` | 54 |
| step 2 objText | HUD | `Take the brass off the barley gate` | 34 |
| step 2 active | DORRIN | `Barley farm. East. Brass collar. Go on.` | 39 |
| step 2 take (1) | - | `The gate hangs on a collar of green brass. Old glyphs.` | 53 |
| step 2 take (2) | - | `You work it free. The gate sags into the barley.` | 48 |
| returnText | HUD | `Fit the collar to the village relay` | 35 |
| ready (1) | - | `The collar seats with a soft, sure click.` | 42 |
| ready (2) | - | `The bowl wakes teal and takes up the call.` | 42 |
| done | HESK | `Lit. Years, and it took a stranger and a gate.` | 46 |
| done (Dorrin, 1) | DORRIN | `Gate's on rope now. Holds fine. Should've done it then.` | 55 |
| done (Dorrin, 2) | DORRIN | `Bring me that ruin steel some day. I owe you work.` | 50 |

New item: `relayCollar` "Relay Collar" (12) / `A green brass collar, cut with glyphs.` (38). It is not called "Relay Brass", because that is the shield.fine name proposed in "Gear names". The quest item is removed at the relay. Travel Outwall uses the existing `Palisade Relay` title. Dorrin (2) sets up the later reforge ("sword: ruin steel, then reforged", GDD 3) and the cold forge (`sq.ow.forge`), and it promises nothing now. After step 2, the barley gate tag (`sq.ow.seed`) still hangs on the gate, which is now on rope.

**mq.ow.board** (giver the board in Outwall, read; explore; reward chart piece west)

| key | speaker | text | chars |
|---|---|---|---|
| title | - | `The Board of the Dead` | 21 |
| hook | HESK | `The board by the gate. Read it. That's who we are.` | 50 |
| obj | HUD | `Read the notices on the board` | 29 |
| read (1) | - | `Crown notices, carried out past the Wall and nailed up.` | 55 |
| read (2) | - | `FELL BEYOND THE WALL. HESK, OF THE TANNERS' STAIR.` | 50 |
| read (3) | - | `FELL BEYOND THE WALL. DORRIN, FORGE HAND, LOW WARDS.` | 52 |
| read (4) | - | `LOST TO THE HUSH. THE CROWN GRIEVES. SPEAK NO MORE.` | 51 |
| read (5) | - | `Under each name, in charcoal: HERE.` | 35 |
| read (6) | - | `One notice is cut. A strip gone, name and all, neatly.` | 54 |
| read (7) | - | `Above the cut: FELL BEYOND THE WALL.` | 36 |
| read (8) | - | `On the nail, a knot. A skyworks hitch, tied tight.` | 51 |
| read (9) | - | `Your hands know it. You were taught it on the skyworks.` | 55 |
| done (1) | - | `Pinned under the knot: a scrap of chart. Lines west.` | 52 |
| done (2) | - | `You leave the knot where it is. The line runs west.` | 51 |
| after | HESK | `That cut was there when the notices came out to us.` | 52 |

Notes:
- The board's `read` lines replace the 4-line QL-21 `note.owBoard` once this quest is live. They are the same board and the same facts, with more of them. The QL-22 errand notes stay nailed over the other FELL notices.
- The cut and the knot are a soft Maren echo (story section 9: the lamp "set down neatly"; she taught him the trade). They are not proof. No line names her, and none says who cut the strip. Hesk's `after` line says the cut came out with the notices, so nobody in the village did it. A stronger hook, if the manager wants one: read (7) `Above the cut: FELL BEYOND THE WALL. SKYW` (41). The writer advises against it for Ch3.
- The chart scrap is unsigned pencil and is not Wick's "W." hand. Whose hand it is stays open (M4 reason, GDD 3). "Tanners' Stair" is a new Low Wards place name. It is minor and can be swapped.
- No line says why the ALIVE signal calls or who sends it, and the "older than the Wall" reveal is kept for Ch4.

**mq.ow.close** "The Line West" (Ch3 close; giver and hand-in Hesk at the gate; explore crossroads; reward 15 arrows)

Beat: the scrap from the board has pencil lines running west. Hesk can't leave the gate, so she sends Wick out to the crossroads to look. He comes back and the road goes on. Hesk doesn't say who walked it first; the knot and the scrap already did. The village keeps its waystone lit behind him, and Ch3 closes on the road west. Maren stays implied: "someone" is the most anyone says.

| key | speaker | text | chars |
|---|---|---|---|
| title | - | `The Line West` | 13 |
| obj | HUD | `Walk west to the crossroads` | 27 |
| journal | - | `The scrap's lines run west. Walk to the crossroads and look.` | 59 |
| return | HUD | `Tell Hesk what the road looks like` | 34 |
| offer (1) | HESK | `That scrap from the board. Its lines run west.` | 46 |
| offer (2) | HESK | `Past the crossroads. I can't leave the gate. You can.` | 53 |
| offer (3) | HESK | `Walk out to the crossroads. Look west. Then tell me.` | 52 |
| choices | - | `I'll go and look.` / `Not yet.` | |
| accept | HESK | `Mind the road, Wick. It's longer than it looks.` | 47 |
| active | HESK | `The crossroads, Wick. Look west, then come back.` | 48 |
| hand-in (1) | HESK | `So the road goes on. Someone walked it before you.` | 50 |
| hand-in (2) | HESK | `Take these. West, then. We'll keep the waystone lit.` | 52 |

## Journal summaries (OB-097)

PC-B writer, 2026-10-12. These texts go in the right-hand details pane of the J journal. Each text is shown while its step is the **current** step: it says what has happened so far and what to do next, in the player's journal voice ("You ..."). Limits: 1-2 short sentences (a few use three very short ones), <= 110 chars, ASCII, no key names, lengths counted by hand.

Name rules: no line says "Wick", including after the Hesk beat, because the journal voice is "you" (D-013). Up to `m1.beasts` she is "the bear" or "the old bear", and from `burl.boars` on she is "Burl", matching section "EP-QUEST: Burl's boars". The village is not named ("the village", "the palisade"), and the Ch3 relay is "the village relay", never "Outwall" (see "Ch3 opening").

Objective ids: hand-written quests use their JSON ids. Pack quests built from `steps` get ids from `templates.js`: one step gives the template name (`explore`, `kill`, `talk`, `fetch`, `deliver`, `collect`, `escort`), and several steps give the name plus a number (`explore1`, `explore2`, ...). Fetch, deliver and collect hand-ins have no step of their own, so their journal text already names the return.

### Main line

| quest id | objective id | journal text | chars |
|---|---|---|---|
| m1 | wake | `The Kestrel came down through a tower roof. Get up from the wreck and look around.` | 82 |
| m1 | breach | `You are alive, and the wreck still smokes. Climb to the top of the tower.` | 73 |
| m1 | sword | `You reached the top. Take up the ruin steel lying in the ashes.` | 63 |
| m1 | leave | `You have the sword. Go down and out through the tower door.` | 59 |
| m1 | beasts | `The old bear outside talks. Help her drive the wild boars from the woods.` | 73 |
| m1 | follow | `The boars are gone, and the bear has a name: Burl. Follow her to where she leads.` | 81 |
| m1 | waystone | `Burl brought you to an old stone in the meadow. It is dark. Wake it.` | 68 |
| m1 | road | `The stone woke and glows. Take the road west, toward the next light.` | 68 |
| m1 | relayFound | `The road bends ahead. Somewhere near it stands a dead relay. Find it.` | 69 |
| m1 | relay1 | `You found the relay at the bend, cold and silent. Wake it.` | 58 |

| quest id | objective id | journal text | chars |
|---|---|---|---|
| tower.blade | breach | `You found a note pinned to the wall. Climb to the top of the tower.` | 67 |
| tower.blade | sword | `The note spoke of a blade. It lies here in the ashes. Take it up.` | 66 |
| tower.blade | leave | `You have the sword. Leave through the tower door and meet the bear outside.` | 75 |

| quest id | objective id | journal text | chars |
|---|---|---|---|
| burl.boars | beasts | `The bear is called Burl. Boars tear up her woods. Bring down all five.` | 70 |

| quest id | objective id | journal text | chars |
|---|---|---|---|
| mq.bend.call | pulse | `A crow named Rook talks too. Watch the Bend relay blink and count.` | 66 |
| mq.bend.call | knot | `The relay blinks in threes, again and again. Look at the knot on its mount.` | 75 |

| quest id | objective id | journal text | chars |
|---|---|---|---|
| mq.river.road | riverBank | `Rook gave you a chart of the river. Follow the road west to the water.` | 70 |

| quest id | objective id | journal text | chars |
|---|---|---|---|
| mq.ford.stones | fordWest | `The river runs wide and loud. Cross on the stepping stones.` | 59 |

| quest id | objective id | journal text | chars |
|---|---|---|---|
| mq.ford.mirror | glass | `The Ford Relay is cold. Its glass is gone. Rook has it. Take it from the nest.` | 78 |
| mq.ford.mirror | wake | `You have the glass back from the nest. Wake the Ford Relay.` | 56 |

| quest id | objective id | journal text | chars |
|---|---|---|---|
| mq.smoke | mark | `The Ford Relay hums again. Someone cut a mark into it. Look closer.` | 67 |
| mq.smoke | north | `Smoke rises in the north. Follow the footpath toward it.` | 56 |

| quest id | objective id | journal text | chars |
|---|---|---|---|
| mq.ow.path | explore | `Cookfire smoke, so someone lives out here. Follow the track toward it.` | 70 |

| quest id | objective id | journal text | chars |
|---|---|---|---|
| mq.ow.fence | kill | `A palisade, and wolves at its goose pen. Drive them off.` | 56 |

| quest id | objective id | journal text | chars |
|---|---|---|---|
| mq.ow.names | talk | `The wolves are gone, and the gate opens a crack. Tell Hesk who you are.` | 71 |

| quest id | objective id | journal text | chars |
|---|---|---|---|
| mq.ow.relay | talk | `The village relay is dark. Part of it is missing. Ask Dorrin at the forge.` | 74 |
| mq.ow.relay | brass | `Dorrin took the relay's brass collar for a gate. Pull it off the barley gate.` | 77 |
| mq.ow.relay | wake | `You have the brass collar. Fit it to the village relay and wake it.` | 67 |

| quest id | objective id | journal text | chars |
|---|---|---|---|
| mq.ow.board | read | `The village relay burns teal. In the plaza stands a board of names. Read it.` | 76 |

### Burl's errands (giver Burl)

| quest id | objective id | journal text | chars |
|---|---|---|---|
| sq.burl.blue | sprigs | `Burl wants the blue sprigs that grow on her slope. Pick six of them.` | 68 |
| sq.burl.blue | bring | `You have six blue sprigs. Bring them back to Burl.` | 50 |
| sq.tm.nub | explore1 | `Burl's cub Nub has wandered off again. Look for small tracks by the stone.` | 74 |
| sq.tm.nub | explore2 | `Small tracks lead away from the stone. Follow them to the tower door.` | 69 |
| sq.tm.nub | explore3 | `No Nub at the door, only wet prints. Follow them down the road.` | 63 |
| sq.burl.boars.n | kill | `More boars dig in the north woods. Burl wants three of them driven off.` | 71 |
| sq.burl.boars.w | kill | `Two boars root on the west side. Drive them off for Burl.` | 57 |
| sq.burl.boars.s | kill | `The south woods have boars again. Drive off all three for Burl.` | 63 |
| sq.burl.meat | fetch | `Winter is coming and Burl's den is bare. Bring her a piece of boar meat.` | 72 |
| sq.burl.stone | explore | `Burl worries about the waystone. Go and see that it still glows.` | 64 |
| sq.burl.hint | explore | `Burl knows a path along the hill below the tower. Walk it.` | 58 |
| sq.burl.tower | explore | `Burl does not trust the tower. Go back and look at its door.` | 60 |
| sq.burl.scout | explore1 | `Burl wants to know if the river is safe. Walk down to the bank.` | 63 |
| sq.burl.scout | explore2 | `The bank is quiet. Find the stones where the river can be crossed.` | 66 |
| sq.burl.ask | talk | `Burl asks what the crossroads post says. Go and read it.` | 56 |
| sq.burl.walk | escort | `Burl wants to see the Bend Relay blink. Walk with her to it.` | 60 |
| sq.burl.parcel | deliver | `Burl gave you two pieces of meat. Leave them in the post basket.` | 64 |
| sq.tm.gap | explore | `Something got through the meadow fence. Look at the gap for Burl.` | 65 |
| sq.tm.wood | explore | `Burl smelled something at the woodcutter's corner. Check the stack.` | 67 |
| sq.tm.cart | explore | `An old cart sits by the road. Burl wants to know what is in it.` | 63 |
| sq.he.farm | explore | `Burl remembers a farm by the river. Go and look at its gate.` | 60 |
| sq.dw.bees | explore | `Bees drift past Burl's slope, heavy with pollen. Follow them home.` | 66 |
| sq.dw.stones | explore | `Burl speaks of a ring of standing stones. Walk out and find it.` | 63 |
| sq.honey | deliver | `Burl sent honeycomb for the crow. Bring it to Rook.` | 51 |
| sq.burl.fire | collect | `Burl promised to show you fire. Find three red emberpods in Cinder Hollow.` | 74 |

### Rook's errands (giver Rook)

| quest id | objective id | journal text | chars |
|---|---|---|---|
| sq.he.wallow | explore | `Rook saw boars rolling in mud. Look at the wallow south of the road.` | 68 |
| sq.fc.caps | collect | `Rook wants red caps, the ones that grow on tree trunks. Pick five.` | 66 |
| sq.fc.well | explore | `Rook heard something in the dry well north of the post. Look at it.` | 67 |
| sq.fc.ask | talk | `Rook wants to know if bears eat crows. Go and ask Burl.` | 55 |
| sq.rook.gift | deliver | `Rook sends a brass scrap to Burl, as a peace gift. Give it to her.` | 67 |
| sq.rook.shiny | collect | `Rook loves shiny things. Find four brass scraps and bring them back.` | 68 |

### Other side quests (Ch1-2)

| quest id | objective id | journal text | chars |
|---|---|---|---|
| sq.post.spare | deliver | `The post asks travellers to leave what they can. Carry three arrows to it.` | 74 |
| sq.straw | t1 | `Three straw men stand by the note post. Hit the first with an arrow.` | 68 |
| sq.straw | t2 | `One straw man hit. Now put an arrow in the second.` | 50 |
| sq.straw | t3 | `Two down. One straw man still stands. Hit the third.` | 52 |
| sq.rb.shield | explore | `Someone left a buckler at the Bend Relay. Wear it down to the ford.` | 67 |
| sq.rb.regards | talk | `The relay has word for Burl. Carry it back to her slope.` | 56 |
| sq.rb.road | explore1 | `Something on the road west needs a second look. Walk back along it.` | 67 |
| sq.rb.road | explore2 | `You walked the road. Now come back to the Bend Relay.` | 53 |
| sq.rb.lamps | explore | `Old lamps line the verge of the road. Walk along them.` | 54 |
| sq.rb.rocks | explore | `Rocks pile up at the forest edge, too neat to be chance. Check them.` | 68 |
| sq.rb.parcel | deliver | `You carry a brass scrap for the Ford Relay. Bring it there.` | 59 |
| sq.fc.ford | explore1 | `Wet boots are the price of the far bank. Walk down to the river.` | 64 |
| sq.fc.ford | explore2 | `You stand at the water's edge. Cross over to the west bank.` | 59 |
| sq.fc.smoke | explore | `From the ford, a thread of smoke shows in the north. Climb the lookout.` | 71 |
| sq.fc.cross | explore | `The west road leads to a crossroads. Walk it and see what is there.` | 67 |
| sq.fc.again | explore | `You have been across. Come back to the river bank.` | 50 |
| sq.fc.stores | kill | `Two boars broke into the stores at the post. Drive them off.` | 60 |
| sq.fc.shrine | explore | `A shrine lies fallen by the note post. Go and look at it.` | 57 |
| sq.fc.jetty | explore | `An old jetty runs out over the water. Walk out on its planks, carefully.` | 72 |
| sq.fc.cog | deliver | `You carry a cog from the ford. Take it to the Bend Relay.` | 57 |
| sq.wreck.plate | fetch | `A plate from the Kestrel's gondola would make a shield. Find hide for a strap.` | 78 |
| sq.packet | deliver | `You found an oilcloth packet. Leave it at the ford post.` | 56 |

### Other side quests (Ch3)

| quest id | objective id | journal text | chars |
|---|---|---|---|
| sq.hw.piers | read | `A bridge once stood here. Only the piers are left. Read the stone north of the road.` | 84 |
| sq.fc.sign | fetch | `The post sign has lost its west arm. Find it in the shallows.` | 61 |
| sq.ow.wolves | kill | `Wolves still circle the goose pen. Drive three of them off.` | 59 |
| sq.ow.boars | kill | `Boars raid the west bank. Drive two of them off.` | 48 |
| sq.ow.parcel | deliver | `A parcel waits for the forge. Carry it there.` | 45 |
| sq.ow.ford | explore | `Nobody here has scouted the far bank in a while. Cross the ford to it.` | 70 |
| sq.ow.barley | fetch | `A sheaf is due from the barley gate. Fetch it.` | 46 |
| sq.ow.range | t1 | `Three targets stand along the track. Hit the first.` | 51 |
| sq.ow.range | t2 | `One target hit. Now the second.` | 31 |
| sq.ow.range | t3 | `Two hit. One target left on the track. Hit the third.` | 53 |

Notes:
- `mq.ford.mirror`: the JSON has two objectives (`glass`, `wake`). The QL-W1 HUD table lists a third one, "Ask Rook about the cold relay". If that step is added, give it: `The Ford Relay is cold and dark. Ask Rook what happened to it.` (62).
- `sq.wreck.plate` and `sq.rook.shiny` list a second HUD step (bring back) in QL-W1, but the pack builds a single `fetch` / `collect` objective. The texts above already point to the return.
- `sq.honey`, `sq.fc.ask` and `sq.rook.gift` name Rook. They open only after `mq.bend.call`, where Rook gives his name.
- Assumption: every `explore` step in these packs lists one area, so it builds one objective. If a step lists several areas, its ids get a further digit (`explore1` -> `explore1` + `1`, `2`, ...); reuse the same text for each of them.

## Goblins (D-072)

(PC-B writer 2026-10-13, owner-authorised.) This section uses the D-072 raiders of the west bank (the level 5-10 side). They are the one fantasy people in a world of real animals. Ferrum keeps them as a nursery tale, the same way it keeps magic, so they fit GDD 3 without a canon change. Their origin stays open, and nothing ties them to the ALIVE signal (M4). Lines are <= 56 characters, ASCII only.

| key | text | chars |
|---|---|---|
| `lore.goblins.1` | `Small, wiry, quick. They come down off the west hills.` | 54 |
| `lore.goblins.2` | `They want metal more than meat: nails, hinges, brass.` | 53 |
| `lore.goblins.3` | `Their camps are nests of scrap, lit by stolen fire.` | 51 |
| `lore.goblins.4` | `The village has iron, fire, geese. They want all three.` | 55 |
| `lore.goblins.5` | `In Ferrum they are a nursery tale. Out here, they bite.` | 55 |
| `lore.goblins.6` | `They keep west of the river. Hesk says they won't swim.` | 55 |

Combat barks (D-072 melee, archers and torch raids). They are short, crude and partly not words.

| key | when | text |
|---|---|---|
| `bark.goblin.1` | spots the player | `Tall one! Tall one!` |
| `bark.goblin.2` | group rushes in | `Grak! Grak-grak!` |
| `bark.goblin.3` | sees metal/loot | `Shiny. Mine-mine.` |
| `bark.goblin.4` | archer/thrower shoots | `Hup! Eat it!` |
| `bark.goblin.5` | torch raid | `Burn! Burn the honk-birds!` |
| `bark.goblin.6` | hurt / flees | `Hnnk... run, run!` |

| key | speaker | text | chars |
|---|---|---|---|
| `ow.hesk.goblins.1` | HESK | `Torches on the west hill. Goblins. Bar the pen, Wick.` | 53 |
| `ow.hesk.goblins.2` | DORRIN | `Barley gate hinge? Goblins. Then I took the brass.` | 50 |

Notes:
- Dorrin's line fills in his earlier `Barley gate lost its hinge in the first winter` (mq.ow.relay): goblins took the iron, and so the brass came off the relay. Use both lines only after `mq.ow.names` (Hesk says "Wick").
- `lore.goblins.6`: drop or swap it if goblin AI follows the player across water (D-070 free crossing). Swap: `They keep to the west bank. Nobody knows why.` (45).
- "honk-birds" is goblin for geese.

## Sea monster (D-070)

(PC-B writer 2026-10-13, owner-authorised.) The sign is a Gullhaven fishers' post from before the Wall Law clearing, and the charcoal line under it came later. The death card uses the voice of section "Death card": first person, present tense, <= 40 characters.

| key | text | chars |
|---|---|---|
| `sign.strand.monster.1` | `Carved in a driftwood post, worn salt-white:` | 44 |
| `sign.strand.monster.2` | `SWIM TO THE STAKES. NOT ONE STROKE PAST.` | 40 |
| `sign.strand.monster.3` | `Under it, newer, in charcoal: IT CIRCLES FIRST.` | 47 |
| `hint.sea.monster.1` (BURL) | `Deep water's got a thing in it bigger than me, sky-cub.` | 55 |
| `death.eaten.1` | `Something rose under me. Then dark.` | 35 |
| `death.eaten.2` | `Next time, I stay inside the stakes.` | 36 |
| `death.drown.1` | `My breath ran out short of the shore.` | 37 |
| `death.drown.2` | `Far above, the light still blinks.` | 34 |

Notes:
- "STAKES": the designer should place a row of old net stakes at the monster distance so the sign matches what the player sees. Without stakes, read `THE BLACK ROCKS` in sign 2 and death.eaten 2 (`Next time, I stay inside the rocks.`, 35).
- Villager variant of the hint (if a villager says it, not Burl): `Swim the shallows. Past them, something swims you.` (50).

## Villager chats (LIFE-05)

(PC-B writer 2026-10-13, owner-authorised.) These replace the placeholders `life.chat.any.1..8` in `content/dialogue/life.barks.json`. Each key is a two-turn fragment that the player half-hears in passing: A then B, both `"who":"npc"` (label VILLAGER). No names except Dorrin, who is the smith and well known. Each line is <= 56 characters.

| key | A | B |
|---|---|---|
| `life.chat.any.1` | `Frost on the barley again.` | `Then we cut early. Again.` |
| `life.chat.any.2` | `Wolves sang till dawn.` | `Count the geese twice, then.` |
| `life.chat.any.3` | `The relay hummed all night.` | `Let it. Better than the quiet.` |
| `life.chat.any.4` | `Has anyone seen my good knife?` | `Ask the crows. Or Dorrin.` |
| `life.chat.any.5` | `Wind's off the Wall today. Smell it?` | `Coal smoke. I don't miss it.` |
| `life.chat.any.6` | `Another nail gone from the fence.` | `Goblins. Or the smith.` |
| `life.chat.any.7` | `Rain by dusk. Get the hides in.` | `And the bread. Last time it drowned.` |
| `life.chat.any.8` | `Do you still dream of the Low Wards?` | `Every night. Then I wake here. Better.` |

Hesk + Dorrin pair (`life.chat.hesk.dorrin.1..4`). Each has two turns, with the speaker labels HESK and DORRIN; the first speaker is listed first.

| key | turn 1 | turn 2 |
|---|---|---|
| `.1` | HESK `Gate holds?` | DORRIN `On rope. Rope holds. Mostly.` |
| `.2` | HESK `At that anvil past dark again.` | DORRIN `Cold forge. Nothing to burn but time.` |
| `.3` | DORRIN `The boy asked about flying again.` | HESK `Then show Pell the sea. It's closer.` |
| `.4` | HESK `You hear it too? The call.` | DORRIN `Every night. I just stopped saying so.` |

Notes: `life.chat.any.6` needs goblins live (D-072). Until then, use `Wind, or the smith. Probably the smith.` (39). Line `.3` names Pell (quest-roadmap 2b). If Pell is not in the build yet, read `Then show him the sea. It's closer.` (35).

## Defend the Farm (LIFE-09, `sq.ow.raid`)

(PC-B writer 2026-10-13, owner-authorised.) This fills the NEEDS WRITER fields of `sq.ow.raid` in `content/quests/ch3/pack.json` and uses the same board voice as `sq.ow.wolves`: an unsigned caps hand, with no speaker. The raiders are the wolf pack from `raids.json`.

| key / field | text | chars |
|---|---|---|
| objective `journal` | `Wolves raid the goose pen by night. Wait there after dark, drive off the pack.` | 78 |
| board notice (1) | `WOLVES COME FOR THE GEESE AFTER DARK.` | 37 |
| board notice (2) | `A WHOLE PACK. FIVE, MAYBE MORE.` | 31 |
| board notice (3) | `WHO CAN HOLD A BLADE, STAND AT THE PEN.` | 39 |
| `lines.offer` (1) | `A new note, the nail driven deep. The same caps hand:` | 53 |
| `lines.offer` (2) | `WOLVES COME FOR THE GEESE AFTER DARK. STAND AT THE PEN.` | 55 |
| `lines.accepted` | `You fold the note into your coat. Wait for dark.` | 48 |
| `lines.active` | `The folded note: AFTER DARK. GOOSE PEN. THE PACK.` | 49 |
| `lines.ready` | `On the nail now, tied with twine: two red vials, arrows.` | 56 |
| `lines.done` | `Chalk under the nail: GEESE COUNTED. ALL HERE. AGAIN.` | 53 |

Notes: the board notice is the read text, for wherever the board shows the full note (`note.owBoard` style). The pack has no `accepted` field yet. If none is added, drop that line, because `active` already works on its own. The objective `text` `Defend the goose pen at night` (29) stays as it is.

## Weapon tiers 4-5 + goblin trinket (EQ-20b, GOB)

(PC-B writer 2026-10-13, owner-authorised.) Replaces `T4` / `T5` names and the `Placeholder copy.` desc in `design/itemsWeapons.js` (gob-01). Name <= 14 (MAX_ITEM_NAME), desc <= 38 (MAX_ITEM_DESC), ASCII only. Follows armour option A: tempered = forged iron work, warden = "Watch" (old tower watch make, as `Watch Jerkin`).

| key | text | chars |
|---|---|---|
| `item.gear.main.sword.tempered.name` | `Quenched Edge` | 13 |
| `item.gear.main.sword.tempered.desc` | `Oil-quenched. Rings like a bell.` | 32 |
| `item.gear.main.sword.warden.name` | `Watch Blade` | 11 |
| `item.gear.main.sword.warden.desc` | `Tower watch steel. It never dulled.` | 35 |
| `item.gear.ranged.bow.tempered.name` | `Horn Bow` | 8 |
| `item.gear.ranged.bow.tempered.desc` | `Ash and horn, glued and bound. Heavy.` | 37 |
| `item.gear.ranged.bow.warden.name` | `Watch Bow` | 9 |
| `item.gear.ranged.bow.warden.desc` | `A tower archer's bow. Quick to draw.` | 36 |
| `item.gear.off.shield.tempered.name` | `Iron Kite` | 9 |
| `item.gear.off.shield.tempered.desc` | `Riveted iron over oak. Barely dents.` | 36 |
| `item.gear.off.shield.warden.name` | `Watch Shield` | 12 |
| `item.gear.off.shield.warden.desc` | `Watch plate. Holds when you can't.` | 34 |
| `item.goblin.trinket.name` | `Scrap Charm` | 11 |
| `item.goblin.trinket.desc` | `Bent nails on a cord. Goblin-made.` | 33 |

Notes:
- If the owner picks armour option B (`Relay` for warden), read `Relay Blade` / `Relay Bow` / `Relay Shield` and keep the descs.
- The trinket fits "They want metal more than meat" (Goblins, D-072): goblins wear what they steal. Alt name `Goblin Charm` (12).

## Region relays (WM-13)

PC-B writer, 2026-10-13. One dormant relay per region (wake = save + respawn + travel). Names follow `Bend Relay` / `Ford Relay`: a plain place word plus "Relay", taken from the chart labels. Name <= 22, wake line <= 60, ASCII. Wake lines name no one and do not say who sends the signal.

| key | name | wake line |
|---|---|---|
| `place.relay.ws_glasswater` | `Glasswater Relay` (16) | `Teal light runs out across the still water.` (43) |
| `place.relay.ws_northwood` | `Northwood Relay` (15) | `The pines go teal to their tips, then dark again.` (49) |
| `place.relay.ws_highPastures` | `Pasture Relay` (13) | `Wind combs the high grass. The bowl hums with it.` (49) |
| `place.relay.ws_ashMile` | `Ash Mile Relay` (14) | `Teal light on black ash. The wind carries it off.` (49) |
| `place.relay.ws_downs` | `Downs Relay` (11) | `The hum rolls out over the long green downs.` (44) |
| `place.relay.ws_signalHill` | `Signal Hill Relay` (17) | `ALIVE. The hill answers in Morse.` (32) |
| `place.relay.ws_heath` | `Heath Relay` (11) | `The heather bends away from the hum, then back.` (47) |
| `place.relay.ws_reedmire` | `Reedmire Relay` (14) | `The reeds hiss. Teal light lies on black water.` (47) |
| `place.relay.ws_strand` | `Strand Relay` (12) | `The hum goes out over the sand, out to the sea.` (47) |
| `place.relay.ws_whitecombs` | `Combfoot Relay` (14) | `Bare rock rings. High snow catches the light.` (45) |

Notes:
- `Combfoot Relay`: it stands at the foot of the Whitecombs, on bare rock. Alt `Whitecomb Relay` (15).
- `Pasture Relay`, not "High Pastures Relay": shorter, same plain voice. Alt `High Pasture Relay` (18).
- `Heath Relay` vs `Ash Mile` (the burnt heath): if the two sit close, use alt `Heather Relay` (13) to avoid a mix-up.
- Signal Hill's line repeats the D-013 pattern; "answers" echoes the waystone done line.

## Region errands (WMP-01)

PC-B writer, 2026-10-13. Giver = the region's woken relay. It does not speak words: it shows things in the bowl's light (shapes, pulses), same voice as the WM-13 wake lines. Title <= 24, journal <= 120, offer/done <= 80, ASCII. Relay names as in WM-13.

| id | title | journal | offer | done |
|---|---|---|---|---|
| sq.reg.glasswater | `Tusks at the Water` | `The Glasswater bowl showed boars churning the shallows. Drive off three, then come back to the light.` | `The bowl flickers: three boars, mud in the still water.` | `The water goes still. The bowl glows clear and steady.` |
| sq.reg.northwood | `Wolves Under the Pines` | `Northwood Relay showed three wolves circling its stones. Drive them off, then return to the relay.` | `Teal shapes in the bowl: three wolves, low among the pines.` | `The pines are quiet. The relay hums one long, even note.` |
| sq.reg.highPastures | `Bears in the High Grass` | `The Pasture Relay flickered with two bears in the high grass. Drive both off, then return.` | `Wind moves in the bowl, and two heavy shapes move through it.` | `The grass lies flat and still. The hum settles, warm.` |
| sq.reg.ashMile | `Rooting in the Ash` | `Two boars root through the black ash near Ash Mile Relay. Drive them off and come back to the light.` | `Grey light in the bowl: two boars, tusks deep in the ash.` | `The ash settles. The bowl burns a little brighter.` |
| sq.reg.downs | `Four on the Downs` | `The Downs Relay pulsed four times: four boars loose on the green. Drive them off, then return.` | `Four short pulses. Four dark shapes on the long green.` | `Four short pulses, then one long. The downs are quiet.` |
| sq.reg.signalHill | `The Hill Pack` | `Wolves prowl Signal Hill and its relay stutters. Drive off three of them, then return to it.` | `The pattern breaks. Three wolves on the slope below.` | `The pattern runs clean again. The hill answers.` |
| sq.reg.heath | `Boars in the Heather` | `Three boars are tearing up the heather by Heath Relay. Drive them off, then come back.` | `The heather shakes in the bowl. Three boars, rooting.` | `The heather springs back. The hum bends with it.` |
| sq.reg.reedmire | `Boars in the Reeds` | `Boars wallow in the black water near Reedmire Relay. Drive off three of them, then return.` | `The reeds thrash in the bowl. Three boars, deep in the mire.` | `The reeds hiss and settle. The black water goes still.` |
| sq.reg.strand | `Arrows for the Downs` | `The Strand light points inland, where the boars run. Carry five arrows to the Downs Relay.` | `The bowl draws five thin lines, all pointing inland.` | `Far inland, the Downs light blinks back. The sea hums.` |
| sq.reg.whitecombs | `Bears Below the Snow` | `Two bears den on the bare rock below the Whitecombs. Drive them off and return to Combfoot Relay.` | `Snow light in the bowl. Two bears on the rock below it.` | `The rock is clear. The bowl rings like cold glass.` |

Notes:
- Offers are images, not speech: the relays have no voice of their own in canon, so the "ask" is what the bowl shows. Wick reads it.
- Strand: the five "thin lines" are the arrows; the journal makes it plain. Hand-in is the Downs Relay, return text unchanged.
- Signal Hill's done line echoes its wake line on purpose; the pattern itself is not restated.

## Waystones (D-080, OB-146)
Owner: "remove relays, i like waystones". Player text never says "relay": every regional relay is a Waystone (same model as the tower stone). Internal ids/keys keep "relay".
- `q.burl.waystones` (Burl, after she sees the crystal, `bear.q.ready.5b`): "Wake the waystones. They heal you, / save your path, and beasts fear / their light."
- `notice.waystone.first` (first wake of any waystone): "Waystone woken: travel (M), heal + save, new task." (the last part only when a task exists)
- Names: "Bend Waystone", "Ford Waystone", "Palisade Waystone" ... (place.relay.<id> keys keep their ids); prompts "[E] Touch the waystone", "[E] Look at the waystone".

## Quest-giver lines (QFIX-S5, 2026-10-14)

PC-B writer (owner-authorised). This replaces the NEEDS WRITER placeholders from QFIX-S5a/b/c (lanes pc-b1/pc-b2, 2026-10-14). Dialogue lines are <= 56 chars, object offers <= 120 in total, and everything is ASCII. "Relay" is never used (D-080). Item names are plain ("health potion", never "red vial"). Keys: dialogue nodes use their node id. Pack quests use `<questId>.<field>` for `lines.{offer,active,ready,done}`. `(1)`/`(2)` = line order inside one node/field. `ready` plays at the hand-in NPC, and the other fields play at the giver. Accept / Not yet choices stay generated.

**Names (proposed, owner OK needed, quest-roadmap 2b):** post-keeper **Bram** (label `BRAM`). Wardens (label = name): Glasswater **Lin**, Northwood **Brenna**, High Pastures **Ewan**, Ash Mile **Tull**, Downs **Edda**, Signal Hill **Ivo**, Heath **Nell**, Reedmire **Orla**, Strand **Kit** (he), Whitecombs **Sten**. They are short, plain names that sit with Hesk, Dorrin, Tam and Ama, and none clashes with an existing name. HUD/returnText can keep "post-keeper" / "the Downs warden" until the names are approved.

Canon guards: Bram and the wardens are exiles who keep a post or a light. They **never say "Wick"** (GDD 3: the exiles' first use of his name is Hesk's beat, and these NPCs can be met before it). They never name the village and never explain the signal. Bram calls Wick "flier" once, because he saw the ship come down. The tags on the basket are "not my hand. Older." (the TAKEN tag stays Tam's, per quest-roadmap). Hesk's path/fence lines come before `mq.ow.names`, so they say "stranger" and never "Wick". Her Outwall errand lines also avoid "Wick", because they can open before the name beat.

### Rook (`rook.dialogue.json`)

| key | line |
|---|---|
| rook.road.1 | Paper says river. River says west. Follow the road. |
| rook.road.2 | Road west, to the loud water. I fly ahead. |
| rook.road.active | Road west. Walk till the ground gets wet. |
| rook.road.ready | Loud water. You found it. Wet feet? Not yet. |
| rook.road.ready2 | Stones cross it. I counted them twice. Next. |
| rook.stones.1 | Stones in the water. Hop them to the west bank. |
| rook.stones.2 | Hop. Hop. Hop. Do not stop to count fish. |
| rook.stones.active | The stones. Hop them. West bank, then me. |
| rook.stones.ready | Across. Boots wet. I said so. I always say so. |
| rook.stones.ready2 | Now look at the stone here. Cold. Very cold. |
| rook.mirror.done.1 | Blink, blink. Bend, Ford, the far one. Three. |
| rook.mirror.done.2 | My glass, your stone. A loan. I keep count. |
| rook.smoke.1 (1) | A mark on the Ford stone. Cut, not scratched. |
| rook.smoke.1 (2) | Read it. Then the footpath north. Smoke there. |
| rook.smoke.2 | Mark first. Smoke after. I keep away from fire. |
| rook.smoke.active | The mark on the Ford stone. Then north, to smoke. |
| rook.smoke.ready | Smoke means fire. Fire means hands. Many hands. |
| rook.smoke.ready2 | People. Go see. I stay. People throw stones. |
| sq.straw.ready (1) (optional, hand-in at Rook) | Three hits. I counted. Crows always count. |
| sq.straw.ready (2) | Twenty sticks from the bundle. Feathered. Yours. |

`rook.stones.ready2` is the sly lead-in to `rook.ford.1..8` ("Gone? No. Kept."), so it must not say the glass is gone.

### Hesk (`hesk.dialogue.json`, before the name beat: no "Wick")

| key | line |
|---|---|
| hesk.path.1 (1) | That's close enough. You followed our smoke. |
| hesk.path.1 (2) | Walk the last of the track to the gate. Slowly. |
| hesk.path.2 | Slowly. So I can see your hands. |
| hesk.path.3 | The track, to the gate. I'm watching. |
| hesk.path.active.1 | The gate. Walk to it. Slowly. |
| hesk.path.done.1 | You walk straight. Good. Stay there a moment. |
| hesk.fence.1 | Wolves at our goose pen. Every night, more. |
| hesk.fence.2 | Drive them off the pen. Then we'll talk. |
| hesk.fence.3 | The goose pen, along the fence. Go on. |
| hesk.fence.active.1 | The goose pen. The wolves. Then me. |
| hesk.fence.done.1 (1) | I watched from the wall. You didn't run. |
| hesk.fence.done.1 (2) | Come to the gate. |

`mq.ow.board` comes after the name beat, so "Wick" is allowed here:

| key | line |
|---|---|
| hesk.board.1 (1) | The board by the gate. Read it, Wick. |
| hesk.board.1 (2) | That's who we are. What Ferrum says we are. |
| hesk.board.2 | Read every name. Then come back to me. |
| hesk.board.3 | Take your time. They waited long enough. |
| hesk.board.active.1 | The board, Wick. Read it, then come back. |
| hesk.board.done.1 | Now you know us. Dead, all of us. And here. |

Order note: `hesk.names.1` still opens with "Stop there. Hands where I can see them." That reads oddly after path/fence, because she has already spoken to him. Suggested swap for `hesk.names.1` (1): `Stop there. Now, before the gate opens:` (39). The second line is unchanged.

### Hesk's Outwall errands (pack `lines`, giver Hesk; no "Wick")

| key | line |
|---|---|
| sq.ow.wolves.offer (1) | Wolves still circle the goose pen. |
| sq.ow.wolves.offer (2) | Drive three off. I pay in arrows. |
| sq.ow.wolves.active | Three wolves. The goose pen. Go. |
| sq.ow.wolves.ready (1) | Three gone. The geese can sleep. |
| sq.ow.wolves.ready (2) | Arrows, and a health potion. Fair pay. |
| sq.ow.wolves.done | Geese counted. All there. |
| sq.ow.boars.offer (1) | Two boars rooting on the west bank. |
| sq.ow.boars.offer (2) | Drive them off. Mind the tusks. |
| sq.ow.boars.active | Two boars. West bank. Mind the tusks. |
| sq.ow.boars.ready (1) | The bank's quiet. Good. |
| sq.ow.boars.ready (2) | Take this. Old gear, but oiled. |
| sq.ow.boars.done | A quiet bank. A quiet night. Rare out here. |
| sq.ow.barley.offer (1) | The barley gate owes us a sheaf. |
| sq.ow.barley.offer (2) | Bring it here before the crows find it. |
| sq.ow.barley.active | The sheaf. At the barley gate. |
| sq.ow.barley.ready (1) | A good sheaf. Bread for a week. |
| sq.ow.barley.ready (2) | Arrows, and a health potion. For the carrying. |
| sq.ow.barley.done | Bread tonight. Thank the barley, not me. |
| sq.ow.range.offer (1) | Three targets stand along the track. Can you shoot? |
| sq.ow.range.offer (2) | Hit all three. I'll be counting. |
| sq.ow.range.active | Three targets, along the track. Hit them all. |
| sq.ow.range.ready (1) | Three. I counted. You can shoot. |
| sq.ow.range.ready (2) | More arrows. Waste them on targets, not on us. |
| sq.ow.range.done | You shoot like you mean it. Good. |
| sq.ow.raid.offer (1) | The pack comes back after dark. For the geese. |
| sq.ow.raid.offer (2) | Stand at the goose pen tonight. Drive them off. |
| sq.ow.raid.active | After dark. The goose pen. Hold it. |
| sq.ow.raid.ready (1) | The pen held. You held. Thank you. |
| sq.ow.raid.ready (2) | Two health potions, and arrows. Sleep now. |
| sq.ow.raid.done | Geese counted. All here. Again. |
| sq.ow.bears.offer (1) | Black bears in the fields. Two too many. |
| sq.ow.bears.offer (2) | Drive two off. Big as doors, and hungry. |
| sq.ow.bears.active | Two black bears. The fields. Careful. |
| sq.ow.bears.ready (1) | Gone? Good. The fields are ours again. |
| sq.ow.bears.ready (2) | Two health potions. For the claw marks. |
| sq.ow.bears.done | The fields are quiet. For now. |
| sq.ow.parcel.offer (1) | This parcel goes to the forge. For the smith. |
| sq.ow.parcel.offer (2) | Don't open it. It's his. |
| sq.ow.parcel.active | The parcel. The smith, at the forge. |
| sq.ow.parcel.done | He got it? Then he'll be up all night. |

The `sq.ow.wolves/boars/raid` QL-22/LIFE-09 board-voice lines are retired with this change. The board notice text (`note.owBoard` style) can stay as what the board says when read.

### Dorrin (pack `lines`; `ready` at Dorrin)

| key | line |
|---|---|
| sq.ow.parcel.ready (1) | About time. Don't ask what's in it. |
| sq.ow.parcel.ready (2) | Here. Hesk would want you paid. |
| sq.ow.ford.offer (1) | Nobody's looked at the far bank in a while. |
| sq.ow.ford.offer (2) | Cross the ford. Look around. Come back. |
| sq.ow.ford.active | Ford. Far bank. Look, then back here. |
| sq.ow.ford.ready (1) | Quiet over there? Good. Quiet is good. |
| sq.ow.ford.ready (2) | Arrows. Don't lose them all at once. |
| sq.ow.ford.done | Far bank's quiet. I'll sleep, then. |
| sq.hw.piers.ready (1) | The bridge stone. Aye. Pulled down, not washed out. |
| sq.hw.piers.ready (2) | Not my work. Older than me. Here, arrows. |

`sq.hw.piers` offer/active/done stay in the stone's own voice (QL-21). Dorrin does not say who pulled the bridge (GDD 3 keeps the reason for M4).

### Post-keeper Bram (`postkeeper.dialogue.json` + ch12/ch3 pack `lines`, giver and hand-in Bram)

| key | line |
|---|---|
| postkeeper.hello.1 (1) (first talk) | Saw your ship come down. Loud, for a bird. |
| postkeeper.hello.1 (2) | I'm Bram. I keep the post. Leave what you can. |
| postkeeper.hello.2 (repeat, optional) | Post's open. Take what you need. |
| sq.rb.shield.offer (1) | Someone left this buckler by the Bend Waystone. |
| sq.rb.shield.offer (2) | Wear it down to the ford. Then show me. |
| sq.rb.shield.active | Buckler on your arm. Down to the ford, then back. |
| sq.rb.shield.ready (1) | Fits you. Nobody came back for it. |
| sq.rb.shield.ready (2) | Keep it. And a health potion, for the knocks. |
| sq.rb.shield.done | A buckler on a flier. Now I've seen it all. |
| sq.rb.regards.offer (1) | Tell Burl, up on the tower hill: the road's clear. |
| sq.rb.regards.offer (2) | She asks after it. Don't ask me how. |
| sq.rb.regards.active | Burl. Tower hill. The road's clear. That's all. |
| sq.rb.regards.ready (1) | She heard? Good. She worries, for a bear. |
| sq.rb.regards.ready (2) | Five arrows. Straight ones. |
| sq.rb.regards.done | Road's clear, and the bear knows. Quiet day. |
| sq.rb.road.offer (1) | Walk the road back toward your tower, would you? |
| sq.rb.road.offer (2) | Then on to the Bend Waystone. Tell me what moves. |
| sq.rb.road.active | Back along the road. Then the Bend Waystone. |
| sq.rb.road.ready (1) | Nothing moving? Good. Nothing is good news. |
| sq.rb.road.ready (2) | Five arrows. Fair, for a walk. |
| sq.rb.road.done | Road walked. I'll sleep easier. |
| sq.rb.lamps.offer (1) | Old lamps stand along the road. Dark, mostly. |
| sq.rb.lamps.offer (2) | Walk the line of them. See if any still burn. |
| sq.rb.lamps.active | The lamps by the road. Walk the whole line. |
| sq.rb.lamps.ready (1) | All dark? Thought so. Someone trimmed them, once. |
| sq.rb.lamps.ready (2) | A health potion, for the walk. |
| sq.rb.lamps.done | Dark lamps. Nobody left to trim them. |
| sq.rb.rocks.offer (1) | Rocks piled at the forest edge. Too neat for chance. |
| sq.rb.rocks.offer (2) | Go and look. Tell me what you make of them. |
| sq.rb.rocks.active | The rocks at the forest edge. Look close. |
| sq.rb.rocks.ready (1) | Stacked, like a cairn? Old way-marks, then. |
| sq.rb.rocks.ready (2) | Five arrows. Mind the edge after dark. |
| sq.rb.rocks.done | Way-marks. Someone walked this road before us. |
| sq.rb.parcel.offer (1) | The basket lid hangs on string. Brass would hold. |
| sq.rb.parcel.offer (2) | Bring me a brass scrap. Your ship dropped plenty. |
| sq.rb.parcel.active | One brass scrap. From your wreck, or anywhere. |
| sq.rb.parcel.ready (1) | Good brass. The lid will hold now. |
| sq.rb.parcel.ready (2) | Ten arrows. Brass is worth that, out here. |
| sq.rb.parcel.done | Lid holds. The crow can't open it now. |
| sq.fc.ford.offer (1) | The ford's past the bend. Wet boots are the price. |
| sq.fc.ford.offer (2) | Cross to the west bank, then come back to me. |
| sq.fc.ford.active | Down to the river. Across to the west bank. |
| sq.fc.ford.ready | Wet to the knee. Here. Dry boots. Better ones. |
| sq.fc.ford.done | Dry feet. Out here, that's half of living. |
| sq.fc.smoke.offer (1) | There's a lookout north of the ford. High rocks. |
| sq.fc.smoke.offer (2) | Climb it. Look north. Tell me what you see. |
| sq.fc.smoke.active | The lookout, north of the ford. Climb. Look. |
| sq.fc.smoke.ready (1) | Smoke, you say? Cookfires, or trouble. |
| sq.fc.smoke.ready (2) | Ten arrows. Either way, you'll want them. |
| sq.fc.smoke.done | North's watched. Somebody had to. |
| sq.fc.cross.offer (1) | Past the ford, the west road meets a crossroads. |
| sq.fc.cross.offer (2) | Walk out to it. Tell me which ways still go. |
| sq.fc.cross.active | The west road. Out to the crossroads. |
| sq.fc.cross.ready (1) | All still go? Good. Roads forget slowly. |
| sq.fc.cross.ready (2) | A health potion. Roads are long. |
| sq.fc.cross.done | Every road goes somewhere. Most go west. |
| sq.fc.again.offer (1) | One more crossing. Back to the river bank. |
| sq.fc.again.offer (2) | See the stones hold both ways. Then me. |
| sq.fc.again.active | Back to the river bank. Mind the moss. |
| sq.fc.again.ready (1) | Both ways, then. The ford's sound. |
| sq.fc.again.ready (2) | Ten arrows. For the wet boots. |
| sq.fc.again.done | Ford's sound. You're sound. Good day's work. |
| sq.fc.jetty.offer (1) | An old jetty runs out over the water. Rotten. |
| sq.fc.jetty.offer (2) | Walk out on it, slowly. Tell me if it holds. |
| sq.fc.jetty.active | The jetty. Step light. Plank by plank. |
| sq.fc.jetty.ready (1) | It held? Half of it, anyway. Good to know. |
| sq.fc.jetty.ready (2) | Five arrows. Dry ones, at least. |
| sq.fc.jetty.done | Half a jetty. Better than none. |
| sq.fc.cog.offer (1) | The Bend Waystone's mount is short one cog. |
| sq.fc.cog.offer (2) | Bring me a brass cog. I'll fit it myself. |
| sq.fc.cog.active | One brass cog. You'll have one somewhere. |
| sq.fc.cog.ready (1) | That'll do. It'll turn smooth now. |
| sq.fc.cog.ready (2) | Ten arrows. Fair trade. |
| sq.fc.cog.done | You won't see the cog turn. I will. |
| sq.post.spare.offer (1) | The basket runs low. Arrows go first, always. |
| sq.post.spare.offer (2) | Spare me three? Others walk this road too. |
| sq.post.spare.active | Three arrows, when you can spare them. |
| sq.post.spare.ready (1) | Three. Someone will need these. Thank you. |
| sq.post.spare.ready (2) | Here. A health potion. The basket gives back. |
| sq.post.spare.done | Leave what you can spare. You did. |
| sq.fc.stores.offer (1) | Two boars broke into my stores. Right there. |
| sq.fc.stores.offer (2) | Drive them off before they eat the winter. |
| sq.fc.stores.active | The two boars, in my stores. Go on. |
| sq.fc.stores.ready (1) | Gone, and only one sack torn. Good. |
| sq.fc.stores.ready (2) | Take something off the shelf. You earned it. |
| sq.fc.stores.done | Stores whole. Boars elsewhere. Good. |
| sq.fc.shrine.offer (1) | A shrine lies fallen by the notice post. |
| sq.fc.shrine.offer (2) | Go and look. Tell me which way it fell. |
| sq.fc.shrine.active | The fallen shrine, by the notice post. |
| sq.fc.shrine.ready (1) | West? It fell west. Of course it did. |
| sq.fc.shrine.ready (2) | Ten arrows. Odd thing to ask, I know. |
| sq.fc.shrine.done | Always west, out here. Even the stones. |
| sq.fc.sign.offer (1) | My signpost lost its west arm in high water. |
| sq.fc.sign.offer (2) | It's in the shallows somewhere. Find it for me? |
| sq.fc.sign.active | The sign's west arm. Somewhere in the shallows. |
| sq.fc.sign.ready (1) | That's it. West points west again. |
| sq.fc.sign.ready (2) | Arrows. For your wet sleeves. |
| sq.fc.sign.done | West points west. As it should. |
| sq.burl.parcel.ready (1) (at Bram) | Boar meat, from Burl? She always sends too much. |
| sq.burl.parcel.ready (2) | In the basket it goes. Arrows for you. Basket's rule. |
| sq.packet.ready (1) (at Bram) | FOR THE FORD POST. That's here. Long road for it. |
| sq.packet.ready (2) | Not my hand on it. Older. I'll keep it safe. |
| sq.packet.ready (3) | Twenty arrows. It waited longer than you did. |

Text fixes that go with these lines (HUD <= 38):
- `sq.rb.regards` objText `Carry the waystone's word to Burl` -> `Tell Burl the road is clear` (27). Journal: `The post-keeper has word for Burl: the road is clear. Carry it up her hill.` (79).
- `sq.fc.shrine`: the "west" lines assume the shrine lies pointing west, which matches the shrine note "IT WAS ALWAYS WEST". If the model points elsewhere, ready (1) becomes `That way? Hm. Not west. Odd.` (28) and the done line becomes `Even the stones forget, out here.` (33).
- `sq.packet` "Not my hand" keeps Tam's later reveal (`sq.ow.taken`) open.

### Region wardens (`warden_<region>.dialogue.json` hello + regions pack `lines`)

| key | line |
|---|---|
| warden_glasswater: warden.hello | Lin. I keep this waystone. The water keeps me. |
| sq.reg.glasswater.offer (1) | The light shows boars in the shallows. Three. |
| sq.reg.glasswater.offer (2) | Drive them out of the water, then come back. |
| sq.reg.glasswater.active | Three boars, in the Glasswater shallows. |
| sq.reg.glasswater.done | Still water again. See how the light sits on it. |
| warden_northwood: warden.hello | Brenna. I keep the light. The pines keep the dark. |
| sq.reg.northwood.offer (1) | Three wolves circle the stones, under the pines. |
| sq.reg.northwood.offer (2) | Drive them off, then come back to me. |
| sq.reg.northwood.active | Three wolves. Under the pines, near the stone. |
| sq.reg.northwood.done | The pines are quiet. Listen. Nothing. |
| warden_highpastures: warden.hello | Ewan. Long grass, long wind. I keep the light. |
| sq.reg.highPastures.offer (1) | Two bears, out in the high grass. Too close. |
| sq.reg.highPastures.offer (2) | Drive both off, then come back to me. |
| sq.reg.highPastures.active | Two bears in the high grass. Both of them. |
| sq.reg.highPastures.done | Grass lies flat. The bears went over the hill. |
| warden_ashmile: warden.hello | Tull. Ash on everything here. Even on the light. |
| sq.reg.ashMile.offer (1) | Two boars, rooting in the black ash. |
| sq.reg.ashMile.offer (2) | Drive them off and come back. Mind the dust. |
| sq.reg.ashMile.active | Two boars in the black ash. Go on. |
| sq.reg.ashMile.done | The ash settles. The light burns a bit brighter. |
| warden_downs: warden.hello | Edda. The downs are wide. I watch all of them. |
| sq.reg.downs.offer (1) | Four boars loose on the green. Four. |
| sq.reg.downs.offer (2) | Drive them off the downs, then come back. |
| sq.reg.downs.active | Four boars, on the long green. Go. |
| sq.reg.downs.done | Quiet green. Four fewer mouths on it. |
| warden_signalhill: warden.hello | Ivo. This hill talks all night. I listen. |
| sq.reg.signalHill.offer (1) | Three wolves on the slope below. The light stutters. |
| sq.reg.signalHill.offer (2) | Drive them off, then come back up to me. |
| sq.reg.signalHill.active | Three wolves, on the slope below the hill. |
| sq.reg.signalHill.done | The light runs clean. The hill answers again. |
| warden_heath: warden.hello | Nell. Heather and boars, and the heather's winning. |
| sq.reg.heath.offer (1) | Three boars tearing up the heather by the stone. |
| sq.reg.heath.offer (2) | Drive them off, then come back here. |
| sq.reg.heath.active | Three boars in the heather. Near the stone. |
| sq.reg.heath.done | The heather springs back. It always does. |
| warden_reedmire: warden.hello | Orla. Mind your feet. The mire keeps what it takes. |
| sq.reg.reedmire.offer (1) | Three boars, wallowing in the black water. |
| sq.reg.reedmire.offer (2) | Drive them out of the reeds, then come back. |
| sq.reg.reedmire.active | Three boars in the black water. In the reeds. |
| sq.reg.reedmire.done | Reeds hiss, water stills. That's peace, here. |
| warden_strand: warden.hello | Kit. Sea on one side, the stone on the other. |
| sq.reg.strand.offer (1) | The Downs warden is short of arrows. Edda. |
| sq.reg.strand.offer (2) | Carry five to her, at the Downs Waystone, inland. |
| sq.reg.strand.active | Five arrows to Edda, at the Downs Waystone. |
| sq.reg.strand.ready (1) (at Edda) | Arrows, from the Strand? Kit remembered. |
| sq.reg.strand.ready (2) | Go back and tell Kit. He'll want to know. |
| sq.reg.strand.done | Far inland, the Downs light blinks back. She has them. |
| warden_whitecombs: warden.hello | Sten. Cold up here. The light doesn't mind. |
| sq.reg.whitecombs.offer (1) | Two bears den on the bare rock, below the snow. |
| sq.reg.whitecombs.offer (2) | Drive them off, then come back to me. |
| sq.reg.whitecombs.active | Two bears, on the bare rock below the snow. |
| sq.reg.whitecombs.done | Rock's clear. Hear it? The light rings like glass. |

The WMP-01 bowl-image offer/done lines are retired. The wardens now say what the light showed. The speaker label `WARDEN` becomes the name once the names are approved. Until then, keep `WARDEN` and drop the name word from the hello line (for example `I keep this waystone. The water keeps me.`). For the Strand, use `The Downs warden` in place of "Edda"/"her", and "the Strand warden" in place of "Kit".

### Object-giver offers (`lines.offer`, 2 lines, <= 120 total)

| key | line (1) / line (2) | total |
|---|---|---|
| note.keepLight.offer (`tower.blade`) | Pinned to the wall: Do not stay down here. / Climb the tower stair and find the blade? | 83 |
| note.straw.offer (`sq.straw`) | Three straw men stand by the notice post. / Hit all three, then tell Rook the crow? | 79 |
| prompt.gondola.offer (`sq.wreck.plate`) | A bent plate hangs off the wreck. Shield-sized. / Bring boar hide to Burl so she can strap it? | 91 |
| prompt.packet.offer (`sq.packet`) | An oilcloth packet, stitched: FOR THE FORD POST. / Carry it to the post-keeper by the crossroads? | 94 |

## Region text batch (WMP-10, 2026-10-14)

PC-B writer. This closes the open text keys from WMP-01/03/05/06. Already done in content and not repeated here: errand titles, objTexts, returnTexts and offer/active/ready/done lines (`content/quests/regions/pack.json` = QFIX-S5 warden lines above), waystone names and wake lines (`RELAY_TITLES` / `RELAY_WAKE`), the 16 named regions in `design/ui-region-banner.js`, and the travel lines `Already here.` / `Not with enemies near.`. ASCII only. "Relay" is never used (D-080). Warden names stay out of the text until the owner approves them.

### Region enter names (WMP-06 / REGION-01, `ASSETS.uiRegionBanner.names`)

| key | text |
|---|---|
| roadWest | The West Road |
| outwall | The Barley Fields |

- `roadWest` is the road from the tower down past the Bend Waystone to the ford, so the name is the plain road name. Alt: `The Bend`.
- `outwall` names the land, not the village (GDD 3: the village has no name on screen, and "Outwall" is only a working name). The fields, the barley gate and the goose pen are all things the player can see there. If the owner fixes "Outwall" as the name, the banner can switch to `Outwall` after `mq.ow.names` is done. Alt: `The Palisade Fields`.

### Region errand journals (WMP-01, step `journal`, <= 120)

The current journals still say the giver is the waystone, and Glasswater still says "bowl". The QFIX-S5 wardens are the givers now, so these journals replace them. The objTexts and titles stay as they are.

| key | text |
|---|---|
| sq.reg.glasswater.journal | The Glasswater warden saw boars churning the shallows. Drive off three, then go back to the warden. |
| sq.reg.northwood.journal | Wolves circle the Northwood Waystone, under the pines. Drive off three, then go back to the warden. |
| sq.reg.highPastures.journal | Two bears roam the high grass too near the Pasture Waystone. Drive both off, then go back to the warden. |
| sq.reg.ashMile.journal | Two boars root through the black ash by the Ash Mile Waystone. Drive them off, then go back to the warden. |
| sq.reg.downs.journal | Four boars are loose on the long green of the Downs. Drive them off, then go back to the warden. |
| sq.reg.signalHill.journal | Wolves prowl the slope below Signal Hill, and its waystone stutters. Drive off three, then climb back to the warden. |
| sq.reg.heath.journal | Three boars are tearing up the heather by the Heath Waystone. Drive them off, then go back to the warden. |
| sq.reg.reedmire.journal | Boars wallow in the black water near the Reedmire Waystone. Drive off three, then go back to the warden. |
| sq.reg.strand.journal | The Downs warden is short of arrows. Carry five inland to the Downs Waystone, then come back. |
| sq.reg.whitecombs.journal | Two bears den on the bare rock below the Whitecombs snow. Drive them off, then go back to the warden. |

One wake line fix to match the waystone model (it has no bowl):

| key | text |
|---|---|
| RELAY_WAKE.ws_highPastures | Wind combs the high grass. The stone hums with it. |

### Waystone travel text (WMP-05, M map)

| key | text |
|---|---|
| toast.travel.header (`travelHeader`) | Travel: 1-9, or arrows and Enter |
| toast.travel.none (no woken waystone yet) | Wake a waystone to travel. |
| toast.travel.unknown (`'unknown'` / `'bounds'`) | That waystone is out of reach. |
| toast.travel.locked (point in an unseen region) | You have not walked that far yet. |
| toast.travel.blocked (keep) | Not with enemies near. |
| toast.travel.here (keep) | Already here. |

`locked` is only needed if a locked point is ever shown. Today, `lockUnseen` hides it.

### Ambient cue names (WMP-03, `content/life/regionAmbient.json`)

These are the names and a one-line brief for the audio stub. The cue ids stay as they are.

| cue id | name | brief |
|---|---|---|
| birdsong | Birdsong | Small birds, far apart. Never a full chorus. |
| insects | Grass insects | Slow dry clicking in warm grass. |
| windLoop | Wind | Low wind over open ground. No whistle. |

Proposal for the audio/designer pass (not text, no data edit here): reedmire, strand, signalHill and westHeath have no table row. Suggested cues are `reeds` (Reeds, "dry hiss, now and then a plop") for the Reedmire and `shoreWash` (Shore, "slow waves, long gaps") for the Long Strand and the Shearcliffs. Signal Hill can use `windLoop`.

Note: the `westHeath` banner says `The Shearcliffs`, but its waystone and errand say "Heath". Both fit, because the coast is cliffs and the inland part is heather. If the owner wants one word, rename the waystone to `Shearcliff Waystone` and leave the errand as it is.

## Text batch 3 (2026-10-14)

PC-B writer. This covers the farm ambush hint and the NEEDS WRITER keys from 2026-10-14 that the two sections above do not cover (pc-b1 OB-145 and the OB-152 follow-up). There were none in pc-b2. Every line is <= 56 chars and ASCII only, and none uses "relay".

### Plates for Three (`sq.he.farm`)

| key | line |
|---|---|
| hint.farm.ambush | The gate slams behind you. Three goblins step out. |

### Waystone look/blocked hints (OB-145, `relayWake.js`)

| key | line |
|---|---|
| prompt.waystone.look (`PROMPT_LOOK`, keep) | [E] Look at the waystone |
| hint.waystone.needCrystal (`HINT_NEED_CRYSTAL`) | The stone stays dark. Burl's crystal might wake it. |
| hint.waystone.needWaystone (`HINT_NEED_WAYSTONE`) | Dark. Wake the waystone by the tower first. |
| hint.waystone.needTalk (`HINT_NEED_TALK`) | The stone is cold. Ask Burl about it. |

### Rook's glass, now on the floor (OB-152 follow-up)

The nest no longer sits on the roof, so the player should never be told to climb. No current player string says "roof" or "Climb". These replace the Rook lines so that they point at the floor:

| key | line |
|---|---|
| rook.ford (6) | Old house by the crossing. Inside, on the floor. |
| rook.mirror.active | Old house by the crossing. Look on the floor. |

## Quest chain v2 lines (2026-10-15, DRAFT - owner to approve)

Writer, for `docs/sprints/quest-chain-plan-2026-10-15.md` "Version 2" (D-106). Offer lines end in a clear ask; the choices are `Accept` / `Not now`. Hand-in lines name the reward plainly and say who gives the next quest and where. Quest titles are exactly as in the plan table. Every line is ASCII and <= 56 chars. Nobody says "Wick" (Burl: "sky-cub", Rook: "fell-bird"), and no line uses "relay". Keys are left to the programmer.

### 1. Find a Blade (note on the tower wall -> Burl, outside the door)

Offer (note, written):
- `Steel lies at the top of the stair.`
- `Scavengers pick at the wreck up there.`
- `Don't walk out of here bare-handed.`
- `Climb. Take the blade. Then out the door.`

Hand-in (BURL, outside the door):
- `Out of the sky and up the stairs. Busy cub.`
- `Here, a Health Potion. Drink it when you bleed.`
- `Don't run off yet. I have work for that blade.`

### 2. Boars in the Woods (Burl)

Offer (BURL):
- `The boars in my woods have gone strange.`
- `They tear the bushes and charge at shadows.`
- `Drive off five of them for me. Will you?`

Hand-in (BURL):
- `Quiet again. Listen. You can hear the birds.`
- `Leather Armour. A hunter left it here. He ran.`
- `Talk to me again. I'll take you to the meadow stone.`

### 3. Follow the Bear (Burl -> Burl at the meadow stone)

Offer (BURL):
- `There is an old stone down in the meadow.`
- `I'd like you to see it. I walk slow; keep up.`
- `Will you come along, sky-cub?`

Walk talk (BURL, in order, one bark per stretch of path):
1. `I saw you fall, you know. Fire in the sky.`
2. `A burning bird, I thought. Then it hit the tower.`
3. `The woods are changing. Paths close up overnight.`
4. `Old trees groan at night now. They never used to.`
5. `And the boars. Boars don't charge at nothing.`
6. `Something frightens them. Something we can't see.`

Wait (BURL stops and turns back): `I'll wait. Old bears are good at waiting.`

Wolves attack (BURL): `Wolves! Stay close, sky-cub. Show them the blade.`

Hand-in (BURL, at the meadow stone):
- `Here it is. Older than the loud hill.`
- `A Heart Piece. Keep it; it makes you harder to fell.`
- `Now talk to me here. Let's see if the stone knows you.`

### 4. Wake the Stone (Burl at the meadow stone)

Offer (BURL):
- `Touch the carved mark. Let it wake.`
- `Waking is loud, though. The woods will hear it.`
- `Hold them back until it shines. Ready?`

Hand-in (BURL):
- `There. It knows you now.`
- `Here, 15 coin. Shiny things fall out of trees.`
- `Talk to me before you go. I'll point the way.`

### 5. The Stone at the Bend (Burl -> Rook at the Bend stone)

Offer (BURL, her farewell):
- `Follow the road west. There is another stone.`
- `At the bend. Goblins squat on it, last I smelled.`
- `These paws stay here. Will you go, sky-cub?`

Event on waking (stage note: a bright pulse shoots into the sky; a black bird drops onto the stone, shakes the light off its feathers):
- ROOK: `Well, that's unfortunate.`
- YOU: `What is?`
- ROOK: `You. You woke it.`
- ROOK: `That light? Everything for miles saw it.`
- ROOK: `Waking stones draws eyes, fell-bird. Old eyes.`
- ROOK: `And you can't even shoot. Talk to me.`

Hand-in (ROOK, `?` over him; grudging):
- `Here. A bow, and arrows. Don't make me sorry.`
- `You'll need reach. What comes, comes fast.`
- `Talk to me again. We walk to the river together.`

### 6. The River Road (Rook at the Bend -> Rook at the ford ruin)

Offer (ROOK, suspicious):
- `Waking stones draws eyes. Walk with me; I'll watch you.`
- `Road to the river. Stones across the ford.`
- `Something long and green sleeps in the shallows.`
- `Well? Are you coming?`

Hand-in (ROOK, at the ford ruin):
- `Still in one piece. I'm almost impressed.`
- `Two Health Potions. I don't drink them. You do.`
- `Look at the stone here. Then talk to me.`

### 7. The Missing Glass (Rook at the ford)

Cracked stone (look text, before the glass):
- `Cracked through. The glass mount is empty.`
- `No light in it. It cannot wake like this.`

Offer (ROOK):
- `Its glass? I kept it. Kept, not stole.`
- `It's in my old nest. Old house by the crossing.`
- `A bear moved in. A big black one. Rude.`
- `Fetch it back? I'll supervise. From up here.`

Glass set (stage text, as the first spell wakes):
- `The glass clicks home. Light runs along the crack.`
- `The stone hums, and something warm wakes in your hands.`

Hand-in (ROOK):
- `Mended. My glass, your stone. A fair loan.`
- `The stone gave you Spark. Take this Heart Piece too.`
- `Talk to me again. I'll tell you something. A little.`

### 8. Smoke in the North (Rook at the ford)

Offer (ROOK, trusting a little; the two hint lines first):
- `Years ago, someone else woke these stones.`
- `Then the eyes came, and the stones went dark.`
- `Look at the mark on the stone. Then go north.`
- `Goblins are burning a farm. Will you drive them off?`

Hand-in (ROOK):
- `Fire's out. People live out here. Fancy that.`
- `Here, a shield. Stop catching things with your face.`
- `Rest at the stone. Then find me here, at the ford.`

Notes: Quest 8's hint lines say no names, no builder, and nothing about the signal. They leave room for the knot / Maren hook (section 9) and the deferred M4 reveal. "The eyes" is never explained in chapter 1. Burl's "Leather Armour" and Rook's "Spark" are plain item names (canon: Spark is the first spell). The quest 5 event replaces `rook.meet` for this chain, and the quest 7 lines replace `rook.ford` / `rook.mirror.*` once the owner approves.

## Restless Graves (UNDER-07, writer DRAFT)

Writer, 2026-10-15, for UNDER-07 (quests) + UNDER-02 (crypt). D-105: offered, then `Accept` / `Exit`; nothing auto-starts. D-106: begin / objectives / end + reward / next. ASCII, every line <= 56 chars, HUD objectives <= 38. Nobody says "Wick" or "relay". Keys and amounts are left to the programmer.

Giver: **Bram, the post-keeper** (`postkeeper`). He keeps what people leave at the post, so an old key fits him; Rook would steal it, not keep it.

### Q1 Restless Graves (Bram)

Offer (BRAM):
- `There's an old graveyard out along the road.`
- `At night, something walks there. Bones, standing up.`
- `I don't go there after dark. Not any more.`
- `Go and look, after sundown. Will you?`

Choices: `Accept` / `Exit`

Journal (begin): `Bram says the dead walk at the old graveyard. Go there at night and see.`

Objectives (HUD):
1. `Visit the graveyard at night`
2. `Kill 3 skeletons (0/3)`
3. `Return to Bram at the post`

Hand-in (BRAM):
- `Three of them? And you walked back. Good.`
- `Here, 20 coins. Grave work should pay.`
- `There's more to this. Talk to me again.`

Reward (toast): `Reward: 20 coins`

### Q2 The Sealed Crypt (Bram)

Offer (BRAM):
- `By the graves there's a crypt. Sealed, years back.`
- `This is its key. I've kept it long enough.`
- `Go down and end what keeps them walking. Will you?`

Choices: `Accept` / `Exit`

On accept (toast): `Received: Crypt Key`

Journal (begin): `Bram gave you the Crypt Key. Open the crypt by the graves and go down to the last room.`

Objectives (HUD):
1. `Open the crypt`
2. `Reach the last room`
3. `Take what was sealed in`
4. `Return to Bram at the post`

Hand-in (BRAM):
- `Quiet down there now? Then it's done.`
- `Keep what was in the chest. It's yours now.`
- `And 2 Health Potions. Mind the stairs.`

Reward (toast): `Reward: 2 Health Potions, XP`

Closing line (BRAM, repeat talk after Q2):
- `That banner down there. A tower with a light on it.`
- `Like the far one. Folk here watched it too, once.`

### Inside the crypt (inspect, `[E] Look`)

Walls:
- `Old brick, black with smoke. Names cut in rows.`
- `Every name scraped off. Someone did not want them read.`

A coffin:
- `The lid is pushed aside. From the inside.`
- `Dust and dry earth. Nothing lies in it now.`

An old banner:
- `A rotted banner. Under the dirt: a tower and a light.`
- `The light is stitched in thread that is still teal.`

The last chest (before room 3 is clear):
- `Iron bands and a grey wax seal. Shut tight.`
- `It will not open while the dead still walk here.`

Notes: no family name on the crypt; the scraped names keep it canon-safe (a family name can be added later if the owner wants one). The banner and Bram's closing line only say that people once watched a light from a tower: no sender, no pattern, no date, so the deferred M4 "Signal Source" reveal stays open. Teal is the canon colour of magic; nothing here explains why the dead walk.

## BEND-NPC-01 (D-110)

PC-B writer, 2026-10-15. A second quest NPC, 2.5-3 m from the Bend Waystone. She gives and takes the Bend-area errands. Bram keeps the trade-post and ford ones. Dialogue lines are <= 56 chars, HUD objective/return lines <= 38, all ASCII, no raw ids, no "Esc". Accept / Not yet buttons stay generated; the accept/decline replies below are optional one-liners that play after the button (content may skip them).

**Name:** **Joss the road-mender** (label `JOSS`, HUD "Joss"). No name clash in docs/content.

**Who she is:** an exile like Bram. She keeps the road between the tower hill and the ford: she fills ruts, re-stacks the verge stones, and listens to the waystone's mount grind. She sits on an upturned bucket by the stone with a mallet and a sack of gravel.

Canon guards (same as Bram, QFIX-S5): she never says "Wick", never names the village, and never explains the signal or the blink. She says "you" or "your ship", not "flier" (that word is Bram's). Rook may perch on the same stone; she does not talk about him.

### Greeting (`joss.dialogue.json`)

| key | line |
|---|---|
| joss.hello.1 (1) (first talk) | Mind the ruts. I just filled them. |
| joss.hello.1 (2) | I'm Joss. I mend this road. Somebody has to. |
| joss.hello.2 (repeat) | Road's holding. Mostly. |
| joss.hello.3 (repeat, nothing to give) | Nothing for you today. The road's quiet. |

### Bram's handover remark (`postkeeper.dialogue.json`)

| key | line |
|---|---|
| postkeeper.handover (1) | Ask Joss by the Bend Waystone about that. |
| postkeeper.handover (2) (optional) | The Bend's her road. I keep the ford. |

Plays once, the first time the player talks to Bram after the move while a moved errand is open in an old save, or as a repeat line when Bram has nothing to offer.

### Quest ids that move from Bram to Joss (giver AND turnIn)

- `sq.rb.shield`, `sq.rb.regards`, `sq.rb.road`, `sq.rb.lamps`, `sq.rb.rocks`, `sq.rb.parcel` (the whole `sq.rb.*` set)
- `sq.fc.cog` (the cog is for the Bend Waystone's mount). It still requires `sq.fc.jetty` (Bram), so Bram's ford chain leads into it.
- `sq.rb.parcel` and `sq.fc.cog` are `deliver` steps: content must change `to: "postkeeper"` to the new NPC id. `sq.rb.parcel` gets a new reason (her mallet, not Bram's basket lid) and a new title, because "Ford" in the old title no longer fits.
- Stay with Bram: `sq.fc.ford`, `sq.fc.smoke`, `sq.fc.cross`, `sq.fc.again`, `sq.fc.jetty`, `sq.fc.stores`, `sq.fc.shrine`, `sq.post.spare`, `sq.packet`, `sq.burl.parcel` (all have targets at the post, the ford or the crossroads).

### Joss's errands (pack `lines`; giver and hand-in Joss)

`ready` plays at Joss. Lines marked "keep" are unchanged from Bram's set.

**sq.rb.shield "Left at the Bend"** (buckler given on offer)

| field | text |
|---|---|
| offer (1) | Someone left this buckler by the stone. No name. |
| offer (2) | Wear it down to the ford and back. Then show me. |
| accept | Strap it tight. The ford road bites. |
| decline | It'll keep. Nobody else came for it. |
| active | Buckler on your arm. Down to the ford, then back. (keep) |
| ready (1) | Fits you. Nobody came back for it. (keep) |
| ready (2) | Keep it. And a health potion, for the knocks. (keep) |
| done | Left for the next walker. That was you. |
| objText | Wear the buckler to the ford (keep) |
| returnText | Show the buckler to Joss |
| journal | Someone left a buckler at the Bend Waystone. Wear it to the ford, then show Joss. |

**sq.rb.regards "Word for Burl"**

| field | text |
|---|---|
| offer (1) | Tell Burl, up on the tower hill: the road's clear. (keep) |
| offer (2) | She asks after my road. Every season. |
| accept | Up the hill. Say it plain. Bears like plain. |
| decline | She'll wait. Bears are good at waiting. |
| active | Burl. Tower hill. The road's clear. That's all. (keep) |
| ready (1) | She heard? Good. She worries, for a bear. (keep) |
| ready (2) | Five arrows. Straight ones. (keep) |
| done | Road's clear, and the bear knows. Quiet day. (keep) |
| objText | Tell Burl the road is clear (keep) |
| returnText | Report to Joss at the Bend Waystone |
| journal | Joss has word for Burl: the road is clear. Carry it up her hill. |

**sq.rb.road "Down the Road West"**

| field | text |
|---|---|
| offer (1) | Walk the road back toward your tower, would you? (keep) |
| offer (2) | Then come back here to the stone. Tell me what moves. |
| accept | Watch the verges. Things hide in the long grass. |
| decline | Road's not going anywhere. Neither am I. |
| active | Back along the road. Then here, to the stone. |
| ready (1) | Nothing moving? Good. Nothing is good news. (keep) |
| ready (2) | Five arrows. Fair, for a walk. (keep) |
| done | Road walked. I'll sleep easier. (keep) |
| objText 1 / 2 | Walk back along the road / Come back to the Bend Waystone (keep) |
| returnText | Report to Joss at the Bend Waystone |

**sq.rb.lamps "Lamps on the Verge"**

| field | text |
|---|---|
| offer (1) | Old lamps stand along the road. Dark, mostly. (keep) |
| offer (2) | Walk the line of them. See if any still burn. (keep) |
| accept | All of them, mind. Not just the near ones. |
| decline | They've been dark a while. Another day won't hurt. |
| active | The lamps by the road. Walk the whole line. (keep) |
| ready (1) | All dark? Thought so. Someone trimmed them, once. (keep) |
| ready (2) | A health potion, for the walk. (keep) |
| done | Dark lamps. I'll get to them. One day. |
| objText | Walk along the lamps by the road (keep) |
| returnText | Report to Joss at the Bend Waystone |

**sq.rb.rocks "Rocks at the Forest Edge"**

| field | text |
|---|---|
| offer (1) | Rocks piled at the forest edge. Too neat for chance. (keep) |
| offer (2) | Not mine. I stack gravel, not cairns. Go and look. |
| accept | Look, don't move them. Old things mind being moved. |
| decline | They've stood this long. They'll stand a bit more. |
| active | The rocks at the forest edge. Look close. (keep) |
| ready (1) | Stacked, like a cairn? Old way-marks, then. (keep) |
| ready (2) | Five arrows. Mind the edge after dark. (keep) |
| done | Way-marks. Someone walked this road before us. (keep) |
| objText | Check the rocks by the forest edge (keep) |
| returnText | Report to Joss at the Bend Waystone |

**sq.rb.parcel, new title "Brass for the Bend"** (deliver to Joss)

| field | text |
|---|---|
| offer (1) | My mallet head works loose. Brass would hold it. |
| offer (2) | Bring me a brass scrap. Your ship dropped plenty. (keep) |
| accept | Any scrap. Flat is better. Bent will do. |
| decline | I'll tie it with string again. It's held so far. |
| active | One brass scrap. From your wreck, or anywhere. (keep) |
| ready (1) | Good brass. That'll hold the head on. |
| ready (2) | Ten arrows. Brass is worth that, out here. (keep) |
| done | Mallet's tight. Listen. Hear it ring? |
| objText | Bring the brass scrap to Joss |
| returnText | Hand the brass to Joss |
| journal | You carry a brass scrap for Joss. Hand it over at the Bend Waystone. |

**sq.fc.cog "A Cog for the Bend"** (deliver to Joss)

| field | text |
|---|---|
| offer (1) | The waystone's mount is short one cog. I hear it. |
| offer (2) | Bring me a brass cog. I'll fit it myself. (keep) |
| accept | Brass, toothed, about so big. You'll know it. |
| decline | It'll grind a while longer. I'll hear it. |
| active | One brass cog. You'll have one somewhere. (keep) |
| ready (1) | That'll do. It'll turn smooth now. (keep) |
| ready (2) | Ten arrows. Fair trade. (keep) |
| done | You won't see the cog turn. I will. (keep) |
| objText | Bring the cog to Joss |
| returnText | Hand the cog to Joss |
| journal | You carry a brass cog for Joss. Hand it over at the Bend Waystone. |

Notes: the "keep" lines were Bram's and read the same in Joss's mouth. Bram's old `sq.rb.parcel.done` ("Lid holds. The crow can't open it now.") goes away with the basket-lid reason. The QFIX-S5 Bram table rows for the moved ids are superseded by this section; Bram's hello lines are unchanged.

## Ford/Outwall notes (QUEST-WRITER-FILL-01)

Inspect texts in `content/dialogue/inspect.json` (written 2026-10-15; this item
cleared the stale NEEDS WRITER dev notes in `world_m1.world.json`). Lines <= 56.

**note.fordCellar** "A tally on a cellar beam" (cellarNote, Ford cellar)
- Salt, six sacks. Oil, four jars. All from the strand.
- Up the stairs by night. Never past the post lamp.
- The graves run is off. Nobody carries there now.
- Whoever goes down there, it is not one of ours.

**note.smugglers** "A note under a crate" (strandCaveNote, sea cave)
- Low tide only. By high water this floor is sea.
- Salt and oil go to the cellar under the Ford.
- Nothing more goes by the graves. Not after dark.
- Names off the walls down there. We never did that.

**note.owBoard** "Notices, nailed up" (owBoard, Outwall plaza)
- Crown notices, printed in Ferrum. Rain-soft.
- FELL BEYOND THE WALL. Name after name.
- Carried out here and nailed up, one by one.
- One line cut away. On the nail, a skyworks knot.

**note.pierStone** "A standing stone" (pierStone, Outwall track)
- A dressed block, set on end beside the track.
- Old mortar on one face. Once part of a bridge pier.
- A Crown stamp, half chiselled away.
- The bridge was pulled down. Not by the river.

## The Road West (OB-210)

Main quest `burl.road`: Burl offers it right after the stone hand-in, Rook takes
the hand-in at the Bend, then his own meet chain (`rook.meet.*`) offers
`mq.bend.call`. Lines <= 56. Rook's lines come before he gives his name.

Quest: title `The Road West`, return `Talk to Rook`.
- road: `Take the old road west` / journal "Burl says the old road runs west to a bend."
- find: `Find the cold waystone at the bend` / "A cold waystone stands where the road bends."
- wake: `Wake the Bend waystone` / "Hold the crystal to the carved mark."

**bear.road.offer** (BURL; choices "I'll go west." / "Not yet.")
- One more thing. The old road runs west to a bend.
- There's a waystone there, cold as this one was.
- A crow keeps watch on it. Rook. He talks a lot.

**bear.road.go** (BURL)
- West is yours, sky-cub. I'm off to my berries.
- Tell Rook the bear sent you.

**bear.road.later** (BURL)
- Rest first, then. The road will keep. Roads do.

**bear.road.active** (BURL)
- The Bend waystone is west, where the road turns.
- Hold the crystal to the mark, same as here.

**rook.bend.ready.1** (ROOK)
- Cold stone, warm now. I watched it wake.

**rook.bend.ready.2** (ROOK, then `rook.meet.1` "Ha. The fell-bird walks.")
- The bear sent you. Big paws. Slow. Like you.

## R19 writer batches

Journal lines over the R19 38-char limit, allow-listed in `R19_ALLOW` (`tools/validate-content.mjs`). Generated by `node tools/validate-content.mjs --r19-by-pack` (lines of one pack: `--r19-by-pack --list <pack>`). Counts only; one writer batch per pack under `content/quests/`.

| Pack | Lines over 38 |
|---|---|
| ch12/pack.json | 52 |
| ch3/pack.json | 17 |
| m1.quest.json | 13 |
| regions/pack.json | 10 |
| ch3b/pack.json | 6 |
| tower.blade.quest.json | 3 |
| under.crypt.quest.json | 3 |
| mq.bend.call.quest.json | 2 |
| mq.ford.mirror.quest.json | 2 |
| mq.smoke.quest.json | 2 |
| sq.burl.blue.quest.json | 2 |
| under.graves.quest.json | 2 |
| burl.boars / burl.follow / burl.stone / mq.ford.stones / mq.river.road (.quest.json) | 1 each (5) |
| **Total** | **119** |
