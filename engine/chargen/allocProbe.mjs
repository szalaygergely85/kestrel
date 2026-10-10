// Child process for mesh.test.js: sampleClip B/call on a 22-bone rig in a fresh isolate (no feedback pollution from the
// other tests). Input (stdin JSON): {bones:[names], clip}. Prints bytes/call (median of 7 windows after a long warm-up).
import { sampleClip } from './index.js';
let s = ''; for await (const c of process.stdin) s += c;
const { bones, clip } = JSON.parse(s);
const rg = { cellM: 0.025, bones: bones.map((name) => ({ name })) };
const o = new Float64Array(4 * bones.length), hp = [0, 0, 0];
const run = (n) => { for (let i = 0; i < n; i++) sampleClip(rg, clip, (i * 7) % 1000, o, hp); };
run(400000);
const w = [];
for (let k = 0; k < 7; k++) { globalThis.gc?.(); run(150000); const h0 = process.memoryUsage().heapUsed; run(100000); w.push((process.memoryUsage().heapUsed - h0) / 100000); }
console.log(w.sort((a, b) => a - b)[3]);
