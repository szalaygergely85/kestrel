// engine/core/FrameProfiler.js - US-018 spike hunt (architecture.md 16):
// "which subsystem ran in the worst frame". A fixed list of section names,
// per-frame ms accumulated per section (a section may run several times per
// frame, e.g. once per fixed sim step), and a snapshot of the worst frame
// (highest simMs + renderMs) since the last reset(). Allocation-free after
// construction (rule 9); `Loop` calls beginFrame()/endFrame() when its
// `profiler` field is set, game code calls add(i, ms) around its sections.
// Time not covered by any section (`unattributed`) in a worst frame points
// at GC / JIT / driver stalls rather than a named subsystem.

export class FrameProfiler {
  /** @param {string[]} names - section names, index = section id for add() */
  constructor(names) {
    this.names = names.slice();
    const n = this.names.length;
    this.cur = new Float64Array(n);
    this.worst = new Float64Array(n);
    this.worstJsMs = 0; this.worstSimMs = 0; this.worstRenderMs = 0;
    this.worstSteps = 0; this.worstFrame = -1;
    this.frame = 0;
  }

  /** Zeroes the worst-frame snapshot and the frame counter. */
  reset() {
    this.worst.fill(0);
    this.worstJsMs = 0; this.worstSimMs = 0; this.worstRenderMs = 0;
    this.worstSteps = 0; this.worstFrame = -1;
    this.frame = 0;
  }

  beginFrame() { this.cur.fill(0); }

  /** @param {number} i - section index into `names` @param {number} ms */
  add(i, ms) { this.cur[i] += ms; }

  /** Called by Loop after render(); keeps the frame if it is the worst so far. */
  endFrame(simMs, renderMs, steps) {
    const js = simMs + renderMs;
    if (js > this.worstJsMs) {
      this.worstJsMs = js; this.worstSimMs = simMs; this.worstRenderMs = renderMs;
      this.worstSteps = steps; this.worstFrame = this.frame;
      this.worst.set(this.cur);
    }
    this.frame++;
  }

  /** Debug text (allocates - call at report time only, never per frame). */
  format() {
    if (this.worstFrame < 0) return 'worst frame: none';
    let covered = 0;
    const parts = [];
    for (let i = 0; i < this.names.length; i++) {
      covered += this.worst[i];
      if (this.worst[i] >= 0.05) parts.push(`${this.names[i]} ${this.worst[i].toFixed(2)}`);
    }
    return `worst frame #${this.worstFrame}: js ${this.worstJsMs.toFixed(2)} ms (sim ${this.worstSimMs.toFixed(2)} x${this.worstSteps} steps, render ${this.worstRenderMs.toFixed(2)})` +
      `\n  sections: ${parts.join('  ') || '-'}  unattributed ${Math.max(0, this.worstJsMs - covered).toFixed(2)} (GC/JIT/driver)`;
  }
}
