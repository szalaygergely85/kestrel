// TOWER-LEVER-01: explicit test-only fixture for generic dynamic-sector tests.
// Shipping tower data remains open; animation/packing/refit coverage stays live.
export function dynamicTowerFixture(def) {
  const tower = structuredClone(def);
  tower.legend.G = { floorH: 3, ceilH: 3, ceilMat: 'iron', floorMat: 'floor',
    wallMat: 'stone', solid: false, tag: 'grate', topH: 6.6, upperMat: 'grate', zone: 'upper',
    dynamic: { ceilOpen: 5.4, ease: 'inOut', openTime: 1.5 } };
  tower.props.push({ id: 'lever', model: 'lever', variant: 'idle', facing: 90, x: 19.25, y: 9.3, z: 3 });
  return tower;
}

export function dynamicTowerAssets(assets) {
  const tower = dynamicTowerFixture(assets.level('tower'));
  const fixture = Object.create(assets);
  fixture.level = key => key === 'tower' ? tower : assets.level(key);
  return fixture;
}
