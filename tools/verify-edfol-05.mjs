// ED-FOLIAGE-05 browser check (not run by agents): node tools/verify-edfol-05.mjs <port 9500-9574>
// Serves the repo; open the editor, Foliage tab: the meter chip follows the cursor zone; paint, then raise terrain over the
// strokes (Terrain tab) and run probe in the console: fl.ctl / __foliage; undo must restore both z and terrain.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const port = Number(process.argv[2]); if (!(port >= 9000 && port <= 9999)) { console.error('usage: verify-edfol-05.mjs <port>'); process.exit(2); }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); fs.readFile(f, (e, d) => { if (e) { r.statusCode = 404; r.end(); } else { r.setHeader('content-type', f.endsWith('.js') || f.endsWith('.mjs') ? 'text/javascript' : f.endsWith('.json') ? 'application/json' : 'text/html'); r.end(d); } }); }).listen(port);
console.log(`server on ${port}: http://localhost:${port}/tools/editor/index.html  (Foliage tab: meter, Measure; Terrain raise over painted rocks, Ctrl+Z restores both). 10 min, then exit.`);
await new Promise((r) => setTimeout(r, 600000)); srv.close();
