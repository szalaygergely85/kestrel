// Boot bundle (docs/architecture.md 38.30 + 38.33). Content = first `?pack=` package with a content manifest, else the loose
// base manifest. Models = every `?pack=` package + every add-on listed in content/packages/index.json (models only, CHARGEN-15).
import { openPackage, mountPackages, loadContentPack as engineLoadContentPack } from '../../engine/index.js';

const BAD_REL = /(^|[\/])\.\.([\/]|$)|^[\/]|\|:/;

/**
 * @param {URLSearchParams} params
 * @param {{lazyMeshes?:boolean, baseManifest?:string, addonIndex?:string, fetch?:Function, loadContentPack?:Function}} opts
 * @param {(msg:string)=>void} [log]
 * @returns {Promise<any>} content bundle (loadContentPack shape + `models`); never null
 */
export async function loadBootBundle(params, opts = {}, log = () => {}) {
  const doFetch = opts.fetch || ((u) => fetch(u));
  const loadContent = opts.loadContentPack || engineLoadContentPack;
  const baseManifest = opts.baseManifest || '../content/manifest.json';
  const indexUrl = opts.addonIndex || '../content/packages/index.json';
  const open = async (url, what) => {
    const r = await doFetch(url);
    if (!r.ok) throw new Error(`${what}: ${url} -> HTTP ${r.status}`);
    return openPackage(new Uint8Array(await r.arrayBuffer()));
  };

  const pkgs = []; const source = new Map(); // package -> where it came from
  for (const href of (params.get('pack') || '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const p = await open(href, '?pack=');
    pkgs.push(p); source.set(p, `?pack=${href}`);
  }
  const nPack = pkgs.length;

  if (params.get('addons') !== '0') {
    const r = await doFetch(indexUrl);
    if (r.status === 404) log(`no add-on index (${indexUrl}), loose boot`);
    else {
      if (!r.ok) throw new Error(`add-on index ${indexUrl} -> HTTP ${r.status}`);
      let idx;
      try { idx = JSON.parse(await r.text()); } catch (e) { throw new Error(`add-on index ${indexUrl}: invalid JSON (${e.message})`); }
      if (!idx || idx.format !== 'kestrel-addons' || idx.formatVersion !== 1 || !Array.isArray(idx.packages)) throw new Error(`add-on index ${indexUrl}: expected {format:"kestrel-addons",formatVersion:1,packages:[...]}`);
      for (const rel of idx.packages) {
        if (typeof rel !== 'string' || !rel || BAD_REL.test(rel)) throw new Error(`add-on index ${indexUrl}: bad package path ${JSON.stringify(rel)}`);
        const p = await open(indexUrl.replace(/[^/]*$/, '') + rel, 'add-on');
        if (p.manifest.content) throw new Error(`add-on ${rel}: add-on content is not supported in v1, use ?pack=`);
        pkgs.push(p); source.set(p, `add-on ${rel}`);
      }
    }
  }

  const seen = new Map();
  for (const p of pkgs) {
    if (seen.has(p.id)) throw new Error(`package id "${p.id}" is in both ${seen.get(p.id)} and ${source.get(p)}`);
    seen.set(p.id, source.get(p));
  }
  if (!pkgs.length) return loadContent(baseManifest, { lazyMeshes: opts.lazyMeshes });

  const all = [...pkgs];
  if (pkgs.some((p) => (p.manifest.dependencies || []).some((d) => d.id === 'kestrel.base')) && !seen.has('kestrel.base')) {
    let version = '1.0.0';
    try { const r = await doFetch(baseManifest.replace(/[^/]*$/, '') + 'packages/kestrel.base.pkg.json'); if (r.ok) version = JSON.parse(await r.text()).version || version; } catch { /* default */ }
    all.push({ id: 'kestrel.base', manifest: { version }, has: () => false });
  }
  const mount = await mountPackages(all, {});
  const withContent = pkgs.slice(0, nPack).find((p) => mount.manifestUrl(p.id));
  log(`packages mounted: ${pkgs.map((p) => p.id + '@' + p.manifest.version).join(', ')}`);
  const bundle = withContent
    ? await loadContent(mount.manifestUrl(withContent.id), { lazyMeshes: opts.lazyMeshes, fetchText: mount.fetchText, fetchBytes: mount.fetchBytes })
    : await loadContent(baseManifest, { lazyMeshes: opts.lazyMeshes });
  const models = await mount.loadModels(); // RIG-03w: model.rigged / model.static assets -> registerRiggedChars
  for (const id of Object.keys(models)) if (bundle.models && bundle.models[id]) throw new Error(`model "${id}" from a package collides with base content`);
  bundle.models = { ...(bundle.models || {}), ...models };
  return bundle;
}
