// engine/world/giLoader.js - GI-PROBE-03 (arch 38.72 section 4): quiet per-zone loader for baked `.gi.bin` probe fields.
// Never bakes. A missing file is the NORMAL case (files are not committed yet): fetch once per zone, remember the miss
// (no retry, no console output). A file of another format version, or baked from other inputs (hash), is "stale" -> null
// (one warning per zone via `warn`). Pure apart from the injected `fetchBytes`.
import { readGIFile, readGIHeader, GI_FILE_VERSION } from './giFile.js';

/** Default fetch: Uint8Array or null (404, network error). The browser logs a failed fetch itself, once per zone. */
async function defaultFetch(url) {
  try { const r = await fetch(url); return r.ok ? new Uint8Array(await r.arrayBuffer()) : null; } catch { return null; }
}

const PENDING = 0, OK = 1, MISSING = 2, STALE = 3;

export class GILoader {
  /**
   * @param {{fetchBytes?:(url:string)=>Promise<Uint8Array|null>, baseUrl?:string, expectHash?:string|((id:string)=>string)|null,
   *   onLoad?:(id:string, field:object)=>void, warn?:(msg:string)=>void}} [o]
   * expectHash: hex sha256 of the bake inputs (a stale file is ignored); null = only the format version is checked.
   */
  constructor(o = {}) {
    this.fetchBytes = o.fetchBytes || defaultFetch; this.baseUrl = o.baseUrl || 'content/gi/'; this.expectHash = o.expectHash || null;
    this.onLoad = o.onLoad || null; this.warn = o.warn || (typeof console !== 'undefined' ? (m) => console.warn(m) : () => {});
    this.state = new Map(); this.fields = new Map();
    this.requests = 0; this.loaded = 0; this.missing = 0; this.stale = 0;
  }
  urlOf(id) { return this.baseUrl + id + '.gi.bin'; }
  /** Field of a loaded zone or null (missing / stale / pending). No allocation. */
  get(id) { const f = this.fields.get(id); return f === undefined ? null : f; }
  /** True once a zone was requested (any outcome): the miss is remembered, it is never fetched again. */
  seen(id) { return this.state.has(id); }
  /** Fetches one zone once. Resolves to the field or null. */
  async load(id) {
    if (this.state.has(id)) return this.get(id);
    this.state.set(id, PENDING); this.requests++;
    let bytes = null;
    try { bytes = await this.fetchBytes(this.urlOf(id)); } catch { bytes = null; }
    if (!bytes || !bytes.length) { this.state.set(id, MISSING); this.missing++; return null; }
    const h = readGIHeader(bytes), want = typeof this.expectHash === 'function' ? this.expectHash(id) : this.expectHash;
    if (!h.ok) { this.state.set(id, MISSING); this.missing++; return null; } // not a gi file (e.g. an HTML 404 page served with 200)
    if (h.version !== GI_FILE_VERSION || (want && h.hash16 !== want.slice(0, 32))) return this._stale(id, h.version !== GI_FILE_VERSION ? 'format version ' + h.version : 'input hash changed');
    let r; try { r = readGIFile(bytes); } catch (e) { return this._stale(id, e.message); }
    this.state.set(id, OK); this.fields.set(id, r.field); this.loaded++;
    if (this.onLoad) this.onLoad(id, r.field);
    return r.field;
  }
  /** Fetches many zones (each once). */
  loadAll(ids) { return Promise.all(ids.map((id) => this.load(id))); }
  _stale(id, why) { this.state.set(id, STALE); this.stale++; this.warn('[gi] ' + id + ': stale GI file ignored (' + why + ')'); return null; }
  stats() { return { requests: this.requests, loaded: this.loaded, missing: this.missing, stale: this.stale }; }
}
