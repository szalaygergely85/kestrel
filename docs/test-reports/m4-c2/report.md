# M4-C2 scripted fresh-player Ch1-2 run

Date: 2026-10-12. Tool: `node tools/verify-ch12-run.mjs <port>`.

| AC | Result |
|---|---|
| AC1 all Ch1-2 beats + errands done | FAIL |
| AC2 gear equipped + shown | PASS |
| AC3 save / Continue byte-stable | FAIL |
| AC4 guidance gaps (> 30 s blind) | 0 rows |

## Quests (AC1)

| Quest | Status | Last objective | Forced step |
|---|---|---|---|
| m1 | done | - | - |
| tower.blade | done | - | - |
| burl.boars | done | - | - |
| sq.burl.blue | active | sprigs (collect berry.blue) | not available (no giver site): {"sq.burl.blue":"unavailable"} |
| mq.river.road | done | - | - |
| mq.ford.stones | done | - | - |
| mq.bend.call | done | - | - |
| mq.ford.mirror | done | - | - |
| mq.smoke | done | - | - |
| sq.tm.nub | available | - | not accepted at burl: {"sq.tm.nub":"available"} |
| sq.burl.boars.n | available | kill (beasts boarN1+boarN2+boarN3) | not accepted at burl: {"sq.burl.boars.n":"available"} |
| sq.burl.boars.w | unavailable | kill (beasts boarW1+boarW2) | not accepted at burl: {"sq.burl.boars.w":"unavailable"} |
| sq.burl.boars.s | unavailable | kill (beasts boarS1+boarS2+boarS3) | not accepted at burl: {"sq.burl.boars.s":"unavailable"} |
| sq.burl.meat | available | fetch (item boar.meat) | not accepted at burl: {"sq.burl.meat":"available"} |
| sq.burl.stone | available | - | not accepted at burl: {"sq.burl.stone":"available"} |
| sq.burl.hint | unavailable | - | not accepted at burl: {"sq.burl.hint":"unavailable"} |
| sq.burl.tower | available | - | not accepted at burl: {"sq.burl.tower":"available"} |
| sq.burl.scout | unavailable | - | not accepted at burl: {"sq.burl.scout":"unavailable"} |
| sq.burl.ask | unavailable | talk (flag talk.notePost) | not accepted at burl: {"sq.burl.ask":"unavailable"} |
| sq.burl.walk | available | escort (flag escort.bear.relayBend) | not accepted at burl: {"sq.burl.walk":"available"} |
| sq.burl.parcel | unavailable | deliver (deliver boar.meat) | not accepted at burl: {"sq.burl.parcel":"unavailable"} |
| sq.post.spare | unavailable | - | not accepted at post: {"sq.post.spare":"unavailable"} |
| sq.straw | unavailable | t1 (flag target1.hit) | not accepted at notePost: {"sq.straw":"unavailable"} |
| sq.rb.shield | done | - | equipped shield by hand (requireEquipped); the real equip flow is not driven here |
| sq.rb.regards | done | - | - |
| sq.rb.road | done | - | - |
| sq.fc.ford | done | - | - |
| sq.fc.smoke | done | - | - |
| sq.fc.cross | done | - | - |
| sq.fc.again | done | - | - |
| sq.tm.gap | available | explore (area fenceGap) | not accepted at burl: {"sq.tm.gap":"available"} |
| sq.tm.wood | unavailable | explore (area woodpile) | not accepted at burl: {"sq.tm.wood":"unavailable"} |
| sq.tm.cart | unavailable | explore (area wagon) | not accepted at burl: {"sq.tm.cart":"unavailable"} |
| sq.rb.lamps | done | - | - |
| sq.rb.rocks | done | - | - |
| sq.rb.parcel | done | - | - |
| sq.he.wallow | done | - | - |
| sq.he.farm | unavailable | explore (area farmGate) | not accepted at burl: {"sq.he.farm":"unavailable"} |
| sq.dw.bees | unavailable | explore (area beeFarm) | not accepted at burl: {"sq.dw.bees":"unavailable"} |
| sq.dw.stones | unavailable | explore (area standStones) | not accepted at burl: {"sq.dw.stones":"unavailable"} |
| sq.fc.stores | done | - | - |
| sq.fc.caps | active | collect (collect redcap) | collect: cannot get 5 x redcap: 0 in pack, pickups tried: [] |
| sq.fc.well | done | - | - |
| sq.fc.shrine | unavailable | explore (area shrine) | not accepted at notePost: {"sq.fc.shrine":"unavailable"} |
| sq.fc.jetty | done | - | - |
| sq.fc.cog | done | - | - |
| sq.fc.ask | done | - | - |
| sq.rook.gift | ready | - | not handed in at burl: {"sq.rook.gift":"ready"} |
| sq.wreck.plate | available | fetch (item boar.hide) | giver site gondola has no interactable mapping in the script |
| sq.honey | done | - | - |
| sq.rook.shiny | done | - | - |
| sq.packet | available | deliver (deliver packet) | giver site packet has no interactable mapping in the script |
| sq.burl.fire | done | - | - |

