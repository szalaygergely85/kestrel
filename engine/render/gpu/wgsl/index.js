// WG-1c1 (docs/architecture.md 38.2): the list of every WGSL module the engine ships. `tools/capture-browser.mjs
// --mode wgsl` compiles each entry through createShaderModule + getCompilationInfo (0 errors required); later WG
// steps append their `<pass>.wgsl.js` here. Pure data + helpers, no GPU globals.

import { PRESENT_WGSL } from './present.wgsl.js';

/** @type {ReadonlyArray<{name: string, code: string}>} */
export const WGSL_MODULES = Object.freeze([
  { name: 'present', code: PRESENT_WGSL },
]);

/**
 * Folds `GPUCompilationInfo.messages` into a JSON-safe summary (pure, Node-tested).
 * @param {string} name
 * @param {ReadonlyArray<{type: string, message: string, lineNum?: number, linePos?: number}>} messages
 * @returns {{name: string, errors: number, warnings: number, firstError: string|null}}
 */
export function summarizeCompilation(name, messages) {
  let errors = 0, warnings = 0, firstError = null;
  for (const m of messages || []) {
    if (m.type === 'error') {
      errors++;
      if (firstError === null) firstError = `${m.lineNum || 0}:${m.linePos || 0} ${m.message}`;
    } else if (m.type === 'warning') warnings++;
  }
  return { name, errors, warnings, firstError };
}
