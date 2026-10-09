// KPKG-04 (docs/architecture.md 38.30 item 4): `?pack=a.kestrel,b.kestrel` boots from packages instead of loose content/.
// Paths are relative to the page (e.g. ?pack=../dist/kestrel.base-1.0.0.kestrel). No `pack` param = null = loose boot.
import { openPackage, mountPackages, loadContentPack } from '../../engine/index.js';

/**
 * @param {URLSearchParams} params
 * @param {{lazyMeshes?: boolean}} opts
 * @param {(msg:string)=>void} [log]
 * @returns {Promise<any|null>} the content bundle (same shape as loadContentPack) or null when `?pack=` is absent
 */
export async function loadBundleFromPackages(params, opts = {}, log = () => {}) {
  const list = (params.get('pack') || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!list.length) return null;
  const pkgs = [];
  for (const href of list) {
    const r = await fetch(href);
    if (!r.ok) throw new Error(`?pack=: ${href} -> HTTP ${r.status}`);
    pkgs.push(await openPackage(new Uint8Array(await r.arrayBuffer())));
  }
  const mount = await mountPackages(pkgs);
  const withContent = pkgs.filter((p) => mount.manifestUrl(p.id));
  if (!withContent.length) throw new Error('?pack=: none of the packages carries a content manifest');
  log(`packages mounted: ${pkgs.map((p) => p.id + '@' + p.manifest.version).join(', ')}`);
  return loadContentPack(mount.manifestUrl(withContent[0].id), { ...opts, fetchText: mount.fetchText, fetchBytes: mount.fetchBytes });
}
