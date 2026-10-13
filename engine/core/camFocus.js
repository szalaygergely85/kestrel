// US-068b3a (38.19 item 1): distance/LOD centre of a camera. Perspective/pitched: the eye (cam.x/y).
// Ortho: the eye sits ORTHO_BACK_M behind the scene, so distances key on the focus point instead.
/** @param {{x:number, projection?:string, focusX?:number}} cam @returns {number} */
export function lodCentreX(cam) { return cam.projection === 'ortho' && typeof cam.focusX === 'number' ? cam.focusX : cam.x; }
/** @param {{y:number, projection?:string, focusY?:number}} cam @returns {number} */
export function lodCentreY(cam) { return cam.projection === 'ortho' && typeof cam.focusY === 'number' ? cam.focusY : cam.y; }
/** @param {{z:number, projection?:string, focusZ?:number}} cam @returns {number} */
export function lodCentreZ(cam) { return cam.projection === 'ortho' && typeof cam.focusZ === 'number' ? cam.focusZ : cam.z; }
