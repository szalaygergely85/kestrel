// Pure helper for pack.mjs: which repo files (posix paths relative to the repo root) ship in the player zip.
// Licence rule: nothing local-only or third-party source packs (design/vox*, design/meshes, content/local, design/local).
const ROOTS = ['game/', 'engine/', 'design/', 'content/'];
const EXTRA_FILES = new Set(['docs/licence-inventory.json', 'THIRD_PARTY_NOTICES.md']); // credits screen + notices
const EXCLUDED_DIRS = [
  'content/local/', 'design/local/', 'design/vox/', 'design/vox-cc0/', 'design/vox-sb/',
  'design/meshes/', 'design/preview/', 'design/reference/',
];

export function shouldShip(rel) {
  const p = rel.replaceAll('\\', '/').replace(/^\.\//, '');
  if (EXTRA_FILES.has(p)) return true;
  if (!ROOTS.some(r => p.startsWith(r))) return false;
  if (EXCLUDED_DIRS.some(d => p.startsWith(d))) return false;
  if (/(^|\/)(__pycache__|node_modules)\//.test(p)) return false;
  if (/\.test\.(m?js|cjs)$/.test(p)) return false;
  if (/\.(md|log)$/i.test(p) || /(^|\/)desktop\.ini$/i.test(p)) return false;
  return true;
}
