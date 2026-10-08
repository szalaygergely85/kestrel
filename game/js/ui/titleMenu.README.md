# US-090a title menu module

Open `/game/js/ui/titleMenu.preview.html` through the project's no-cache static
server. The preview uses memory-only slots and public WebGPU presentation at
400x150 with the standard 160x60 UI layer. Keyboard arrows/W/S, Enter/Space,
Delete and Escape work; mouse movement selects a row and clicking activates it.
The preview adopts PC-A's `design/models/menu_ui.js` style and Sprint 8 writer
labels. Use `?backend=webgl2` for the Arc or `?backend=webgpu` (default).
Confirmation presentation has an open LOOK RISK in `docs/test-reports/S8-C-03.md`;
navigation/storage checks pass on both backends, but visual acceptance is pending.

Host integration (US-090w, B1):

```js
const menu = createTitleMenu(createStorageAdapter(storage), {style: ASSETS.uiStyle.menu});
menu.draw(engine.ui);
menu.handleKey('ArrowDown');
const action = menu.takeAction();
```

Draw after clearing the UI; map pointer coordinates into that same UI grid and
pass them to `handlePointer(x,y)`. Its third argument `false` means hover-only.
`takeAction()` consumes one `{type:'newGame',slot}`, `{type:'continue',slot,save}`
or `{type:'settings'}` request. The host owns new-game boot, applying loaded
saves and opening Settings. Pending actions block more input until consumed.
`refresh()` reloads slot metadata after external storage changes.

New game asks for a target slot. An occupied/unreadable slot requires explicit
replacement confirmation; the module never deletes it before the host has
successfully created/saved the replacement. Continue uses the selected valid
slot or the first valid slot; clicking a populated slot loads it directly.
Slot labels show player name, place and elapsed hours/minutes. Empty, corrupt
and unavailable slots cannot emit Continue. Delete uses the adapter only after
confirmation, defaults to Cancel, preserves other slots and shows storage
failure without claiming success. No automatic save/load hook or game boot
edit is included.

Rows and labels are cached on input/refresh. `draw()` uses existing public
text/cell methods and a reusable layout object; it does no storage I/O or
menu-state allocation on the frame path.
The `style` option is optional for existing hosts; supplied tokens control
colours, borders, focus and disabled/destructive states without changing row ids
or geometry. Load `menu_ui.js` after `title.js`, which creates `ASSETS.uiStyle`.
