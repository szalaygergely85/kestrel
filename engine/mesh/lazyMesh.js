// @ts-check
// engine/mesh/lazyMesh.js - MESH-LOAD-01 (docs/architecture.md 37.19; docs/mesh-bin.md "Lazy loading").
// Lazy mesh payloads: `loadContentPack(url, { lazyMeshes: true })` fetches every mesh META eagerly (1-3 KB: bbox, ranges, mats,
// flags and the collision proxy as `colliderB64`) but NOT the .mesh.bin. Each such mesh is a SHELL: a normal MeshData object
// (same identity for the whole session, so placements, colliders and scatter groups keep their reference) whose vertex streams
// are empty and which carries `lazy` (the record below). The feeds skip a shell (`mesh.lazy` truthy = draws nothing) and ask the
// store to load it when it is within `loadM` of the eye. Colliders stay eager: a mesh is only made lazy when it needs no render
// triangles for collision (`collide: false`, or a `colliderB64` proxy); anything else is fetched at boot like before.
//
// Cost model: the network fetch is async (no frame cost). The decode of a fetched bin (`meshFromBin`) happens in `pump()`, at
// most MAX_DECODES_PER_FRAME meshes or BUDGET_MS per call, so a frame never pays for more than ~2 decodes. Promise de-dup:
// `request()` returns the same Promise for the same mesh, and a mesh is fetched at most once.
import { meshFromBin, base64ToF32 } from './meshBin.js';

export const MAX_DECODES_PER_FRAME = 2;
export const BUDGET_MS = 4;
export const MAX_INFLIGHT = 4;
/** Extra metres beyond the draw distance (fogFarM) within which a shell is requested, so it is ready before it becomes visible. */
export const LOAD_MARGIN_M = 20;
/** S8-B2-03 LRU: a ready mesh is kept while some placement is within loadM + HOLD_MARGIN_M of the eye (hysteresis band, > 0 so a
 * mesh at the load edge never thrashes) and is released when it was not touched for EVICT_AFTER_MS. */
export const HOLD_MARGIN_M = 60;
export const EVICT_AFTER_MS = 20000;
/** The eviction sweep runs once per this many `pump()` calls (one per camera feed). */
export const SWEEP_EVERY = 30;

/** Bumped whenever ANY shell becomes real (MeshGroupSet rebuilds on a change). */
let lazyVersion = 0;
export function lazyMeshVersion() { return lazyVersion; }

/** Stores with pending work or evictable ready meshes (pumped by `pumpLazyMeshes`). */
const activeStores = new Set();
/** Eye + load radius of the last camera feed (set by addMeshStructures); scatter groups use it for their distance test. */
const view = { x: 0, y: 0, loadM: Infinity, known: false };
export function setLazyView(x, y, fogFarM) { view.x = x; view.y = y; view.loadM = fogFarM + LOAD_MARGIN_M; view.known = true; }
export function lazyLoadRadius() { return view.loadM; }
/** Distance (m) from the eye within which a ready mesh counts as used (`touchMesh` callers). */
export function lazyHoldRadius() { return view.loadM + HOLD_MARGIN_M; }

/** S8-B2-03: GPU-side owners of per-mesh buffers (MeshBuffers) subscribe to be told when a mesh payload is released. @type {Set<(mesh: any) => void>} */
const evictListeners = new Set();
/** @param {(mesh: any) => void} fn @returns {() => void} unsubscribe */
export function onMeshEvicted(fn) { evictListeners.add(fn); return () => { evictListeners.delete(fn); }; }

/** Marks a ready lazy mesh as used this frame (no-op for eager meshes / shells). @param {any} mesh */
export function touchMesh(mesh) {
  const rec = mesh.lazyOrigin;
  if (rec) rec.lastUsed = rec.store.clock;
}

/** @param {any} mesh @returns {boolean} true when the mesh has its vertex payload (always true for an eager mesh) */
export function meshReady(mesh) { return !mesh.lazy; }

