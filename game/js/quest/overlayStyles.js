// game/js/quest/overlayStyles.js (US-079a/US-128, architecture.md 29.1/29.2).
// Builds the one object passed to `engine.overlay.setStyles` at boot: the
// designer-authored Z-targeting ring/bar styles already in
// `assets.uiStyle.overlay` (design/models/title.js), forwarded as-is, plus
// the beast `!` notice marker placeholder from the same object. One call
// site, one source of truth - nothing here invents a style, it only merges.
export function questOverlayStyles(uiStyle) {
  return Object.assign({}, uiStyle && uiStyle.overlay);
}
