class Quaternion {
  /**
   * @param {number|{x,y,z,w}} x  X component or plain {x,y,z,w} object
   * @param {number} [y]
   * @param {number} [z]
   * @param {number} [w]
   */
  constructor(x, y, z, w) {
    if (typeof x === 'object') {
      this.x = x.x; this.y = x.y; this.z = x.z; this.w = x.w;
    } else {
      this.x = x; this.y = y; this.z = z; this.w = w;
    }
  }

  /**
   * Compose two quaternions: result = this * q.
   * Applying result to a vector is equivalent to rotating by q first, then this.
   */
  multiply(q) {
    return new Quaternion(
      this.w * q.x + this.x * q.w + this.y * q.z - this.z * q.y,
      this.w * q.y - this.x * q.z + this.y * q.w + this.z * q.x,
      this.w * q.z + this.x * q.y - this.y * q.x + this.z * q.w,
      this.w * q.w - this.x * q.x - this.y * q.y - this.z * q.z,
    );
  }

  /** Conjugate (inverse for unit quaternions). */
  inverse() {
    return new Quaternion(-this.x, -this.y, -this.z, this.w);
  }

  /** Rotate a Vector3D by this quaternion. */
  rotateVector(v) {
    const Vector3D = require('./Vector3D');
    const cx = this.y * v.z - this.z * v.y;
    const cy = this.z * v.x - this.x * v.z;
    const cz = this.x * v.y - this.y * v.x;
    const cx2 = this.y * cz - this.z * cy;
    const cy2 = this.z * cx - this.x * cz;
    const cz2 = this.x * cy - this.y * cx;
    return new Vector3D(
      v.x + 2 * (this.w * cx + cx2),
      v.y + 2 * (this.w * cy + cy2),
      v.z + 2 * (this.w * cz + cz2),
    );
  }

  /** Z-axis only rotation (simplified for flat buildings). */
  rotateVectorZ(v) {
    const Vector3D = require('./Vector3D');
    const cosT = 1 - 2 * this.z * this.z;
    const sinT = 2 * this.w * this.z;
    return new Vector3D(
      v.x * cosT - v.y * sinT,
      v.x * sinT + v.y * cosT,
      v.z,
    );
  }

  /** @returns {{x,y,z,w}} Plain object for save serialization. */
  toPlain() {
    return { x: this.x, y: this.y, z: this.z, w: this.w };
  }
}

Quaternion.IDENTITY = new Quaternion(0, 0, 0, 1);

/**
 * Build a Z-axis rotation that maps a local XY vector to a world XY vector.
 * Solves: R * localDir = worldDir (rotation around Z only).
 * @param {{x,y}} localDir  Local-space direction (e.g. {x:1,y:0} for +X, {x:0,y:-1} for -Y)
 * @param {{x,y}} worldDir  Desired world-space direction
 * @returns {Quaternion}
 */
Quaternion.fromLocalToWorldZ = function(localDir, worldDir) {
  const localAngle = Math.atan2(localDir.y, localDir.x);
  const worldAngle = Math.atan2(worldDir.y, worldDir.x);
  const angle = worldAngle - localAngle;
  return new Quaternion(0, 0, Math.sin(angle / 2), Math.cos(angle / 2));
};

/** Yaw angle (radians) → Z-axis quaternion. */
Quaternion.fromYaw = function(radians) {
  return new Quaternion(0, 0, Math.sin(radians / 2), Math.cos(radians / 2));
};

module.exports = Quaternion;
