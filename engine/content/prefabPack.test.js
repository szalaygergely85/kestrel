// engine/content/prefabPack.test.js - PREFAB-SEAM (docs/architecture.md 38.11): kind 'prefab' through loadContentPack + canonical writer.
//   node engine/content/prefabPack.test.js
import { loadContentPack } from './loadPack.js';
import { stringifyContent } from './stringify.js';
import { LATEST_SCHEMA, ID_COLLECTIONS, KEY_ORDER } from './schema.js';
import { makeOk } from '../test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

const prefab = (id = 'crate_corner') => ({ kind: 'prefab', schema: 1, id, nextId: 3, title: 'crate corner', items: [
  { id: 'p1', type: 'prop', model: 'crate', x: 0.4, y: -0.2, z: 0, facing: 90 },
  { id: 'p2', type: 'light', preset: 'lantern', x: 0, y: 0, z: 1.3 },
] });
const manifest = (files) => ({ kind: 'manifest', schema: 1, id: 'p', contentVersion: 1, files });
const fetchOf = (files) => async (u) => {
  const key = new URL(u).pathname.split('/').pop();
  if (!(key in files)) throw new Error(`404 ${key}`);
  return JSON.stringify(files[key]);
};
const load = (files, names) => loadContentPack('http://x/manifest.json', { fetchText: fetchOf({ 'manifest.json': manifest(names), ...files }) }).catch((e) => e);
const msgs = (e) => (e.errors || [e]).map((x) => `${x.field}: ${x.message}`).join('|');

ok('schema tables know the prefab kind', LATEST_SCHEMA.prefab === 1 && ID_COLLECTIONS.prefab.join() === 'items' && KEY_ORDER.prefab.join() === 'kind,schema,id,nextId,title,items');

{
  const b = await load({ 'crate_corner.prefab.json': prefab() }, ['crate_corner.prefab.json']);
  ok('loader: bundle.prefabs.crate_corner = {title, items}', !(b instanceof Error) && b.prefabs.crate_corner && b.prefabs.crate_corner.items.length === 2 && b.prefabs.crate_corner.title === 'crate corner', String(b));
  ok('loader: meta.prefab has url/schema/nextId', b.meta.prefab.crate_corner.schema === 1 && b.meta.prefab.crate_corner.nextId === 3 && /crate_corner\.prefab\.json$/.test(b.meta.prefab.crate_corner.url));
  ok('loader: prefab not mixed into other maps', Object.keys(b.levels).length === 0 && Object.keys(b.worlds).length === 0);
  const text = stringifyContent(prefab());
  ok('canonical writer: key order and idempotent', JSON.stringify([...text.matchAll(/^ {2}"(\w+)":/gm)].map((m) => m[1])) === '["kind","schema","id","nextId","title","items"]' && stringifyContent(JSON.parse(text)) === text);
}
{
  const none = await load({}, []);
  ok('a pack without prefabs: empty prefabs map, no error', !(none instanceof Error) && Object.keys(none.prefabs).length === 0 && Object.keys(none.meta.prefab).length === 0);
}
{
  const bad = prefab(); bad.items[1].x = 'a';
  const e = await load({ 'crate_corner.prefab.json': bad }, ['crate_corner.prefab.json']);
  ok('loader: bad item -> ContentError naming items[1].x', e instanceof Error && /items\[1\]\.x/.test(msgs(e)), msgs(e));
}
{
  const e = await load({ 'a.prefab.json': prefab(), 'b.prefab.json': prefab() }, ['a.prefab.json', 'b.prefab.json']);
  ok('loader: duplicate prefab id refused', e instanceof Error && /duplicate prefab id "crate_corner"/.test(msgs(e)), msgs(e));
}
{
  const e = await load({ 'c.prefab.json': prefab('crateCorner') }, ['c.prefab.json']);
  ok('loader: camelCase prefab id refused (lowercase_underscore)', e instanceof Error && /bad or missing id/.test(msgs(e)), msgs(e));
  const dup = prefab(); dup.items[1].id = 'p1';
  const e2 = await load({ 'd.prefab.json': dup }, ['d.prefab.json']);
  ok('loader: duplicate items[].id refused', e2 instanceof Error && /duplicate id "p1"/.test(msgs(e2)), msgs(e2));
  const low = prefab(); low.nextId = 1; low.items[0].id = 'p_2';
  const e3 = await load({ 'e.prefab.json': low }, ['e.prefab.json']);
  ok('loader: nextId must exceed minted ids', e3 instanceof Error && /nextId/.test(msgs(e3)), msgs(e3));
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
