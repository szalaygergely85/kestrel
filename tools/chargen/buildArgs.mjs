// Arg parsing for build-villager.mjs (kept separate so it can be tested without building).
//   seed mode (default): [--seed N]
//   recipe mode: --recipe <path> --id <pkgId> --name <displayName> [--out <file.kestrel>]
export function parseBuildArgs(argv) {
  const get = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const recipe = get('--recipe');
  if (recipe === undefined) return { mode: 'seed', seed: Number(get('--seed')) || 7 };
  const id = get('--id'), name = get('--name');
  if (!id || !name) throw new Error('recipe mode needs --id <pkgId> and --name <displayName>');
  if (!/^[a-z][a-z0-9_.]*$/.test(id)) throw new Error('bad --id ' + id);
  const short = id.split('.').pop();
  return { mode: 'recipe', recipe, id, name, assetId: short, out: get('--out') || `content/packages/${id}-1.0.0.kestrel` };
}
