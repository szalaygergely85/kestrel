// SWIM-04d: pure mapping from held keys to controls.swimUp (-1 dive, 0, +1 up). Space is the jump binding: it only
// becomes swim-up while the body is swimming, so it still jumps on land. Host (main.js) calls this each step.
/** @param {boolean} jumpDown @param {boolean} diveDown @param {{swimming?:boolean}|null} body @returns {number} */
export function swimUpOf(jumpDown, diveDown, body) {
  if (!body || !body.swimming) return 0;
  return (jumpDown ? 1 : 0) - (diveDown ? 1 : 0);
}
/** controls.jump must be suppressed while swimming so Space does not also jump. */
export function jumpOf(jumpDown, body) { return !!jumpDown && !(body && body.swimming); }
