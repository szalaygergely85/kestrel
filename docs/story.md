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

## 9. PROPOSAL (2026-09-24): the vanished one

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
