const Vector3D   = require('./Vector3D');
const Quaternion = require('./Quaternion');

class Transform {
  /**
   * @param {{x,y,z}|Vector3D} translation
   * @param {{x,y,z,w}|Quaternion} rotation
   */
  constructor(translation, rotation) {
    this.translation = new Vector3D(translation);
    this.rotation    = new Quaternion(rotation || Quaternion.IDENTITY);
  }

  /**
   * Apply this transform to a value. Return type matches input type:
   *   apply({x,y,z})    → {x,y,z}        (plain point)
   *   apply(Vector3D)   → Vector3D
   *   apply(Transform)  → Transform
   */
  apply(value) {
    if (value instanceof Transform) {
      return new Transform(
        this.apply(value.translation),
        this.rotation.multiply(value.rotation),
      );
    }
    const rotated = this.rotation.rotateVector(new Vector3D(value)).add(this.translation);
    if (value instanceof Vector3D) {
      return rotated;
    }
    return { x: rotated.x, y: rotated.y, z: rotated.z };
  }

  /** @returns {{translation:{x,y,z}, rotation:{x,y,z,w}, scale3d:{x,y,z}}} Save format. */
  toSave() {
    return {
      translation: { x: this.translation.x, y: this.translation.y, z: this.translation.z },
      rotation:    this.rotation.toPlain(),
      scale3d:     { x: 1, y: 1, z: 1 },
    };
  }

  /**
   * Build a Transform from the save file format.
   * @param {{translation:{x,y,z}, rotation:{x,y,z,w}}} t
   */
  static fromSave(t) {
    return new Transform(t.translation, t.rotation);
  }
}

Transform.IDENTITY = new Transform({ x: 0, y: 0, z: 0 }, Quaternion.IDENTITY);

module.exports = Transform;
