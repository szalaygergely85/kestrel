// CHARGEN-14: platform adapter with fake windows.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPlatform } from './platform.js';

const bytes = new Uint8Array([1, 2, 3]);
const filters = [{ name: 'Kestrel', extensions: ['kestrel'] }];

function fakeTauri(picked) {
  const calls = [];
  return { calls, win: { __TAURI__: {
    dialog: { save: async (o) => { calls.push(['save', o]); return picked; }, open: async (o) => { calls.push(['open', o]); return picked; } },
    fs: { writeFile: async (p, b) => calls.push(['write', p, b]), readFile: async (p) => { calls.push(['read', p]); return new Uint8Array([9, 8]); } },
  } } };
}

test('tauri: save calls dialog then fs.writeFile with the picked path', async () => {
  const { win, calls } = fakeTauri('C:\\x\\c.kestrel');
  const p = createPlatform(win);
  assert.equal(p.kind, 'tauri');
  assert.equal(await p.saveFile('c.kestrel', bytes, filters), true);
  assert.deepEqual(calls.map((c) => c[0]), ['save', 'write']);
  assert.equal(calls[0][1].defaultPath, 'c.kestrel');
  assert.equal(calls[1][1], 'C:\\x\\c.kestrel'); assert.equal(calls[1][2], bytes);
});

test('tauri: cancel -> nothing written / null', async () => {
  const { win, calls } = fakeTauri(null);
  const p = createPlatform(win);
  assert.equal(await p.saveFile('a', bytes), false);
  assert.equal(await p.openFile(filters), null);
  assert.ok(!calls.some((c) => c[0] === 'write' || c[0] === 'read'));
});

test('tauri: open reads the picked path', async () => {
  const { win, calls } = fakeTauri('/home/u/a.kestrel');
  const r = await createPlatform(win).openFile(filters);
  assert.equal(r.name, 'a.kestrel'); assert.deepEqual([...r.bytes], [9, 8]);
  assert.deepEqual(calls[1], ['read', '/home/u/a.kestrel']);
});

function fakeBrowser(file) {
  const made = [];
  const mk = (tag) => {
    const e = { tag, listeners: {}, clicked: false, removed: false,
      addEventListener(n, f) { this.listeners[n] = f; },
      click() {
        this.clicked = true;
        if (tag === 'input') queueMicrotask(() => { if (file === 'cancel') this.listeners.cancel(); else { this.files = file ? [file] : []; this.listeners.change(); } });
      },
      remove() { this.removed = true; } };
    made.push(e); return e;
  };
  const win = { document: { createElement: mk, body: { append() {} } },
    URL: { createObjectURL: (b) => { win.blob = b; return 'blob:x'; }, revokeObjectURL() {} },
    Blob: class { constructor(parts, o) { this.parts = parts; this.type = o.type; } } };
  return { win, made };
}

test('browser: save creates a download link with name + bytes', async () => {
  const { win, made } = fakeBrowser();
  const p = createPlatform(win);
  assert.equal(p.kind, 'browser');
  assert.equal(await p.saveFile('character.glb', bytes), true);
  const a = made[0];
  assert.equal(a.download, 'character.glb'); assert.equal(a.href, 'blob:x'); assert.ok(a.clicked && a.removed);
  assert.equal(win.blob.parts[0], bytes); assert.equal(win.blob.type, 'model/gltf-binary');
});

test('browser: open resolves picked file; cancel -> null', async () => {
  const file = { name: 'z.kestrel', arrayBuffer: async () => new Uint8Array([5, 6]).buffer };
  const b1 = fakeBrowser(file);
  const r = await createPlatform(b1.win).openFile(filters);
  assert.equal(r.name, 'z.kestrel'); assert.deepEqual([...r.bytes], [5, 6]);
  assert.equal(b1.made[0].accept, '.kestrel');
  assert.equal(await createPlatform(fakeBrowser('cancel').win).openFile(filters), null);
});