/** Asks for a shell's payload (no-op for a ready mesh). @param {any} mesh @returns {Promise<any>|undefined} */
export function requestMesh(mesh) { return mesh.lazy ? mesh.lazy.store.request(mesh) : undefined; }

/** Editor / tool path: resolves with the mesh once its payload is decoded (immediately for a ready mesh). Ignores the per-frame budget. @param {any} mesh @returns {Promise<any>} */
export function ensureMesh(mesh) { return mesh.lazy ? mesh.lazy.store.ensure(mesh) : Promise.resolve(mesh); }

/** Per-frame decode step of every store with queued payloads (called once per camera feed). */
export function pumpLazyMeshes() { for (const s of activeStores) s.pump(); }

/**
 * Scatter group (instance buffer `ib`, 16-word rows, translation at words 3/7/11): request its mesh when any instance is within
 * the load radius of the last camera feed's eye. The scan is throttled (once per 30 calls per mesh).
 * @param {any} mesh @param {{ib: {f32: Float32Array}, count: number}} g
 */
export function requestMeshForGroup(mesh, g) {
  const rec = mesh.lazy || mesh.lazyOrigin;
  if (!rec || (mesh.lazy && rec.promise)) return;
  const ready = !mesh.lazy;
  if (view.known) {
    if (rec.scanAt > 0) { rec.scanAt--; return; }
    rec.scanAt = 30;
    const f = g.ib.f32, r2 = (ready ? lazyHoldRadius() : view.loadM) ** 2;
    let near = false;
    for (let i = 0; i < g.count && !near; i++) {
      const dx = f[i * 16 + 3] - view.x, dy = f[i * 16 + 7] - view.y;
      near = dx * dx + dy * dy <= r2;
    }
    if (!near) return;
  }
  if (ready) rec.lastUsed = rec.store.clock; else rec.store.request(mesh);
}

/**
 * Can this meta be a shell? Only when nothing needs its render triangles before the payload arrives (collider build, terrain).
 * @param {any} meta
 */
export function lazyEligible(meta) {
  return typeof meta.bin === 'string' && meta.layout === 'static' && (meta.collide === false || !!meta.colliderB64 || meta.triCount === 0);
}

const EMPTY_F32 = new Float32Array(0), EMPTY_U32 = new Uint32Array(0);
const STREAMS = ['pos', 'uv', 'uvMask', 'nrm', 'flat', 'aux', 'idx'];

