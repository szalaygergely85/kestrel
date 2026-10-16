// HPBAR-03 wiring guard: main.js must call setDifficulty with the saved setting on a real (uncommented) line at startup.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const src = readFileSync(fileURLToPath(new URL('../main.js', import.meta.url)), 'utf8');
const live = src.split(/\r?\n/).map((l) => l.replace(/\/\/.*$/, '')).filter((l) => l.includes('combatHud.bars.bars.setDifficulty(savedSettings.difficulty)'));
if (live.length !== 1) { console.error(`FAIL hpbarWire: expected 1 live startup setDifficulty call, found ${live.length}`); process.exit(1); }
console.log('hpbarWire: 1 pass, 0 fail');
