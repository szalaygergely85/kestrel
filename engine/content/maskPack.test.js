// engine/content/maskPack.test.js - ALPHA-01a (docs/architecture.md 37.17): manifest `masks`, kind 'mask' files, masked mesh ranges.
//   node engine/content/maskPack.test.js
import { loadContentPack } from './loadPack.js';
import { maskToJSON, maskFromJSON, downsampleAlpha } from './maskFile.js';
import { stringifyContent } from './stringify.js';
import { StaticMeshBuilder, packFlat1, planePlaneIdBase, meshToJSON, AO_NONE } from '../mesh/MeshData.js';
import { makeOk } from '../test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

function maskedMeshJSON(tex) {
  const b = new StaticMeshBuilder('t/leafy');
  for (let q = 0; q < 2; q++) b.addQuad([0, q, 0, 1, q, 0, 1, q, 1, 0, q, 1], [0, 0, 1, 0, 1, 1, 0, 1], 0, 1, 0, planePlaneIdBase(4, q), packFlat1(4, 5, 0), [0, AO_NONE, 0, 0, 0, 0, 0, 0]);
  const m = b.build();
  m.matKeys = ['leaf'];
  m.uvMask = new Float32Array(m.pos.length / 3 * 2).fill(0.25);
  m.ranges = [{ start: 0, count: 2, part: 'bark' }, { start: 2, count: 2, part: 'leaf', mask: { tex, cutoff: 0.2 } }];
  return { kind: 'mesh', schema: 1, id: 't/leafy', nextId: 1, ...meshToJSON(m) };
}

function packFetch(files) {
  return async (u) => {
    const key = new URL(u).pathname.split('/').pop();
    if (!(key in files)) throw new Error(`404 ${key}`);
    return JSON.stringify(files[key]);
  };
}
const manifest = (masks) => ({ kind: 'manifest', schema: 1, id: 'p', contentVersion: 1, files: ['leafy.mesh.json'], masks });
const alpha = Uint8Array.from({ length: 16 }, (_, i) => (i % 3 ? 255 : 0));
const maskFile = maskToJSON('t/Leaf', 4, 4, 0.2, alpha);

// --- file format ---------------------------------------------------------------------------------------------------------------
{
  const back = maskFromJSON(JSON.parse(JSON.stringify(maskFile)));
  ok('maskFile: round trip bytes + dims', back.w === 4 && back.h === 4 && back.cutoffDefault === 0.2 && back.data.every((v, i) => v === alpha[i]));
  const text = stringifyContent(maskFile);
  ok('maskFile: canonical key order kind,schema,id,w,h,cutoffDefault,data', JSON.stringify([...text.matchAll(/^ {2}"(\w+)":/gm)].map((m) => m[1])) === '["kind","schema","id","w","h","cutoffDefault","data"]');
  ok('maskFile: canonical writer is deterministic and idempotent', stringifyContent(JSON.parse(text)) === text);
  const big = new Uint8Array(256 * 256).map((_, i) => (i * 7) & 255);
  ok('maskFile: 256x256 round trips (chunked base64)', maskFromJSON(JSON.parse(JSON.stringify(maskToJSON('t/Big', 256, 256, 0.5, big)))).data.every((v, i) => v === big[i]));
  const bad = (f) => { try { maskFromJSON(f({ ...maskFile })); return ''; } catch (e) { return e.message; } };
  ok('maskFile: data length mismatch throws', /expected w\*h/.test(bad((o) => ({ ...o, w: 8 }))));
  ok('maskFile: non power-of-two throws', /power of two/.test(bad((o) => ({ ...o, w: 3 }))));
  ok('maskFile: cutoffDefault 1 throws', /cutoffDefault/.test(bad((o) => ({ ...o, cutoffDefault: 1 }))));
  ok('maskFile: 2048 throws (> 1024)', /power of two/.test(bad((o) => ({ ...o, w: 2048 }))));
  ok('downsampleAlpha: 4x4 -> 2x2 box average', downsampleAlpha(Uint8Array.from([0, 0, 255, 255, 0, 0, 255, 255, 10, 10, 20, 20, 10, 10, 20, 20]), 4, 4, 2, 2).join() === '0,255,10,20');
}

// --- loader ---------------------------------------------------------------------------------------------------------------------
{
  const b = await loadContentPack('http://x/manifest.json', { fetchText: packFetch({ 'manifest.json': manifest(['Leaf.mask.json']), 'leafy.mesh.json': maskedMeshJSON('t/Leaf'), 'Leaf.mask.json': maskFile }) });
  ok('loader: bundle.masks[id] = {w,h,data:Uint8Array}', b.masks['t/Leaf'] && b.masks['t/Leaf'].data instanceof Uint8Array && b.masks['t/Leaf'].w === 4);
  ok('loader: masked mesh keeps uvMask + range.mask', b.meshes['t/leafy'].uvMask.length === 24 && b.meshes['t/leafy'].ranges[1].mask.tex === 't/Leaf');
  const none = await loadContentPack('http://x/manifest.json', { fetchText: packFetch({ 'manifest.json': { ...manifest(undefined), masks: undefined }, 'leafy.mesh.json': { ...maskedMeshJSON('t/Leaf') } }) }).catch((e) => e);
  ok('loader: a mesh whose mask is not in the manifest fails naming it', none instanceof Error && /mask "t\/Leaf" is not in the manifest masks/.test((none.errors || [none]).map((e) => e.message).join('|')));
  const badMask = await loadContentPack('http://x/manifest.json', { fetchText: packFetch({ 'manifest.json': manifest(['Leaf.mask.json']), 'leafy.mesh.json': maskedMeshJSON('t/Leaf'), 'Leaf.mask.json': { ...maskFile, w: 8 } }) }).catch((e) => e);
  ok('loader: a corrupt mask file fails the pack', badMask instanceof Error && /expected w\*h/.test((badMask.errors || [badMask]).map((e) => e.message).join('|')));
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
