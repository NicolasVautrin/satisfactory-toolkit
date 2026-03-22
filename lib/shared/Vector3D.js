class Vector3D {
  /**
   * @param {number|{x,y,z}} x  X component or plain {x,y,z} object
   * @param {number} [y]
   * @param {number} [z]
   */
  constructor(x, y, z) {
    if (typeof x === 'object') {
      this.x = x.x; this.y = x.y; this.z = x.z;
    } else {
      this.x = x; this.y = y; this.z = z;
    }
  }

  add(v) { return new Vector3D(this.x + v.x, this.y + v.y, this.z + v.z); }
  sub(v) { return new Vector3D(this.x - v.x, this.y - v.y, this.z - v.z); }
  scale(s) { return new Vector3D(this.x * s, this.y * s, this.z * s); }
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  cross(v) {
    return new Vector3D(
      this.y * v.z - this.z * v.y,
      this.z * v.x - this.x * v.z,
      this.x * v.y - this.y * v.x,
    );
  }

  get length() { return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z); }
  norm() { const l = this.length; return l > 0 ? this.scale(1 / l) : new Vector3D(0, 0, 0); }

  /** Full quaternion rotation. */
  rotate(q) {
    const cx = q.y * this.z - q.z * this.y;
    const cy = q.z * this.x - q.x * this.z;
    const cz = q.x * this.y - q.y * this.x;
    const cx2 = q.y * cz - q.z * cy;
    const cy2 = q.z * cx - q.x * cz;
    const cz2 = q.x * cy - q.y * cx;
    return new Vector3D(
      this.x + 2 * (q.w * cx + cx2),
      this.y + 2 * (q.w * cy + cy2),
      this.z + 2 * (q.w * cz + cz2),
    );
  }

  /** Z-axis only rotation (simplified for flat buildings). */
  rotateZ(rotation) {
    const cosT = 1 - 2 * rotation.z * rotation.z;
    const sinT = 2 * rotation.w * rotation.z;
    return new Vector3D(
      this.x * cosT - this.y * sinT,
      this.x * sinT + this.y * cosT,
      this.z,
    );
  }


  /**
   * Compose two quaternions: result = a * b.
   * Applying result to a vector is equivalent to rotating by b first, then a.
   * @param {{x,y,z,w}} a
   * @param {{x,y,z,w}} b
   * @returns {{x,y,z,w}}
   */
  static quatMul(a, b) {
    return {
      x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
      y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
      z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
      w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    };
  }
}

module.exports = Vector3D;
