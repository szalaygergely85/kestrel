// WM-01 GEO-PERF: the terrain bytes (height + type) of 10 probe zones + the far map are pinned to the values measured BEFORE the per-sample
// speed-up (layer AABB skips, hoisted/cached terms). Pins computed on unchanged code, 2026-10-13.
import { hashes } from './bench-geo-perf.mjs';
const PIN = { keep: '59ba45fe7416b058', northwood: '02b7750db0b7185e', downs: '57e192ee2c373510', strand: 'a2b8ab323f304e75', reedmire: 'af391180199d2555',
  far: '438034bfd18de947', glasswater: 'c58e47b838975eca', whitecombs: '6df17dd56a83655c', gatePass: '9cf93a2e2b72d748', westFells: 'eb8edec751edb2a6', farGenerate: '747fd2286aa7805d' };
const got = hashes();
let fail = 0;
for (const k of Object.keys(PIN)) { const okk = got[k] === PIN[k]; if (!okk) { fail++; console.error(`FAIL: ${k} ${got[k]} != ${PIN[k]}`); } }
console.log(`${Object.keys(PIN).length - fail} passed, ${fail} failed.`);
if (fail) process.exit(1);
console.log('ALL PASS');
