const Vector3D = require('./Vector3D');
const { sampleHermiteSpline } = require('./hermite');

/**
 * Base class for all entity Builders.
 * Provides common boilerplate: port(name), allObjects(), getPorts(entity).
 */
class Builder {
  constructor(entity, ...components) {
    this.entity = entity;
    this.inst = entity.instanceName;
    // Flatten: if first arg is an array, use it; otherwise use rest args
    this.components = Array.isArray(components[0]) ? components[0] : components;
    this._ports = {};
  }

  port(name) {
    const p = this._ports[name];
    if (!p) throw new Error(`${this.constructor.name} ${this.inst}: unknown port "${name}"`);
    // Lazy-set _owner so snap validation knows the owning Builder
    if (!p._owner) p._owner = this;
    return p;
  }

  allObjects() {
    return [this.entity, ...this.components];
  }

  /**
   * Get ports in world space for an existing entity (inspection, not editing).
   * Default: transforms PORT_LAYOUT offsets/dirs to world space.
   * Override in spline-based or dynamic-port Builders.
   * @param {object} entity  SaveEntity with transform and properties
   * @returns {{ ports: Array<{name, pos, dir, flow, type}>, splineLength: number|null } | null}
   */
  static getPorts(entity) {
    if (!this.PORT_LAYOUT) return null;
    const t = entity.transform.translation;
    const r = entity.transform.rotation;
    return {
      ports: Object.entries(this.PORT_LAYOUT).map(([name, p]) => {
        const pos = new Vector3D(p.offset).rotate(r).add(new Vector3D(t));
        const dir = p.dir ? new Vector3D(p.dir).rotate(r) : null;
        return { name, pos, dir, flow: p.flow, type: p.type };
      }),
      splineLength: null,
    };
  }

  // ── Spline helpers for subclass getPorts overrides ─────────────────

  /**
   * Parse mSplineData from entity properties into control points.
   * @returns {Array<{x,y,z, ax,ay,az, lx,ly,lz}>|null}
   */
  static _parseSplinePoints(entity) {
    const splineData = entity.properties?.mSplineData;
    const values = splineData?.values;
    if (!values || values.length < 2) return null;

    const points = [];
    for (const pt of values) {
      const props = pt.value?.properties || pt.properties;
      if (!props) continue;
      const loc = props.Location?.value || props.Location;
      const arrive = props.ArriveTangent?.value || props.ArriveTangent;
      const leave = props.LeaveTangent?.value || props.LeaveTangent;
      if (!loc) continue;
      points.push({
        x: loc.x, y: loc.y, z: loc.z,
        ax: arrive?.x || 0, ay: arrive?.y || 0, az: arrive?.z || 0,
        lx: leave?.x || 0, ly: leave?.y || 0, lz: leave?.z || 0,
      });
    }
    return points.length >= 2 ? points : null;
  }

  /**
   * Compute spline-based ports and length for a spline entity.
   * @param {object} entity       SaveEntity
   * @param {string[]} portNames  [startPortName, endPortName]
   * @param {string} portType     'belt', 'pipe', or 'track'
   * @returns {{ ports, splineLength }|null}
   */
  static _splinePorts(entity, portNames, portType) {
    const points = this._parseSplinePoints(entity);
    if (!points) return null;

    const t = entity.transform.translation;
    const r = entity.transform.rotation;

    // Sample spline in local space
    const sampled = sampleHermiteSpline(points, 6);

    // Transform to world space
    const worldPts = sampled.map(p => new Vector3D(p).rotate(r).add(new Vector3D(t)));

    // Compute length
    let splineLength = 0;
    for (let i = 0; i < worldPts.length - 1; i++) {
      splineLength += worldPts[i + 1].sub(worldPts[i]).length;
    }
    splineLength = Math.round(splineLength * 10) / 10;

    // Port positions = first/last world points
    const first = worldPts[0];
    const last = worldPts[worldPts.length - 1];

    // Port directions from tangents, transformed to world space
    const p0 = points[0];
    const pN = points[points.length - 1];
    const dir0 = new Vector3D(p0.lx, p0.ly, p0.lz).rotate(r);
    const dirN = new Vector3D(pN.lx, pN.ly, pN.lz).rotate(r);
    const dir0n = dir0.length > 0 ? dir0.norm() : null;
    const dirNn = dirN.length > 0 ? dirN.norm() : null;

    return {
      ports: [
        { name: portNames[0], pos: first, dir: dir0n, flow: 'input', type: portType },
        { name: portNames[1], pos: last, dir: dirNn, flow: 'output', type: portType },
      ],
      splineLength,
    };
  }
}

Builder.SNAP_BEHAVIOR = 'Position fixe.';

module.exports = Builder;
