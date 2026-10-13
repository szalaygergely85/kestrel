# M3 exit walk - stranger script (PC-B, 2026-10-09)

Goal: a stranger plays wake -> tower -> breach -> sword -> boars -> waystone -> end with no help. Tester watches, does not hint. Build: pc-b with Settings panel, title menu, waystone, hit-stop 70 ms. Objective text from `content/quests/m1.quest.json`. Note: the boar objective still reads "Bring down the two wild boars" until QUEST-CHAIN-02c (5 boars) lands - then expect the new count text and boar1..boar5.

| # | Do | Should see | Pass |
|---|----|-----------|------|
| 1 | Open the page. | Title menu: New / Continue (newest save) / Load (list with dates) / Settings / Credits. | [ ] |
| 2 | Settings: open it, change the Quality row, close; reboot-only items are labelled. | Panel opens from title; Quality applies live; choice survives reload. Text size / reduce motion are shown but do nothing (known). | [ ] |
| 3 | New game. | Objective `wake`: "Get up from the wreck". Move/look hints appear one at a time. | [ ] |
| 4 | Get up; walk to the burner, take the lamp. | Hint "The burner still glows. Take what light you can." Objective `lantern`: "Take the Kestrel's lamp"; lamp lights the dark. | [ ] |
| 5 | Climb the tower. | Hint "Climb. You cannot see the signal from down here." Objective `breach`: "Climb to the breach at the top"; area `breach` completes it; scrawl NOT NOTHING at the parapet. | [ ] |
| 6 | Just outside the breach, find Burl the bear (EP-TALK, once landed). | Bear is upright, idle, on a spot clear of the path; talk opens the dialogue box with the BURL name tag; the choice works; talk is optional and does not block. | [ ] |
| 7 | Take the sword. | Objective `sword`: "Take up the ruin steel"; sword in hand, swing works. | [ ] |
| 8 | Walk the hillside toward the waystone until the first boar notices you. | Boars at (x,y): 1461,1031; 1444,1035; 1472,1050; 1452,1054; 1431,1054 (world_m1, 5 total). First-fight hint once: "Step aside late. Boars turn slow." | [ ] |
| 9 | Fight. Land a hit. | Hit-stop about 70 ms on the hit; boar reacts; hp bar drops. No damage from boars out of their range. | [ ] |
| 10 | Die on purpose (or by accident) once. | Death fade, line "Dark again. The light still blinks.", respawn without a stuck input; progress kept. | [ ] |
| 11 | Win the fight. | Objective `beasts` completes only when all required boars are down. | [ ] |
| 12 | Walk the pencil line to the waystone, touch it. | Objective `waystone`: "Walk the pencil line to the waystone"; stone toast (title "The Waystone"), full heal, save written, respawn point set. | [ ] |
| 13 | Die once after the stone (optional). | Wake line "I wake against the humming stone." at the stone, not at the start. | [ ] |
| 14 | Finish. | End card shows; reload -> Continue (newest) restores the waystone state; Load lists the save with a date. | [ ] |

## Owner questions (tester answers each yes/no + note)
1. Is the boar telegraph readable at 240x90? [ ]  2. Does a hit clearly land (stop, flash, sound)? [ ]  3. Was any damage unfair? [ ]  4. Was death + respawn clear? [ ]  5. FPS on the iGPU acceptable (note the number)? [ ]

## Known risks to watch
- **5-boar margin:** the full fight has a one-hit hp margin (BEAST-TUNING-01). Note how many deaths a stranger needs; 3+ deaths = too hard.
- **No dodge:** only the hint "step aside late" exists; there is no dodge/block key. Watch whether strangers look for one.
- **Settings not wired:** text size and reduce motion are saved but no system reads them yet; do not fail the walk for it.
- **Bear spot:** Burl's position outside the breach is unconfirmed; check she is reachable, not inside a collider, and does not block the exit path or boar leash (about 15 m radius).
