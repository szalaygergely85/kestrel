// tools/chargen/platform.js (CHARGEN-14): file save/open adapter. The core never sees it.
// Tauri shell (window.__TAURI__ dialog + fs, user-picked paths only) else browser (Blob + a[download] / <input type=file>).
// filters: [{ name, extensions: ['kestrel'] }]. saveFile -> true (saved) | false (cancelled); openFile -> {name, bytes} | null.
const baseName = (p) => String(p).split(/[\\/]/).pop();
const mimeOf = (name) => (/\.glb$/i.test(name) ? 'model/gltf-binary' : /\.png$/i.test(name) ? 'image/png' : /\.(zip|kestrel)$/i.test(name) ? 'application/zip' : 'application/octet-stream');

export function createPlatform(win = globalThis.window) {
  const t = win && win.__TAURI__;
  if (t && t.dialog && t.fs) {
    return {
      kind: 'tauri',
      async saveFile(name, bytes, filters = []) {
        const path = await t.dialog.save({ defaultPath: name, filters });
        if (!path) return false; // cancelled: nothing written
        await t.fs.writeFile(path, bytes);
        return true;
      },
      async openFile(filters = []) {
        const path = await t.dialog.open({ multiple: false, directory: false, filters });
        if (!path) return null;
        return { name: baseName(path), bytes: new Uint8Array(await t.fs.readFile(path)) };
      },
    };
  }
  return {
    kind: 'browser',
    async saveFile(name, bytes) {
      const doc = win.document;
      const a = doc.createElement('a');
      a.href = win.URL.createObjectURL(new win.Blob([bytes], { type: mimeOf(name) }));
      a.download = name;
      doc.body.append(a); a.click(); a.remove();
      setTimeout(() => win.URL.revokeObjectURL(a.href), 4000);
      return true;
    },
    openFile(filters = []) {
      const doc = win.document;
      const input = doc.createElement('input');
      input.type = 'file';
      input.accept = filters.flatMap((f) => f.extensions || []).map((e) => '.' + e).join(',');
      return new Promise((resolve) => {
        input.addEventListener('change', async () => {
          const f = input.files && input.files[0];
          resolve(f ? { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) } : null);
        });
        input.addEventListener('cancel', () => resolve(null));
        input.click();
      });
    },
  };
}
