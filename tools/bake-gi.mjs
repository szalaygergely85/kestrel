#!/usr/bin/env node
// GI-PROBE-02b (arch 38.72 D-090 stage 2): offline GI probe bake. node tools/bake-gi.mjs [--zone g4_7] [--check] [--out dir]
// Bakes every PINNED terrainGrid zone of world_m1 (the BandCache authored set) to content/gi/<zone>.gi.bin, prints s/zone + MB.
// Deterministic (no RNG). Stale detection: the header carries the sha256 of the inputs (world, structures, terrain edits, masks,
// recipe, bake sources); `--check` / validate-content warn on missing or stale files. Owner decision GI-Q1 (commit the .bin?) pending.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { GIBake, encodeGIBake as encodeRaw, writeGIFile, isGIFileFresh, makeGrid, zoneAt, zoneId, BAND_CHUNK as CHUNK } from '../engine/index.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const GI_DIR = 'content/gi', WORLD_FILE = 'worlds/world_m1.world.json', CELL_M = 8;
const sha = (b) => createHash('sha256').update(b).digest('hex');
const SOURCES = ['engine/world/giBake.js', 'engine/render/giProbe.js', 'engine/world/giFile.js'];

/** Pinned zones of the world def: [{id, x0, y0, w, h}] (w/h in 8 m probe columns). */
export function zonesOf(def, cellM = CELL_M) {
  const g = makeGrid(def.terrainGrid), out = [];
  for (const [i, j] of g.pin) {
    const z = zoneAt(g, i, j, {});
    out.push({ id: zoneId(i, j), x0: z.cx0 * CHUNK, y0: z.cy0 * CHUNK, w: z.cw * CHUNK / cellM, h: z.ch * CHUNK / cellM });
  }
  return out;
}

/** sha256 over every input file (EOL-normalised text, raw bytes for binaries) + the zone list. Hex. */
export function inputHash(root = ROOT) {
  const h = createHash('sha256'), manifest = JSON.parse(fs.readFileSync(path.join(root, 'content/manifest.json'), 'utf8'));
  const def = JSON.parse(fs.readFileSync(path.join(root, 'content', WORLD_FILE), 'utf8'));
  const files = new Set([`content/${WORLD_FILE}`, `design/levels/${def.terrain}.js`, ...SOURCES]);
  for (const s of def.structures) {
    const list = s.mesh ? [`meshes/${s.mesh}.mesh.json`, `meshes/${s.mesh}.mesh.bin`] : [`levels/${s.level}.level.json`];
    for (const f of list) if (fs.existsSync(path.join(root, 'content', f))) files.add('content/' + f);
  }
  for (const f of manifest.files) if ((f.startsWith('terrain/') && f.endsWith('.edits.json')) || f.startsWith('masks/')) files.add('content/' + f);
  for (const f of [...files].sort()) {
    const b = fs.readFileSync(path.join(root, f));
    h.update(f + ':' + (/\.(js|json)$/.test(f) ? sha(b.toString('utf8').replaceAll('\r\n', '\n')) : sha(b)) + '\n');
  }
  h.update(JSON.stringify(zonesOf(def)));
  return h.digest('hex');
}

/** Bake one zone of `world` (needs groundAt + raySegmentRay) -> .gi.bin bytes. */
export function bakeZoneBytes(world, zone, hash, worldId = 'world_m1', cfg = {}) {
  const b = new GIBake(world, { x0: zone.x0, y0: zone.y0, w: zone.w, h: zone.h, ...cfg });
  while (!b.step(1000));
  return writeGIFile(encodeRaw(b.raw()), { hash, zone: zone.id, world: worldId });
}

/** Missing / stale report for `zones` in `dir`: [{id, status: 'ok' | 'missing' | 'stale'}]. */
export function checkGIDir(dir, zones, hash) {
  return zones.map((z) => {
    const f = path.join(dir, z.id + '.gi.bin');
    if (!fs.existsSync(f)) return { id: z.id, status: 'missing' };
    return { id: z.id, status: isGIFileFresh(new Uint8Array(fs.readFileSync(f)), hash) ? 'ok' : 'stale' };
  });
}

