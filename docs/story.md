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
