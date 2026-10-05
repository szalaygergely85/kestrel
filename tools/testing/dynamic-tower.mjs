// TOWER-LEVER-01: explicit test-only fixture for generic dynamic-sector tests.
// Shipping tower data remains open; animation/packing/refit coverage stays live.
// TOWER-BOULDER-01: shipping content no longer spawns the roller boulder (owner
// 2026-10-05: it slid instead of rolling, so it was removed from the level). The
// dynamic-prop machinery itself (body+roller spawn, uniform scaling, the
// grid-vs-mesh roll trace, serialize round trips) is engine behaviour and must
// stay covered, so this fixture re-adds the same prop the tower used to author -
// `x`/`y`/`z`/`radius` are the values tower.level.json carried.
export function dynamicTowerFixture(def) {
  const tower = structuredClone(def);
  tower.legend.G = { floorH: 3, ceilH: 3, ceilMat: 'iron', floorMat: 'floor',
    wallMat: 'stone', solid: false, tag: 'grate', topH: 6.6, upperMat: 'grate', zone: 'upper',
    dynamic: { ceilOpen: 5.4, ease: 'inOut', openTime: 1.5 } };
  tower.props.push({ id: 'lever', model: 'lever', variant: 'idle', facing: 90, x: 19.25, y: 9.3, z: 3 });
  tower.props.push({ id: 'boulder', model: 'boulder', dynamic: true, radius: 0.6, x: 15.55, y: 3.5, z: 0 });
  return tower;
}

export function dynamicTowerAssets(assets) {
  const tower = dynamicTowerFixture(assets.level('tower'));
  const fixture = Object.create(assets);
  fixture.level = key => key === 'tower' ? tower : assets.level(key);
  return fixture;
}
