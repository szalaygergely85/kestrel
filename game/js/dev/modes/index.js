// US-048 (docs/backlog.md, PC-B QUEUE 4 item 2): the `{ name, run(ctx) }`
// table for main.js's dev-mode URL dispatch. Covers exactly the modes the
// story's AC names (bench, shadetest, gpucompare=1|shade[|mesh - see
// gpucompare.js's own header comment for why mesh rides along], flicker,
// glyphs, demo) - `?voxelbench=1` and the default `runGame('world')` path
// are NOT in this table (out of the story's AC list; `runGame` itself stays
// in main.js untouched per the AC's "do not restructure runGame's render
// path").
import * as bench from './bench.js';
import * as shadetest from './shadetest.js';
import * as gpucompare from './gpucompare.js';
import * as flicker from './flicker.js';
import * as glyphs from './glyphs.js';
import * as demo from './demo.js';

export const MODES = [bench, shadetest, gpucompare, flicker, glyphs, demo];