Steps the script had to feed by hand (the real interaction did not fire by itself; each is a candidate bug):

- E2 collect + deliver six blue berries (sq.burl.blue): not accepted: {"sq.burl.blue":"unavailable","burl.boars":"done"} st=["burl.follow=true","burl.phase=5","burl.wp=5","burl.arrived=true","burl.depart=true","burl.departing=false","burl.home=true"] log []
- E1 explore (sq.burl.tower): not accepted: {"sq.burl.tower":"unavailable","burl.boars":"done"} st=["burl.follow=true","burl.phase=5","burl.wp=5","burl.arrived=true","burl.depart=true","burl.departing=false","burl.home=true"] log []
- E3 talk (ask Burl for Rook) (sq.fc.ask): not accepted: {"sq.fc.ask":"unavailable","burl.boars":"done"} st=["burl.follow=true","burl.phase=5","burl.wp=5","burl.arrived=true","burl.depart=true","burl.departing=false","burl.home=true"] log []
- E4 deliver a brass scrap from Rook to Burl (sq.rook.gift): not accepted: {"sq.rook.gift":"unavailable","burl.boars":"done"} st=["burl.follow=true","burl.phase=5","burl.wp=5","burl.arrived=true","burl.depart=true","burl.departing=false","burl.home=true"] log []
- E5 escort Burl to the Bend relay (sq.burl.walk): not accepted: {"sq.burl.walk":"unavailable","burl.boars":"done"} st=["burl.follow=true","burl.phase=5","burl.wp=5","burl.arrived=true","burl.depart=true","burl.departing=false","burl.home=true"] log []
- E6 target hits (sq.nub then sq.straw: three straw men): sq.straw not accepted: {"sq.tm.nub":"unavailable","sq.straw":"unavailable"}
- AC1 all Ch1-2 beats + errands done: sq.burl.blue=active@sprigs (collect berry.blue), sq.tm.nub=available@-, sq.burl.boars.n=available@kill (beasts boarN1+boarN2+boarN3), sq.burl.boars.w=unavailable@kill (beasts boarW1+boarW2), sq.burl.boars.s=unavailable@kill (beasts boarS1+boarS2+boarS3), sq.burl.meat=available@fetch (item boar.meat), sq.burl.stone=available@-, sq.burl.hint=unavailable@-, sq.burl.tower=available@-, sq.burl.scout=unavailable@-, sq.burl.ask=unavailable@talk (flag talk.notePost), sq.burl.walk=available@escort (flag escort.bear.relayBend), sq.burl.parcel=unavailable@deliver (deliver boar.meat), sq.post.spare=unavailable@-, sq.straw=unavailable@t1 (flag target1.hit), sq.tm.gap=available@explore (area fenceGap), sq.tm.wood=unavailable@explore (area woodpile), sq.tm.cart=unavailable@explore (area wagon), sq.he.farm=unavailable@explore (area farmGate), sq.dw.bees=unavailable@explore (area beeFarm), sq.dw.stones=unavailable@explore (area standStones), sq.fc.caps=active@collect (collect redcap), sq.fc.shrine=unavailable@explore (area shrine), sq.rook.gift=ready@-, sq.wreck.plate=available@fetch (item boar.hide), sq.packet=available@deliver (deliver packet)
- AC3b Continue restores position, hearts, items, gear, quick bar, quests, flags: tracked @0/2,2 47 -> 59 // warns: [LightSet] MAX_LIGHTS reached, dropping light entity.tradeLamp / [LightSet] MAX_LIGHTS reached, dropping light entity.rsLamp1 / [LightSet] MAX_LIGHTS reached, dropping light entity.rsLamp2 / [LightSet] MAX_LIGHTS reached, dropping light entity.relayOutwall
- E+ sq.rb.shield: equipped shield by hand (requireEquipped); the real equip flow is not driven here
- E+ sq.fc.caps: collect: cannot get 5 x redcap: 0 in pack, pickups tried: []
- E+ sq.wreck.plate: giver site gondola has no interactable mapping in the script
- E+ sq.packet: giver site packet has no interactable mapping in the script
- E+ sq.burl.blue: not available (no giver site): {"sq.burl.blue":"unavailable"}
- E+ sq.tm.nub: not accepted at burl: {"sq.tm.nub":"available"}
- E+ sq.burl.boars.n: not accepted at burl: {"sq.burl.boars.n":"available"}
- E+ sq.burl.boars.w: not accepted at burl: {"sq.burl.boars.w":"unavailable"}
- E+ sq.burl.boars.s: not accepted at burl: {"sq.burl.boars.s":"unavailable"}
- E+ sq.burl.meat: not accepted at burl: {"sq.burl.meat":"available"}
- E+ sq.burl.stone: not accepted at burl: {"sq.burl.stone":"available"}
- E+ sq.burl.hint: not accepted at burl: {"sq.burl.hint":"unavailable"}
- E+ sq.burl.tower: not accepted at burl: {"sq.burl.tower":"available"}
- E+ sq.burl.scout: not accepted at burl: {"sq.burl.scout":"unavailable"}
- E+ sq.burl.ask: not accepted at burl: {"sq.burl.ask":"unavailable"}
- E+ sq.burl.walk: not accepted at burl: {"sq.burl.walk":"available"}
- E+ sq.burl.parcel: not accepted at burl: {"sq.burl.parcel":"unavailable"}
- E+ sq.post.spare: not accepted at post: {"sq.post.spare":"unavailable"}
- E+ sq.straw: not accepted at notePost: {"sq.straw":"unavailable"}
- E+ sq.tm.gap: not accepted at burl: {"sq.tm.gap":"available"}
- E+ sq.tm.wood: not accepted at burl: {"sq.tm.wood":"unavailable"}
- E+ sq.tm.cart: not accepted at burl: {"sq.tm.cart":"unavailable"}
- E+ sq.he.farm: not accepted at burl: {"sq.he.farm":"unavailable"}
- E+ sq.dw.bees: not accepted at burl: {"sq.dw.bees":"unavailable"}
- E+ sq.dw.stones: not accepted at burl: {"sq.dw.stones":"unavailable"}
- E+ sq.fc.shrine: not accepted at notePost: {"sq.fc.shrine":"unavailable"}
- E+ sq.rook.gift: not handed in at burl: {"sq.rook.gift":"ready"}

