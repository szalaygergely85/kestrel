// US-090w: host glue for the title menu (lane-C module ui/titleMenu.js). No DOM access: main.js feeds it pressed keys,
// pointer cells and callbacks, so the flow runs in Node (titleMenuHost.test.js).
// The menu is shown BEFORE play; the world boots behind it. While `active`, main.js freezes the sim (update returns early)
// and draws the card over the scene. The old title card (wake timeline) is unchanged and plays after the menu closes.
import { createTitleMenu } from './ui/titleMenu.js';

const CREDITS_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Enter', 'Home', 'End', 'Escape'];
const CREATE_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyS', 'KeyA', 'KeyD', 'Enter', 'Space', 'Escape']; // CHARGEN-17
export const MENU_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyS', 'Enter', 'Space', 'Escape']; // TITLE-MENU-02: no Delete (no delete UI any more)

/**
 * @param {{adapter:any, style?:any, onNewGame:(slot:number, look?:object)=>void, onContinue:(slot:number, save:any)=>void, onLoad?:(slot:number, save:any)=>void, onSettings:()=>void, createCredits?:()=>any}} o
 */
export function createTitleMenuHost({ adapter, style = null, onNewGame, onContinue, onLoad = null, onSettings, createCredits = null, createCharCreate = null }) {
  const menu = createTitleMenu(adapter, { style });
  menu.refresh();
  let active = true;
  let create = null, createSlot = 0; // CHARGEN-17: open creation screen (ui/charCreate.js) after New game, or null
  let credits = null; // open Credits view (ui/creditsView.js) or null; the menu card is hidden while it is up
  const host = {
    menu,
    get active() { return active; },
    /** Feed one fixed step's key edges (`pressed(code)` -> bool). Settings open = the host must not call this. */
    step(pressed) {
      if (!active) return;
      if (create) { // creation screen: W/S/A/D/Enter like Settings; Confirm starts the game, Back returns to the menu card
        for (const code of CREATE_KEYS) if (pressed(code)) create.handleKey(code);
        const a = create.takeAction();
        if (a) { create = null; if (a.type === 'confirm') { active = false; onNewGame(createSlot, a.look); } }
        return;
      }
      if (credits) { // Credits open: Up/Down/Enter/Home/End page, Esc = Back to the menu card
        for (const code of CREDITS_KEYS) if (pressed(code)) credits.handleKey(code);
        if (credits.takeAction()) credits = null;
        return;
      }
      // Credits shortcut until lane C adds a 'credits' row to titleMenu.js (NEEDS C): C opens it from the main card.
      if (createCredits && pressed('KeyC') && host.openCredits()) return;
      for (const code of MENU_KEYS) if (pressed(code)) menu.handleKey(code);
      host.consume();
    },
    /** Pointer in UI-grid cells; `click` false = hover only. Returns true when the pointer hit a row. */
    pointer(x, y, click) {
      if (!active || credits || create) return false;
      const hit = menu.handlePointer(x, y, click);
      host.consume();
      return hit;
    },
    consume() {
      const a = menu.takeAction();
      if (!a) return;
      if (a.type === 'credits') { host.openCredits(); return; }
      if (a.type === 'settings') { onSettings(); return; } // stays active; the menu card returns when Settings closes
      if (a.type === 'newGame') {
        const c = createCharCreate ? createCharCreate() : null;
        if (c) { create = c; createSlot = a.slot; } else { active = false; onNewGame(a.slot); }
      }
      else if (a.type === 'continue') { active = false; onContinue(a.slot, a.save); }
      else if (a.type === 'load' && Number.isInteger(a.slot)) { active = false; (onLoad || onContinue)(a.slot, a.save); } // explicit slot, same resume boot as Continue
      // any other action (e.g. legacy 'delete') is ignored; the menu stays up
    },
    get createOpen() { return !!create; },
    get creditsOpen() { return !!credits; },
    openCredits() {
      if (!active || credits || !createCredits) return false;
      credits = createCredits() || null;
      return !!credits;
    },
    /** Draw into the UI layer (after ui.clear). */
    draw(ui) { if (active) (create || credits || menu).draw(ui); },
  };
  return host;
}

/** NEWGAME-PAUSED-01: isPaused() = !look.locked, so a menu start must re-lock the pointer (the menu key/click is the user gesture). */
export function withRelock(fn, relock) {
  return (...args) => { const r = fn(...args); try { relock(); } catch { /* arrow-key fallback */ } return r; };
}
