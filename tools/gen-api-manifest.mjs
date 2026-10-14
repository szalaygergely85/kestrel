// ENG-API-01a (architecture.md 38.74): engine/api-1.0.json manifest tooling.
// Names come from `import * as E` + Object.keys (robust: follows `export *`, `as` renames,
// no regex on names). Area comes from a static scan of engine/index.js (nearest `// ----`
// group comment, or the module path). Tier of a NEW name is "experimental"; existing tiers
// (edited by hand) are preserved. `node tools/gen-api-manifest.mjs --write` is idempotent.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const INDEX = path.join(root, 'engine/index.js');
export const MANIFEST = path.join(root, 'engine/api-1.0.json');
export const AREAS = ['core', 'content', 'world', 'render', 'physics', 'nav', 'anim', 'ui', 'sim', 'fx', 'editor'];
export const TIERS = ['stable', 'experimental', 'deprecated'];

// group-comment keyword -> area (first match wins)
const GROUPS = [
  [/bootstrap|CO-1|behaviours|interaction|triggers/, 'core'],
  [/content|US-027a/, 'content'],
  [/world compositor|ART-01a|water|^world/, 'world'],
  [/voxel models|entities|fauna/, 'anim'],
  [/physics/, 'physics'],
  [/^ui|US-015|OWN-REQ-003/, 'ui'],
  [/pathfinding|flow-field|fog-of-war/, 'nav'],
  [/deterministic sim/, 'sim'],
  [/fire spread|particle|ripples/, 'fx'],
  [/render passes|US-030c|US-028|lighting|US-029|pitched|picking|minimap|RTS camera|selection/, 'render'],
];
// module-path overrides (win over the group comment)
const PATHS = [[/^\.\/ui\//, 'ui'], [/^\.\/mesh\//, 'render'], [/^\.\/fauna\//, 'anim'], [/^\.\/chargen\//, 'anim'],
  [/^\.\/entities\/(animBlend|lookAt)/, 'anim'], [/^\.\/render\/underwater/, 'render']];

function areaOf(group, from) {
  for (const [re, a] of PATHS) if (re.test(from)) return a;
  for (const [re, a] of GROUPS) if (re.test(group)) return a;
  throw new Error(`no area for group "${group}" (module ${from}); extend GROUPS in tools/gen-api-manifest.mjs`);
}

/** Static scan: exported name -> area (names behind `export *` are absent; caller falls back). */
export function scanAreas(src) {
  const areas = new Map(); const stars = [];
  let group = ''; let m;
  const re = /^\/\/ -{3,} ?(.*)$|^export\s*\{([^}]*)\}\s*from\s*'([^']+)'|^export\s*\*\s*from\s*'([^']+)'/gm;
  while ((m = re.exec(src))) {
    if (m[1] !== undefined) group = m[1];
    else if (m[2] !== undefined) {
      for (const part of m[2].replace(/\/\/[^\n]*/g, '').split(',')) {
        const p = part.trim(); if (!p) continue;
        areas.set(p.split(/\s+as\s+/).pop().trim(), areaOf(group, m[3]));
      }
    } else stars.push(areaOf(group, m[4]));
  }
  return { areas, stars };
}

/** Current state: sorted [{name, area}] from the live module + the static scan. */
export async function currentExports() {
  const E = await import(pathToFileURL(INDEX).href);
  const { areas, stars } = scanAreas(fs.readFileSync(INDEX, 'utf8'));
  return Object.keys(E).filter((n) => n !== 'default').sort().map((name) => {
    const area = areas.get(name) || (stars.length === 1 ? stars[0] : null);
    if (!area) throw new Error(`cannot place export "${name}" in an area`);
    return { name, area };
  });
}

export function readManifest() { return JSON.parse(fs.readFileSync(MANIFEST, 'utf8')); }

/** Canonical JSON: sorted by name, one entry per line, trailing newline. */
export function canonical(names) {
  const rows = names.map((n) => '    ' + JSON.stringify(n.replacedBy ? { name: n.name, area: n.area, tier: n.tier, replacedBy: n.replacedBy } : { name: n.name, area: n.area, tier: n.tier }));
  return '{\n  "version": "1.0",\n  "names": [\n' + rows.join(',\n') + '\n  ]\n}\n';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv.includes('--write')) { console.log('usage: node tools/gen-api-manifest.mjs --write'); process.exit(0); }
  const old = new Map(); try { for (const n of readManifest().names) old.set(n.name, n); } catch { /* first run */ }
  const names = (await currentExports()).map(({ name, area }) => ({ name, area, tier: old.get(name)?.tier || 'experimental', replacedBy: old.get(name)?.replacedBy }));
  fs.writeFileSync(MANIFEST, canonical(names));
  console.log(`engine/api-1.0.json: ${names.length} names`);
}
