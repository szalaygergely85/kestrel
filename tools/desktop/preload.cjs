// Trusted desktop marker: set before any page script runs (contextIsolation on).
const { contextBridge } = require('electron');
contextBridge.exposeInMainWorld('__kestrelDesktop', Object.freeze({ version: 1, shell: 'electron' }));