export class LazyMeshStore {
  /**
   * @param {{fetchBytes: (url: string) => Promise<ArrayBuffer|Uint8Array>, now?: () => number, log?: ((msg: string) => void)|null, maxInflight?: number, maxDecodes?: number, budgetMs?: number, evictAfterMs?: number}} o
   *   `evictAfterMs` (default EVICT_AFTER_MS; 0 or Infinity = never): S8-B2-03 LRU release of untouched ready meshes
   */
  constructor(o) {
    this.fetchBytes = o.fetchBytes;
    this.now = o.now || (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
    this.log = o.log === undefined ? ((m) => console.info(m)) : o.log;
    this.maxInflight = o.maxInflight || MAX_INFLIGHT;
    this.maxDecodes = o.maxDecodes || MAX_DECODES_PER_FRAME;
    this.budgetMs = o.budgetMs || BUDGET_MS;
    this.evictAfterMs = o.evictAfterMs === undefined ? EVICT_AFTER_MS : (o.evictAfterMs > 0 ? o.evictAfterMs : Infinity);
    /** Time of the last `pump()` (ms); `touchMesh` stamps with it so a touch costs no clock read. */
    this.clock = this.now();
    this._sweepIn = SWEEP_EVERY;
    this._ready = 0; // ready (evictable) meshes
    /** @type {Map<string, any>} id -> shell */ this.shells = new Map();
    /** @type {any[]} */ this.fetchQueue = [];
    /** @type {any[]} */ this.decodeQueue = [];
    this.inflight = 0;
    this.stats = { evicted: 0, registered: 0, requested: 0, fetched: 0, fetchedBytes: 0, decoded: 0, failed: 0, pumps: 0, maxDecodesPerPump: 0, maxPumpMs: 0 };
    this._logged = 0;
  }

  /**
   * Creates the shell MeshData of a meta (the same fields `meshFromBin` gives, streams empty) and registers it.
   * @param {any} meta parsed .mesh.json (migrated) @param {string} binUrl absolute url of the .mesh.bin
   */
  makeShell(meta, binUrl) {
    const rec = { store: this, meta, binUrl, state: 'idle', promise: null, resolve: null, reject: null, force: false, bytes: null, scanAt: 0 };
    const shell = {
      version: meta.version, id: meta.id, layout: meta.layout,
      pos: EMPTY_F32, uv: EMPTY_F32, nrm: EMPTY_U32, flat: EMPTY_U32, aux: EMPTY_F32, idx: null,
      triCount: meta.triCount, bbox: Float64Array.from(meta.bbox),
      ranges: meta.ranges.map((r) => ({ start: r.start, count: r.count, ...(r.part !== undefined ? { part: r.part } : {}), ...(r.mask ? { mask: { tex: r.mask.tex, cutoff: r.mask.cutoff } } : {}) })),
      matKeys: meta.matKeys.slice(),
      ...(meta.mats ? { mats: { ...meta.mats } } : {}),
      matsResolved: meta.matsResolved, meshVersion: meta.meshVersion,
      ...(meta.castShadow === false ? { castShadow: false } : {}),
      ...(meta.collide === false ? { collide: false } : {}),
      ...(meta.colliderB64 ? { collider: base64ToF32(meta.colliderB64) } : {}),
      lazy: rec,
    };
    Object.defineProperty(shell, 'lazyOrigin', { value: rec, enumerable: false, configurable: true, writable: true });
    rec.caches = new Set(); // draw caches (MeshDrawCache) holding a copy of this mesh's arrays
    rec.lastUsed = this.clock;
    rec.pinned = false;
    this.shells.set(meta.id, shell);
    this.stats.registered++;
    return shell;
  }

  /** @param {any} mesh @returns {Promise<any>} the same Promise for every call; resolves with the mesh when its payload is in. */
  request(mesh) {
    const rec = mesh.lazy;
    if (!rec) return Promise.resolve(mesh);
    if (rec.promise) return rec.promise;
    rec.promise = new Promise((res, rej) => { rec.resolve = res; rec.reject = rej; });
    rec.promise.catch(() => {}); // a failed background load is warned once, never an unhandled rejection
    rec.state = 'queued';
    this.stats.requested++;
    this.fetchQueue.push(rec);
    activeStores.add(this);
    this._startFetches();
    return rec.promise;
  }

  /** Like `request`, but the decode is not deferred to `pump()` (editor / tools). */
  ensure(mesh) {
    const rec = mesh.lazy;
    if (!rec) return Promise.resolve(mesh);
    rec.force = true; rec.pinned = true; // editor path: never evicted
    const p = this.request(mesh);
    if (rec.state === 'fetched') this._decode(rec, mesh);
    return p;
  }

  _startFetches() {
    while (this.inflight < this.maxInflight && this.fetchQueue.length) {
      const rec = this.fetchQueue.shift();
      rec.state = 'fetching';
      this.inflight++;
      Promise.resolve().then(() => this.fetchBytes(rec.binUrl)).then((bytes) => {
        this.inflight--;
        this.stats.fetched++;
        this.stats.fetchedBytes += bytes.byteLength;
        rec.bytes = bytes; rec.state = 'fetched';
        if (rec.force) this._decode(rec, this.shells.get(rec.meta.id)); else this.decodeQueue.push(rec);
        this._startFetches();
      }, (err) => {
        this.inflight--;
        rec.state = 'failed'; this.stats.failed++;
        console.warn(`[lazymesh] fetch of "${rec.meta.id}" failed: ${err && err.message ? err.message : err}`);
        rec.reject(err);
        this._startFetches();
        this._idle();
      });
    }
  }

  /** @param {any} rec @param {any} mesh */
  _decode(rec, mesh) {
    if (rec.state !== 'fetched') return;
    try {
      const full = meshFromBin(rec.meta, rec.bytes);
      for (const k of STREAMS) if (full[k] !== undefined && full[k] !== null) mesh[k] = full[k];
    } catch (err) {
      rec.state = 'failed'; this.stats.failed++;
      console.warn(`[lazymesh] decode of "${rec.meta.id}" failed: ${err && err.message ? err.message : err}`);
      rec.bytes = null; rec.reject(err); this._idle();
      return;
    }
    rec.bytes = null;
    rec.state = 'ready';
    rec.lastUsed = this.clock;
    delete mesh.lazy;
    this._ready++;
    lazyVersion++;
    this.stats.decoded++;
    rec.resolve(mesh);
    this._idle();
  }

  /** Decodes queued payloads: at most `maxDecodes` meshes or `budgetMs` per call (the first one always runs). */
  pump() {
    const t0 = this.clock = this.now();
    if (--this._sweepIn <= 0) { this._sweepIn = SWEEP_EVERY; this.sweep(); }
    if (!this.decodeQueue.length) return;
    let n = 0;
    while (this.decodeQueue.length && n < this.maxDecodes) {
      const rec = this.decodeQueue.shift();
      if (rec.state === 'fetched') { this._decode(rec, this.shells.get(rec.meta.id)); n++; }
      if (this.now() - t0 >= this.budgetMs) break;
    }
    const ms = this.now() - t0;
    this.stats.pumps++;
    if (n > this.stats.maxDecodesPerPump) this.stats.maxDecodesPerPump = n;
    if (ms > this.stats.maxPumpMs) this.stats.maxPumpMs = ms;
  }

  /**
   * S8-B2-03 LRU: releases every ready, unpinned mesh not touched for `evictAfterMs` (called every SWEEP_EVERY pumps).
   * The mesh object stays the same (placements, colliders and groups keep their reference); it goes back to a shell.
   * @returns {number} meshes released
   */
  sweep() {
    if (!this._ready || this.evictAfterMs === Infinity) return 0;
    let n = 0;
    for (const mesh of this.shells.values()) {
      const rec = mesh.lazyOrigin;
      if (mesh.lazy || rec.pinned || rec.state !== 'ready') continue;
      if (this.clock - rec.lastUsed >= this.evictAfterMs) { this.evict(mesh); n++; }
    }
    if (n) this._idle();
    return n;
  }

  /** Back to a shell: payload streams dropped (CPU), draw copies and GPU buffers released through the listeners. @param {any} mesh */
  evict(mesh) {
    const rec = mesh.lazyOrigin;
    if (!rec || mesh.lazy || rec.state !== 'ready') return;
    mesh.pos = EMPTY_F32; mesh.uv = EMPTY_F32; mesh.nrm = EMPTY_U32; mesh.flat = EMPTY_U32; mesh.aux = EMPTY_F32; mesh.idx = null;
    delete mesh.uvMask;
    for (const c of rec.caches) c._map.delete(mesh);
    rec.caches.clear();
    rec.state = 'idle'; rec.promise = null; rec.resolve = null; rec.reject = null; rec.force = false; rec.scanAt = 0;
    mesh.lazy = rec;
    this._ready--;
    lazyVersion++;
    this.stats.evicted++;
    for (const fn of evictListeners) fn(mesh);
  }

  /** Everything settled: leave the pump list and log the running totals once. */
  _idle() {
    if (this.inflight || this.fetchQueue.length || this.decodeQueue.length) return;
    if (!(this._ready > 0 && this.evictAfterMs !== Infinity)) activeStores.delete(this); // evictable meshes keep the store in the sweep list
    if (this.log && this.stats.decoded !== this._logged) {
      this._logged = this.stats.decoded;
      this.log(`[lazymesh] ${this.stats.decoded}/${this.stats.registered} lazy meshes loaded (${Math.round(this.stats.fetchedBytes / 1024)} KB fetched)`);
    }
  }
}
