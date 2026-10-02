// ED-SCALE-1b (architecture.md 34): per-prop uniform scale, data + save.
// Run: node engine/world/scale.test.js
import { World, PROP_SCALE_MIN, PROP_SCALE_MAX } from './World.js';
import { serialize, deserialize, stringifySave } from './serialize.js';
import paletteMod from '../../design/palette.js';
import detailPassMod from '../../design/detail-pass.js';
import lanternMod from '../../design/models/lantern.js';
import leverMod from '../../design/models/lever.js';
import voxelPropsMod from '../../design/models/voxel_props.js';
import boulderMod from '../../design/models/boulder.js';
import rubbleMod from '../../design/models/rubble.js';
import wreckageMod from '../../design/models/wreckage.js';
import relayMod from '../../design/models/relay.js';
import swordMod from '../../design/models/sword.js';
import m3PropsMod from '../../design/models/m3_props.js';
import farTowerMod from '../../design/models/far_tower.js';
import ferrumLightsMod from '../../design/models/ferrum_lights.js';
import terrainDef from '../../design/levels/overworld_far.js';
import { loadTestAssets } from '../../tools/testing/content-node.mjs';
import { makeOk } from '../test/assert.js';

globalThis.window = globalThis.window || globalThis;
paletteMod; detailPassMod; terrainDef; lanternMod; leverMod; boulderMod; rubbleMod; wreckageMod; relayMod; swordMod; voxelPropsMod; farTowerMod; ferrumLightsMod;
const { assets } = await loadTestAssets();

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

const def = assets.world('world_m1');
const origLevel = assets.level;
// Loads world_m1 with `patch(propsById)` applied to the tower level's props.
function loadWith(patch) {
  assets.level = (n) => {
    const d = origLevel.call(assets, n);
    if (n !== 'tower') return d;
    const c = { ...d, props: d.props.map((p) => ({ ...p })) };
    patch((id) => c.props.find((p) => p.id === id));
    return c;
  };
  try { return World.load(def, assets, {}); } finally { assets.level = origLevel; }
}
const threw = (fn) => { try { fn(); return null; } catch (e) { return e.message; } };

ok('constants 0.25 / 4', PROP_SCALE_MIN === 0.25 && PROP_SCALE_MAX === 4);

const base = World.load(def, assets, {});
const lever = base.get('tower.lever');
ok('default: lever is voxel and has no transform.scale', !!lever.getComponent('voxel') && lever.data.transform.scale === undefined);

const w1 = loadWith((P) => { P('lever').scale = 1.5; });
ok('prop scale 1.5 reaches transform.scale', w1.get('tower.lever').data.transform.scale === 1.5);
const w2 = loadWith((P) => { P('lever').scale = 1.234; });
ok('scale rounds to 0.01', w2.get('tower.lever').data.transform.scale === 1.23);
const w3 = loadWith((P) => { P('lever').scale = 1; });
ok('scale 1 stores nothing', w3.get('tower.lever').data.transform.scale === undefined);

for (const bad of [0.2, 5, NaN, '2', null, Infinity]) {
  const m = threw(() => loadWith((P) => { P('lever').scale = bad; }));
  ok(`scale ${String(bad)} throws naming the prop`, !!m && m.includes('tower.lever') && m.includes('scale'));
}

// Sprite/billboard prop: ignored with a warn.
const spriteId = [...base._entities.values()].find((e) => e.type === 'prop' && e.components.sprite && e.id.startsWith('tower.'));
if (spriteId) {
  const id = spriteId.id.slice('tower.'.length);
  const warns = [];
  const ow = console.warn; console.warn = (m) => warns.push(m);
  const w = loadWith((P) => { P(id).scale = 2; });
  console.warn = ow;
  ok('sprite prop ignores scale', w.get(spriteId.id).data.transform.scale === undefined);
  ok('sprite prop warns once', warns.filter((m) => m.includes(spriteId.id)).length === 1);
}

// Rolling prop: radius scales.
const bp = origLevel.call(assets, 'tower').props.find((p) => p.id === 'boulder');
const wb = loadWith((P) => { P('boulder').scale = 2; });
const bb = wb.get('tower.boulder');
if (bb.getComponent('voxel')) {
  ok('dynamic prop body.radius = radius * scale', Math.abs(bb.getComponent('body').radius - bp.radius * 2) < 1e-12);
} else {
  ok('dynamic sprite prop keeps radius', bb.getComponent('body').radius === bp.radius);
}
const wd = loadWith((P) => { const l = P('lever'); l.dynamic = true; l.radius = 0.4; l.scale = 2; });
ok('voxel dynamic prop body.radius = radius * scale', Math.abs(wd.get('tower.lever').getComponent('body').radius - 0.8) < 1e-12);
ok('unscaled boulder radius unchanged', base.get('tower.boulder').getComponent('body').radius === bp.radius);

// Round trip: unscaled world -> no scale keys, byte-identical; scaled -> stable.
const s0 = stringifySave(serialize(base));
ok('unscaled save has no "scale" key', !s0.includes('"scale"'));
const s0b = stringifySave(serialize(deserialize(serialize(base), assets, {})));
ok('unscaled round trip byte-identical', s0 === s0b);
const sc = serialize(w1);
const scs = stringifySave(sc);
ok('scaled save writes scale 1.5 on the lever only', sc.entities.filter((e) => e.transform.scale !== undefined).map((e) => e.id).join() === 'tower.lever' && sc.entities.find((e) => e.id === 'tower.lever').transform.scale === 1.5);
const w1b = deserialize(sc, assets, {});
ok('restored scale 1.5', w1b.get('tower.lever').data.transform.scale === 1.5);
ok('scaled round trip stable', stringifySave(serialize(w1b)) === scs);

// World entity: inline + transform.scale; out of range throws.
const entDef = (e) => ({ ...def, entities: [...(def.entities || []), e] });
const ent = { id: 'sc_ent', type: 'prop', transform: { x: 1490, y: 1020, z: 0, scale: 2 }, components: { voxel: { model: 'lever', anim: 'idle' } } };
const we = World.load(entDef(ent), assets, {});
ok('entity transform.scale kept', we.get('sc_ent').data.transform.scale === 2);
const wi = World.load(entDef({ ...ent, id: 'sc_ent2', transform: undefined, x: 1490, y: 1020, scale: 0.5 }), assets, {});
ok('entity inline scale shorthand', wi.get('sc_ent2').data.transform.scale === 0.5);
ok('entity out of range throws naming the entity', (threw(() => World.load(entDef({ ...ent, id: 'sc_bad', transform: { ...ent.transform, scale: 9 } }), assets, {})) || '').includes('sc_bad'));
const wn = World.load(entDef({ ...ent, id: 'sc_one', transform: { ...ent.transform, scale: 1 } }), assets, {});
ok('entity scale 1 dropped', wn.get('sc_one').data.transform.scale === undefined);

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
