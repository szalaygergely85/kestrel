# M3 exit walk - unexecuted owner checklist

Use a fresh save slot. Ask someone unfamiliar with the route to play without
coaching. Record the browser, GPU, resolution, quality preset and build commit.
Leave each box unchecked until observed. This is a script, not a PASS report.

The current production quest has two boars. D-053 approves five, but
QUEST-CHAIN-02c has not landed in this clone. Recheck the beasts row after that
content change. The waystone beat currently uses the end trigger; touching,
healing and respawning at a stone belong to the pending WAYSTONE-01w wire.

| Observed | Step and exact HUD cue | Real objective condition | What to record |
|---|---|---|---|
| [ ] | Wake: `Get up from the wreck` | `wake`: flag `wake` equals true | Wake ends and next objective appears. Relay reads `wakeDone`. |
| [ ] | Tower lamp: `Take the Kestrel's lamp` | `lantern`: item `lantern` | Player finds and takes the lamp. Relay reads `tower.lantern.taken`. |
| [ ] | Tower summit: `Climb to the breach at the top` | `breach`: area `breach` | Reach the placed tower's breach marker; relay checks <=3 m XY and <=2.5 m vertical distance. |
| [ ] | Sword: `Take up the ruin steel` | `sword`: item `sword` | Take the sword, then verify the beasts objective. Relay reads `tower.sword.taken`. |
| [ ] | Hillside: `Bring down the two wild boars` | `beasts`: `boar1`, `boar2`, count 2 | Fight both. Record whether a stranger understands windup, charge and recovery. |
| [ ] | Waystone route: `Walk the pencil line to the waystone` | `waystone`: area `waystone`, mapped to world `world_m1` trigger `end` | Follow the chart route to the end trigger. Relay observes `quest.endT >= 0`; the beat is not currently proof of a stone touch. |

All six HUD strings and objective ids above match
`content/quests/m1.quest.json`. Area mappings match `content/quests/areas.json`.
Fact bridging is in `game/js/questRelay.js` and `game/js/saveRelay.js`.

Pending stone/death observations, once their wires are integrated:

- [ ] Touch cue is the writer's `[E] Touch the waystone`.
- [ ] Save toast is `Saved. The stone will remember.`
- [ ] Heal toast is `Warmth in the hands. Hearts full.`
- [ ] Death and respawn cues appear and the player knows where they woke.
  The writer's selected death line is 39 characters against the 38-character
  target (DEATH-TEXT-01 WIP); do not treat it as approved slot-fitting copy.
  Authored wake lines are `I wake against the humming stone.` and
  `No stone yet. I wake by the wreck.`. Toasts/wake text are writer contract
  expectations, not claims that the current runtime displays them.

Ask the owner these five questions, and record an answer plus one example:

1. At 240x90, can you read the boar's telegraph before it charges?
2. Does a sword hit visibly land, with understandable timing and feedback?
3. Did any damage feel unfair? Record distance, camera angle and boar state.
4. Are death, the respawn location and recovered health clear?
5. What FPS do you see on the iGPU along the route and during the fight?
   Record the hardware and preset alongside the number.

Preparation checks: production content lint reports content OK (3462 checks,
3 mesh-only models). Each row was cross-checked against production quest JSON
and the current relay. No owner walk or iGPU FPS measurement has been run.
Full test gate remains pending while other lanes occupy the machine.
