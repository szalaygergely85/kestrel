// engine/entities/Entity.js (US-025, D-007). Real implementation per
// docs/architecture.md sections 7 and 10: plain-data
// `{ id, type, transform: {x,y,z,yawDeg,pitchDeg}, components: {...} }`, no
// class instances in state - systems are functions over entities with a
// given component, never methods on the entity itself.
export class Entity {
  /**
   * @param {string} type
   * @param {{x:number,y:number,z:number,yawDeg?:number,pitchDeg?:number}} transform
   * @param {Object} [components]
   * @param {string} [id]
   * @returns {Object} plain entity data
   */
  static create(type, transform, components = {}, id, parent = null) {
    if (!transform || typeof transform.x !== 'number' || typeof transform.y !== 'number' || typeof transform.z !== 'number') {
      throw new Error(`Entity.create("${type}"): transform must have finite numeric x, y, z`);
    }
    const tr = {
      x: transform.x,
      y: transform.y,
      z: transform.z,
      yawDeg: typeof transform.yawDeg === 'number' ? transform.yawDeg : 0,
      pitchDeg: typeof transform.pitchDeg === 'number' ? transform.pitchDeg : 0,
    };
    // ED-SCALE-1: optional uniform scale (absent = 1); only set when != 1 so unscaled entities stay unchanged.
    if (transform.scale > 0 && transform.scale !== 1) tr.scale = transform.scale;
    return {
      id,
      type,
      transform: tr,
      components: components || {},
      parent, // CO-2: structId record (null = free world entity), never a live frame
    };
  }

  /**
   * Eye position/orientation for an entity with a `components.body`
   * (`eyeH` above the feet, plus any first-person `feel.offset` - US-009).
   * @param {Object} entity
   * @returns {{x:number,y:number,z:number,yawDeg:number,pitchDeg:number}}
   */
  static eye(entity) {
    const body = entity.components && entity.components.body;
    const eyeH = body && typeof body.eyeH === 'number' ? body.eyeH : 0;
    const offset = body && body.feel && typeof body.feel.offset === 'number' ? body.feel.offset : 0;
    return {
      x: entity.transform.x,
      y: entity.transform.y,
      z: entity.transform.z + eyeH + offset,
      yawDeg: entity.transform.yawDeg,
      pitchDeg: entity.transform.pitchDeg,
    };
  }
}
