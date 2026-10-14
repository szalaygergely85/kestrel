// FERRUM-NOSPRITE-01 (D-086): no Ferrum glow billboard / horizon sprite card anywhere in the world data or its generator.
import fs from 'node:fs';
import assert from 'node:assert';
const rd = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const w = JSON.parse(rd('content/worlds/world_m1.world.json'));
assert.ok(!(w.entities || []).some((e) => e.id === 'ferrumGlow' || e.model === 'ferrumLights' || e.type === 'billboard' && /ferrum/i.test(e.id || '')), 'ferrumGlow entity present');
assert.strictEqual((w.horizon || []).length, 0, 'horizon sprite cards must stay empty (D-078/D-086)');
const gen = rd('tools/gen-ferrum-far.mjs');
assert.ok(!/type:\s*'billboard'|data\.entities\.push/.test(gen), 'gen-ferrum-far must not emit a billboard entity');
assert.ok(!/world:\s*\{\s*w:/.test(rd('design/models/ferrum_lights.js')), 'ferrum_lights keeps no world billboard size');
console.log('ferrum-nosprite ok');
