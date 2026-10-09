// BOOT progress bar model (owner request 2026-10-08): phases -> 0..1. Pure (no DOM, no clock), so Node can test it.
// Weights follow docs/test-reports/BOOT-SPEED-01.md (WebGPU, ~3.5 s after module start); the world build + world:loaded
// handler + terrain prebuild are one synchronous block in main.js (nothing can repaint inside it), so they share one phase.
export const BOOT_PHASES = Object.freeze([
  { id: 'content', label: 'Loading content', weight: 0.03 },
  { id: 'registry', label: 'Building assets', weight: 0.02 },
  { id: 'renderer', label: 'Starting renderer', weight: 0.05 },
  { id: 'compile', label: 'Compiling shaders', weight: 0.30, counted: true },
  { id: 'engine', label: 'Preparing engine', weight: 0.06 },
  { id: 'world', label: 'Building world', weight: 0.44 },
  { id: 'frame', label: 'First frame', weight: 0.10 },
]);

/** @param {(s: {value: number, label: string, phase: string, done: boolean}) => void} [onChange] */
export function createBootProgress(onChange) {
  const starts = []; let acc = 0;
  for (const p of BOOT_PHASES) { starts.push(acc); acc += p.weight; }
  const total = acc;
  const s = { value: 0, label: BOOT_PHASES[0].label, phase: BOOT_PHASES[0].id, done: false };
  function set(idx, frac, suffix) {
    if (s.done) return;
    const p = BOOT_PHASES[idx];
    const v = Math.min(1, (starts[idx] + p.weight * Math.max(0, Math.min(1, frac))) / total);
    if (v > s.value) s.value = v; // monotonic: a late/out-of-order update never moves the bar back
    s.phase = p.id; s.label = p.label + (suffix || '');
    if (onChange) onChange(s);
  }
  return {
    state: s,
    /** Enter phase `id` at its start. Unknown ids are ignored. */
    phase(id) { const i = BOOT_PHASES.findIndex((p) => p.id === id); if (i >= 0) set(i, 0, ''); },
    /** Counted progress inside a phase (e.g. compile 12/25): label gets " 12/25". */
    count(id, done, totalN) { const i = BOOT_PHASES.findIndex((p) => p.id === id); if (i >= 0 && totalN > 0) set(i, done / totalN, ` ${done}/${totalN}`); },
    finish() { if (s.done) return; s.value = 1; s.done = true; s.label = 'Ready'; s.phase = 'done'; if (onChange) onChange(s); },
  };
}

/** ASCII bar, e.g. `[██████░░░░░░░░░░░░░░]  30%`. @param {number} v 0..1 @param {number} [width] */
export function asciiBar(v, width = 28) {
  const n = Math.round(Math.max(0, Math.min(1, v)) * width);
  return `[${'█'.repeat(n)}${'░'.repeat(width - n)}] ${String(Math.round(v * 100)).padStart(3)}%`;
}
