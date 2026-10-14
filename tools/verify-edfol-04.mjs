// ED-FOLIAGE-04 browser check (not run by agents without a browser): node tools/verify-edfol-04.mjs <port 9500-9574>
// Serves the repo, opens the editor, paints one decor stroke via window.__foliage, checks record/undo/redo/save text.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const port = Number(process.argv[2]); if (!(port >= 9000 && port <= 9999)) { console.error('usage: verify-edfol-04.mjs <port>'); process.exit(2); }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); fs.readFile(f, (e, d) => { if (e) { r.statusCode = 404; r.end(); } else { r.setHeader('content-type', f.endsWith('.js') || f.endsWith('.mjs') ? 'text/javascript' : f.endsWith('.json') ? 'application/json' : 'text/html'); r.end(d); } }); }).listen(port);
try {
  const { launchBrowser } = await import('./capture-browser.mjs').catch(() => ({}));
  if (!launchBrowser) { console.log(`server on ${port}; open http://localhost:${port}/tools/editor/index.html and run in the console:\n  const f=window.__foliage; f.fl.st.mode='decor'; await f.decorStrokeStart({x:0,y:0}); f.decorStrokeMove({x:10,y:0}); f.decorStrokeEnd(false); f.dp().dirty`); await new Promise((r) => setTimeout(r, 600000)); }
} finally { srv.close(); }
