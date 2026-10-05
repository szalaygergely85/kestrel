// ME-19b: frozen pre-deletion CPU oracle samples. ARCH OK is required to
// replace a fixture; there is deliberately no regeneration path here.
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

export function loadGolden(name) {
  const fixture = JSON.parse(readFileSync(new URL(`../../engine/mesh/fixtures/${name}.golden.json`, import.meta.url), 'utf8'));
  if (fixture.format !== 1) throw new Error(`Unknown oracle fixture format: ${name}`);
  return JSON.parse(inflateSync(Buffer.from(fixture.payload, 'base64')).toString('utf8'));
}

function array(record) {
  const bytes = Uint8Array.from(Buffer.from(record.bytes, 'base64'));
  const Type = { Uint8Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array }[record.type];
  if (!Type) throw new Error(`Unknown oracle array type: ${record.type}`);
  return new Type(bytes.buffer);
}

export function goldenFrame(record) {
  const gbuf = { cam: record.gbuf.cam };
  for (const [name, values] of Object.entries(record.gbuf)) {
    if (name !== 'cam') gbuf[name] = array(values);
  }
  return { gbuf, depth: array(record.depth) };
}

export function goldenRelief(record) {
  const r = record.relief;
  return { w: r.w, h: r.h, floorRise: array(r.floorRise), ceilDrop: array(r.ceilDrop) };
}
