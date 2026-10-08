# WAYSTONE-01 healing, save point and respawn simulation

## Result

Pure createWaystone(world, player, {waystones, spawn, requestSave}) stores the plain JSON {waystoneId,pos} in world.state.waystone, using the existing World serializer and game save envelope. No new save version, storage adapter, death controller or teleport implementation. Each authored waystone has an id and a safe respawn anchor {x,y,z,yawDeg}. The caller supplies the initial spawn fallback explicitly; it is preserved even if the player moves before saving. An unloaded/unknown saved waystone id remains usable through its saved anchor.

A valid touch(id) commits the point, mirrors save.x/y/z/yaw (the existing vitals checkpoint keys), heals player.components.health.hp to its live max, then calls requestSave once. Repeated deliberate touches each heal/save once; an unknown id returns false with no effects. Save callback failure propagates without undoing the committed healing/checkpoint. The host handles its existing save-failure result/message.

onDeath() heals and returns a copied respawn pose while mirroring the checkpoint keys. The host/vitals still owns teleport, death fade, body velocity reset, mana restoration, enemy reset and facing synchronization. No added per-frame callback. snapshot() and the death return are cold copies, so callers cannot alter saved state through aliases. Definitions are copied and validated at create; saved malformed points/invalid ids and duplicate definitions fail before replacing checkpoint state. The player health component must already be initialized by vitals; this module reads that single source and never creates a competing health record.

## Validation

Focused waystone test PASS:
- Full hearts on touch/death; latest touched point and no-touch initial fallback.
- Exactly one save callback per valid touch; the actual collected save contains full hearts and committed waypoint.
- Existing collectSave/applySave round trip is byte-stable, including moved-player fallback saves.
- Same sequence produces the same saved bytes; definition mutation/public snapshot mutation cannot move the checkpoint.
- Saved point works when its prop is not loaded; duplicate/malformed definitions and malformed saved position rejected.
- A changed live max is respected; repeated touches and failing save callbacks preserve expected state.
- Real createVitals death timeline followed by E respawn reaches the touched anchor/yaw, restores full hearts and clears velocity through existing vitals.

Full suite: 311/311 PASS, 0 FAIL/TIMEOUT/WARN. check-deps OK (547 files, 1,356 existing warnings); diff clean. Final sync c2fbe55 adds PC-A marker design/preview and queue/docs changes, no waystone/vitals/save changes; merged content 13/13 and boot 1/1 PASS.

## Integration and scope

WAYSTONE-01w waits for gameHooks ARCH OK and S8-A-08 waystone prop. The wire module will forward prop:touched, request autosave and display supplied writer toasts; onRespawn can return this module's pose. It must create the module after vitals has initialized health and use the original spawn anchor rather than a moved player's transform as fallback. No wire/main.js/seam/engine/content/design edits in this step. No owner look required by this pure-sim story; no visible gameplay claim. Existing UI/capture look risks remain unchanged.

Owner world_m1 local placements preserved and excluded: SHA256 3A6EF838193922AFC30C0B7200FC7A78259B4796C06D1932AB128848BB5D3B40.
