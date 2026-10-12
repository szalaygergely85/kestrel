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
| sq.burl.blue | done | - | - |
| mq.river.road | done | - | - |
| mq.ford.stones | done | - | - |
| mq.bend.call | done | - | - |
| mq.ford.mirror | done | - | - |
| mq.smoke | active | mark (flag lore.fordMark.read) | - |
| sq.tm.nub | done | - | - |
| sq.burl.boars.n | active | kill (beasts boarN1+boarN2+boarN3) | - |
| sq.burl.boars.w | unavailable | kill (beasts boarW1+boarW2) | - |
| sq.burl.boars.s | unavailable | kill (beasts boarS1+boarS2+boarS3) | - |
| sq.burl.meat | active | fetch (item boar.meat) | - |
| sq.burl.stone | done | - | - |
| sq.burl.hint | done | - | - |
| sq.burl.tower | done | - | - |
| sq.burl.scout | unavailable | - | - |
| sq.burl.ask | unavailable | talk (flag talk.notePost) | - |
| sq.burl.walk | active | escort (flag escort.bear.relayBend) | - |
| sq.burl.parcel | unavailable | deliver (deliver boar.meat) | - |
| sq.post.spare | unavailable | - | - |
| sq.straw | done | - | - |
| sq.rb.shield | available | - | - |
| sq.rb.regards | unavailable | - | - |
| sq.rb.road | unavailable | - | - |
| sq.fc.ford | ready | - | - |
| sq.fc.smoke | unavailable | - | - |
| sq.fc.cross | unavailable | - | - |
| sq.fc.again | unavailable | - | - |
| sq.tm.gap | done | - | - |
| sq.tm.wood | done | - | - |
| sq.tm.cart | active | explore (area wagon) | - |
| sq.rb.lamps | available | - | - |
| sq.rb.rocks | unavailable | - | - |
| sq.rb.parcel | unavailable | - | - |
| sq.he.wallow | active | explore (area wallow) | - |
| sq.he.farm | unavailable | explore (area farmGate) | - |
| sq.dw.bees | unavailable | explore (area beeFarm) | - |
| sq.dw.stones | unavailable | explore (area standStones) | - |
| sq.fc.stores | available | kill (beasts boarF1+boarF2) | - |
| sq.fc.caps | active | collect (collect redcap) | - |
| sq.fc.well | done | - | - |
| sq.fc.shrine | available | explore (area shrine) | - |
| sq.fc.jetty | unavailable | explore (area jetty) | - |
| sq.fc.cog | unavailable | deliver (deliver cog) | - |
| sq.fc.ask | done | - | - |
| sq.rook.gift | done | - | - |
| sq.wreck.plate | available | fetch (item boar.hide) | - |
| sq.honey | done | - | - |
| sq.rook.shiny | active | collect (collect brass.scrap) | - |
| sq.packet | available | deliver (deliver packet) | - |

Steps the script had to feed by hand (the real interaction did not fire by itself; each is a candidate bug):

- E3 talk (ask Burl for Rook) (sq.fc.ask): E did not open the dialogue with rook {"note":false,"notice":false,"ist":null,"ix":true,"ixAt":[974.9,1056.4,-82.07,2.2],"ent":[974.9,1056.4,-83.07],"me":[972.6999999999999,1056.4,-83.12299998760223],"dist":2.2000000000000455,"dz":-0.052999987602234455,"lock":true,"wake":false}
- E5 escort Burl to the Bend relay (sq.burl.walk): not handed in: {"sq.burl.walk":"active"}
- AC1 all Ch1-2 beats + errands done: mq.smoke=active@mark (flag lore.fordMark.read), sq.burl.boars.n=active@kill (beasts boarN1+boarN2+boarN3), sq.burl.boars.w=unavailable@kill (beasts boarW1+boarW2), sq.burl.boars.s=unavailable@kill (beasts boarS1+boarS2+boarS3), sq.burl.meat=active@fetch (item boar.meat), sq.burl.scout=unavailable@-, sq.burl.ask=unavailable@talk (flag talk.notePost), sq.burl.walk=active@escort (flag escort.bear.relayBend), sq.burl.parcel=unavailable@deliver (deliver boar.meat), sq.post.spare=unavailable@-, sq.rb.shield=available@-, sq.rb.regards=unavailable@-, sq.rb.road=unavailable@-, sq.fc.ford=ready@-, sq.fc.smoke=unavailable@-, sq.fc.cross=unavailable@-, sq.fc.again=unavailable@-, sq.tm.cart=active@explore (area wagon), sq.rb.lamps=available@-, sq.rb.rocks=unavailable@-, sq.rb.parcel=unavailable@-, sq.he.wallow=active@explore (area wallow), sq.he.farm=unavailable@explore (area farmGate), sq.dw.bees=unavailable@explore (area beeFarm), sq.dw.stones=unavailable@explore (area standStones), sq.fc.stores=available@kill (beasts boarF1+boarF2), sq.fc.caps=active@collect (collect redcap), sq.fc.shrine=available@explore (area shrine), sq.fc.jetty=unavailable@explore (area jetty), sq.fc.cog=unavailable@deliver (deliver cog), sq.wreck.plate=available@fetch (item boar.hide), sq.rook.shiny=active@collect (collect brass.scrap), sq.packet=available@deliver (deliver packet)
- AC3b Continue restores position, hearts, items, gear, quick bar, quests, flags: tracked @0/2,2 32 -> 50 // warns: [LightSet] MAX_LIGHTS reached, dropping light entity.tradeLamp / [LightSet] MAX_LIGHTS reached, dropping light entity.rsLamp1 / [LightSet] MAX_LIGHTS reached, dropping light entity.rsLamp2 / [LightSet] MAX_LIGHTS reached, dropping light entity.relayOutwall

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
{"main":"sword","off":null,"left":"sword","right":null,"vm":false}
```

## Guidance-gap table (AC4)

Sampled every 5 s; a row = a stretch longer than 30 s with no tracked HUD objective, no compass target and no ! / ? giver within view range.

No gaps.

## Save compare (AC3)

```
[
 {
  "name": "tracked",
  "before": 32,
  "after": 50
 }
]
```

## Notes

- --walk: 1202 samples, one per walked game-second at 4 m/s straight-line (walls ignored, waits/dialogue not counted); gap rows split into main line vs errand (E1-E6) in the Line column. 1202 samples every 5 s of wall time; the script teleports between beats, so the "where" is the spot the player stood at while a beat ran (event = beat name)
- compass column = __debug.compassRetarget() has a target; giver = a ! / ? giver within 30 m
- console errors: 0