/** Load world_m1 headlessly (same recipe as bake-chart: structures + terrain, no props/behaviours). */
export async function loadWorld(root) {
  const { World, AssetRegistry, loadContentPack } = await import('../engine/index.js');
  const rd = (f) => fs.readFileSync(path.join(root, f), 'utf8'), rb = (f) => fs.readFileSync(path.join(root, f));
  const manifest = JSON.parse(rd('content/manifest.json')), def = JSON.parse(rd('content/' + WORLD_FILE));
  const required = new Set([WORLD_FILE, ...def.structures.map((s) => s.mesh ? `meshes/${s.mesh}.mesh.json` : `levels/${s.level}.level.json`)]);
  for (const f of manifest.files) if ((f.startsWith('terrain/') && f.endsWith('.edits.json')) || f.startsWith('masks/')) required.add(f);
  const url = pathToFileURL(path.join(root, 'content/manifest.json')).href;
  const rel = (u) => path.relative(root, fileURLToPath(u)).replaceAll('\\', '/');
  const bundle = await loadContentPack(url, {
    fetchText: async (u) => u === url ? JSON.stringify({ ...manifest, files: manifest.files.filter((f) => required.has(f)) }) : rd('content/' + rel(u).replace(/^content\//, '')),
    fetchBytes: async (u) => rb(rel(u)),
  });
  const ctx = { window: { ASSETS: {} }, Math };
  vm.runInNewContext(rd(`design/levels/${def.terrain}.js`), ctx, { filename: def.terrain, timeout: 5000 });
  const levels = Object.fromEntries(Object.entries(bundle.levels).map(([k, l]) => [k, { ...l, props: [], entities: [], interactables: [], triggers: [] }]));
  const assets = new AssetRegistry({ palette: {}, levels, meshes: bundle.meshes, terrain: { [def.terrain]: ctx.window.ASSETS.levels[def.terrain] }, terrainEdits: bundle.terrainEdits });
  const world = World.load({ ...def, entities: [], props: [], horizon: [], triggers: [], interactables: [], nav: null }, assets);
  return { def, heightAt: (x, y) => world.heightAt(x, y) };
}

/**
 * Terrain-only bake world over a cached height grid (res m). World.raySegmentRay re-evaluates the procedural terrain per sample
 * (~0.6 ms/ray, ~30 min/zone), so the tool samples heightAt once per grid node and marches that. Structures/props are NOT in the
 * tool bake yet (needs a collider-only ray API on World; see lane note).
 */
export function heightfieldWorld(heightAt, x0, y0, x1, y1, res = 2) {
  const nx = Math.ceil((x1 - x0) / res) + 2, ny = Math.ceil((y1 - y0) / res) + 2, g = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) g[j * nx + i] = heightAt(x0 + i * res, y0 + j * res);
  const groundAt = (x, y) => {
    let u = (x - x0) / res, v = (y - y0) / res;
    u = u < 0 ? 0 : u > nx - 1.001 ? nx - 1.001 : u; v = v < 0 ? 0 : v > ny - 1.001 ? ny - 1.001 : v;
    const i = u | 0, j = v | 0, fu = u - i, fv = v - j, k = j * nx + i;
    return (g[k] * (1 - fu) + g[k + 1] * fu) * (1 - fv) + (g[k + nx] * (1 - fu) + g[k + nx + 1] * fu) * fv;
  };
  const STEP = 1;
  return {
    groundAt,
    raySegmentRay(s, o) {
      const dx = s[3] - s[0], dy = s[4] - s[1], dz = s[5] - s[2], len = Math.hypot(dx, dy, dz), n = Math.max(1, Math.ceil(len / STEP));
      let prev = 0;
      for (let q = 1; q <= n; q++) {
        const t = q / n;
        if (s[2] + dz * t < groundAt(s[0] + dx * t, s[1] + dy * t)) {
          let lo = prev, hi = t;
          for (let b = 0; b < 5; b++) { const m = (lo + hi) / 2; if (s[2] + dz * m < groundAt(s[0] + dx * m, s[1] + dy * m)) hi = m; else lo = m; }
          o.t = hi; o.x = s[0] + dx * hi; o.y = s[1] + dy * hi; o.z = s[2] + dz * hi;
          return true;
        }
        prev = t;
      }
      return false;
    },
  };
}

async function main() {
  const args = process.argv.slice(2), arg = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const out = path.resolve(ROOT, arg('--out') || GI_DIR), hash = inputHash(ROOT);
  const def = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', WORLD_FILE), 'utf8'));
  const zones = zonesOf(def).filter((z) => !arg('--zone') || z.id === arg('--zone'));
  if (args.includes('--check')) {
    const r = checkGIDir(out, zones, hash);
    for (const x of r) console.log(`${x.id}: ${x.status}`);
    process.exitCode = r.every((x) => x.status === 'ok') ? 0 : 1;
    return;
  }
  const { heightAt } = await loadWorld(ROOT), RAY = 48;
  fs.mkdirSync(out, { recursive: true });
  console.log('zone      s/zone    MB');
  let tot = 0, totS = 0;
  for (const z of zones) {
    const t = performance.now(), world = heightfieldWorld(heightAt, z.x0 - RAY, z.y0 - RAY, z.x0 + z.w * CELL_M + RAY, z.y0 + z.h * CELL_M + RAY), bytes = bakeZoneBytes(world, z, hash), s = (performance.now() - t) / 1000;
    fs.writeFileSync(path.join(out, z.id + '.gi.bin'), bytes);
    tot += bytes.length; totS += s;
    console.log(`${z.id.padEnd(8)} ${s.toFixed(1).padStart(7)} ${(bytes.length / 1048576).toFixed(2).padStart(6)}`);
  }
  console.log(`total    ${totS.toFixed(1).padStart(7)} ${(tot / 1048576).toFixed(2).padStart(6)}  (hash ${hash.slice(0, 12)})`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e); process.exitCode = 1; });
