// US-090w: host glue for the title menu (lane-C module ui/titleMenu.js). No DOM access: main.js feeds it pressed keys,
// pointer cells and callbacks, so the flow runs in Node (titleMenuHost.test.js).
// The menu is shown BEFORE play; the world boots behind it. While `active`, main.js freezes the sim (update returns early)
// and draws the card over the scene. The old title card (wake timeline) is unchanged and plays after the menu closes.
import { createTitleMenu } from './ui/titleMenu.js';

export const MENU_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyS', 'Enter', 'Space', 'Delete', 'Escape'];

/**
 * @param {{adapter:any, style?:any, onNewGame:(slot:number)=>void, onContinue:(slot:number, save:any)=>void, onSettings:()=>void}} o
 */
export function createTitleMenuHost({ adapter, style = null, onNewGame, onContinue, onSettings }) {
  const menu = createTitleMenu(adapter, { style });
  menu.refresh();
  let active = true;
  const host = {
    menu,
    get active() { return active; },
    /** Feed one fixed step's key edges (`pressed(code)` -> bool). Settings open = the host must not call this. */
    step(pressed) {
      if (!active) return;
      for (const code of MENU_KEYS) if (pressed(code)) menu.handleKey(code);
      host.consume();
    },
    /** Pointer in UI-grid cells; `click` false = hover only. Returns true when the pointer hit a row. */
    pointer(x, y, click) {
      if (!active) return false;
      const hit = menu.handlePointer(x, y, click);
      host.consume();
      return hit;
    },
    consume() {
      const a = menu.takeAction();
      if (!a) return;
      if (a.type === 'settings') { onSettings(); return; } // stays active; the menu card returns when Settings closes
      active = false;
      if (a.type === 'newGame') onNewGame(a.slot);
      else if (a.type === 'continue') onContinue(a.slot, a.save);
    },
    /** Draw into the UI layer (after ui.clear). */
    draw(ui) { if (active) menu.draw(ui); },
  };
  return host;
}