## Main beats (stills)

| Beat | Game t (s) | Still |
|---|---|---|
| 1 wake in the tower | 0 | ![1 wake in the tower](beat-01-1-wake-in-the-tower.png) |
| 2 read the note (tower.blade offered/accepted) | 1 | ![2 read the note (tower.blade offered/accepted)](beat-02-2-read-the-note-tower-blade-offe.png) |
| 3 take the sword, leave the tower | 2 | ![3 take the sword, leave the tower](beat-03-3-take-the-sword-leave-the-tower.png) |
| 4 Burl: hand in the blade, boar quest accepted | 3 | ![4 Burl: hand in the blade, boar quest accepted](beat-04-4-Burl-hand-in-the-blade-boar-qu.png) |
| 5 kill the five boars -> burl.boars ready | 4 | ![5 kill the five boars -> burl.boars ready](beat-05-5-kill-the-five-boars-burl-boars.png) |
| 6 Burl: hand in the boar quest | 5 | ![6 Burl: hand in the boar quest](beat-06-6-Burl-hand-in-the-boar-quest.png) |
| 7 walk to the waystone with Burl (burl.arrived), wake the stone | 6 | ![7 walk to the waystone with Burl (burl.arrived), wake the stone](beat-07-7-walk-to-the-waystone-with-Burl.png) |
| 8 Burl says goodbye and goes home (burl.home) | 7 | ![8 Burl says goodbye and goes home (burl.home)](beat-08-8-Burl-says-goodbye-and-goes-hom.png) |
| 9 road west + Bend relay found (roadWest, bendRelay) | 8 | ![9 road west + Bend relay found (roadWest, bendRelay)](beat-09-9-road-west-Bend-relay-found-roa.png) |
| 10 Bend relay wakes (relay1), SOS pulse seen, knot read | 9 | ![10 Bend relay wakes (relay1), SOS pulse seen, knot read](beat-10-10-Bend-relay-wakes-relay1-SOS-p.png) |
| 11 Rook: Bend call (mq.bend.call) accepted + handed in | 10 | ![11 Rook: Bend call (mq.bend.call) accepted + handed in](beat-11-11-Rook-Bend-call-mq-bend-call-a.png) |
| 12 river bank + ford stones (mq.river.road, mq.ford.stones) | 11 | ![12 river bank + ford stones (mq.river.road, mq.ford.stones)](beat-12-12-river-bank-ford-stones-mq-riv.png) |
| 13 mirror: Rook gives mq.ford.mirror, take relay.mirror from the nest | 12 | ![13 mirror: Rook gives mq.ford.mirror, take relay.mirror from the nest](beat-13-13-mirror-Rook-gives-mq-ford-mir.png) |
| 14 Ford relay wakes -> mq.ford.mirror done | 13 | ![14 Ford relay wakes -> mq.ford.mirror done](beat-14-14-Ford-relay-wakes-mq-ford-mirr.png) |

## Gear (AC2)

```
{"main":"sword","off":"shield","left":"sword","right":"shield","vm":false}
```

## Guidance-gap table (AC4)

Sampled every 5 s; a row = a stretch longer than 30 s with no tracked HUD objective, no compass target and no ! / ? giver within view range.

No gaps.

## Save compare (AC3)

```
[
 {
  "name": "tracked",
  "before": 47,
  "after": 59
 }
]
```

## Notes

- 279 samples every 5 s of wall time; the script teleports between beats, so the "where" is the spot the player stood at while a beat ran (event = beat name)
- compass column = __debug.compassRetarget() has a target; giver = a ! / ? giver within 30 m
- console errors: 0
