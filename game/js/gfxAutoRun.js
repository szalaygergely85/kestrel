// GFX-02: browser side of the auto-pick (adapter info, loading card, timed benchmark). The decision is pure: gfxAuto.js.
// Flow: gatherAdapterInfo() before boot -> provisional preset = candidate tier -> world renders behind the card ->
// AutoBench.tick() each rendered frame: discard WARM_MS (pipeline compile, uploads), then collect samples for MEASURE_MS.
// Time only advances while the tab is visible (a hidden tab restarts the current phase).

export const WARM_MS = 1500, MEASURE_MS = 2000;
export const CARD_TEXT = 'Checking your graphics...';

/** WebGL renderer string (ANGLE (...)) via a throwaway canvas; '' when unavailable. */
export function webglRendererString(doc = document) {
  try {
    const gl = doc.createElement('canvas').getContext('webgl2') || doc.createElement('canvas').getContext('webgl');
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const s = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return s;
  } catch { return ''; }
}

/** Adapter info for pickQuality: WebGPU adapter fields + WebGL renderer label. Never throws. */
export async function gatherAdapterInfo(probeWebGpu, doc = document) {
  let adapter = {};
  try { const p = await probeWebGpu(); if (p && p.available) adapter = p.adapter; } catch { /* ignore */ }
  const label = webglRendererString(doc);
  if (!adapter.vendor && !adapter.description && !label) return null;
  return { ...adapter, label };
}

export function showCard(doc = document) {
  const el = doc.createElement('div');
  el.id = 'gfx-auto-card';
  el.textContent = CARD_TEXT;
  el.style.cssText = 'position:fixed;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;' +
    'background:rgba(0,0,0,0.88);color:#ddd;font:16px monospace;letter-spacing:1px';
  doc.body.appendChild(el);
  return el;
}

export class AutoBench {
  /**
   * @param {{sample:()=>number, intervalMs?:()=>number, onDone:(r:{samples:number[],kind:string})=>void,
   *          now?:()=>number, visible?:()=>boolean}} o
   *   sample(): rolling-p95 GPU ms from the pipeline timer (NaN when no timer); the bench falls back to the frame interval when
   *   no finite GPU sample arrives during the measure window.
   */
  constructor({ sample, intervalMs = () => NaN, onDone, now = () => performance.now(), visible = () => document.visibilityState !== 'hidden' }) {
    Object.assign(this, { _sample: sample, _interval: intervalMs, _done: onDone, _now: now, _visible: visible });
    this.phase = 'warm'; this._t0 = null; this._last = null;
    this.gpu = []; this.frame = [];
  }

  tick() {
    if (this.phase === 'done') return;
    const t = this._now();
    if (!this._visible()) { this._t0 = null; if (this.phase === 'measure') { this.phase = 'warm'; this.gpu.length = 0; this.frame.length = 0; } return; }
    if (this._t0 === null) this._t0 = t;
    const el = t - this._t0;
    if (this.phase === 'warm' && el >= WARM_MS) { this.phase = 'measure'; this._t0 = t; return; }
    if (this.phase === 'measure') {
      const g = this._sample(), f = this._interval();
      if (Number.isFinite(g)) this.gpu.push(g);
      if (Number.isFinite(f)) this.frame.push(f);
      if (el >= MEASURE_MS) {
        this.phase = 'done';
        // GPU timers report a rolling 120-frame p95 (the raw per-frame value is cached/stale and the first frame is a compile
        // outlier of seconds), so only the last 40% of the window is used: by then the ring holds measure-window frames only.
        const useGpu = this.gpu.length >= 20;
        this._done({ samples: useGpu ? this.gpu.slice(Math.floor(this.gpu.length * 0.6)) : this.frame, kind: useGpu ? 'gpu' : 'frame', frameSamples: this.frame, minSamples: useGpu ? 8 : undefined });
      }
    }
  }
}
