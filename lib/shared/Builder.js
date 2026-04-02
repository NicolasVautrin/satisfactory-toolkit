const Vector3D = require('./Vector3D');
const Quaternion = require('./Quaternion');
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

  /**
   * Build _componentMap from components array and create ports from layout.
   * Common init for all producers/extractors.
   */
  _initPorts(components, portLayout) {
    this._componentMap = {};
    for (const c of components) {
      const short = c.instanceName.split('.').pop();
      this._componentMap[short] = c;
    }
    const FlowPort = require('./FlowPort');
    this._ports = FlowPort.fromLayout(this._componentMap, portLayout, this);
  }

  port(name) {
    const p = this._ports[name];
    if (!p) throw new Error(`${this.constructor.name} ${this.inst}: unknown port "${name}"`);
    // Lazy-set _owner so snap validation knows the owning Builder
    if (!p._owner) p._owner = this;
    return p;
  }

  /** World transform for a port. Override in subclasses (e.g. lift top port). */
  portTransform(port) { return this.entity.transform; }

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

  /**
   * Reposition this builder so that the snapped port aligns with the given
   * world-space anchor position/direction.  Only allowed on builders that
   * declare CAN_SNAP_SPLINE = true and have no other port already connected.
   */
  snapSpline(snappedPort, wPos, wDir) {
    if (!this.constructor.CAN_SNAP_SPLINE) {
      throw new Error(`${this.constructor.name} does not support snapSpline`);
    }
    const layout = this.constructor.PORT_LAYOUT;
    if (!layout) throw new Error(`${this.constructor.name} has no PORT_LAYOUT`);

    // Guard: cannot reposition if another port is already connected
    for (const [name, p] of Object.entries(this._ports)) {
      if (p !== snappedPort && p.isConnected) {
        throw new Error(`Cannot reposition ${this.constructor.name}: port ${name} already connected`);
      }
    }

    const portName = Object.entries(this._ports).find(([, p]) => p === snappedPort)?.[0];
    const portDef = layout[portName];
    if (!portDef) return;

    // Rotate entity so the port's local dir opposes the anchor's world dir
    const wOpposed = { x: -wDir.x, y: -wDir.y };
    const rotation = Quaternion.fromLocalToWorldZ(portDef.dir, wOpposed).toPlain();
    this.entity.transform.rotation = rotation;

    // Compute entity position: wPos - rotated local offset
    const wOffset = new Vector3D(portDef.offset).rotate(rotation);
    this.entity.transform.translation = {
      x: wPos.x - wOffset.x,
      y: wPos.y - wOffset.y,
      z: wPos.z - (wOffset.z || 0),
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

/**
 * Generate a wiki page object for this Builder.
 * Override in subclasses to add specific fields (e.g. polarization for lifts).
 * @param {object} opts  { alias, className, typePath, clearanceData }
 * @returns {object}  Wiki page JSON
 */
Builder.wikiPage = function(opts) {
  const { alias, className, typePath, clearanceData } = opts;
  const clearance = clearanceData?.[className]?.boxes || null;

  // Ports from PORT_LAYOUT or virtual
  let ports = null;
  let portsVirtual = false;
  if (this.PORT_LAYOUT) {
    ports = Object.entries(this.PORT_LAYOUT).map(([name, p]) => ({
      name, offset: p.offset, dir: p.dir, flow: p.flow, type: p.type,
    }));
  } else if (this.getPorts && this.getPorts !== Builder.getPorts) {
    portsVirtual = true;
  }

  const page = {
    alias, className, typePath, clearance,
    ports: portsVirtual ? 'virtual' : ports,
    snapBehavior: this.SNAP_BEHAVIOR || 'Position fixe.',
  };

  if (portsVirtual && this.Ports) {
    page.portNames = Object.values(this.Ports);
    page.portsDescription = 'Ports virtuels calculés depuis les données d\'instance (spline ou mTopTransform). Utiliser GET /api/game/entity/:index pour obtenir les positions world-space.';
  }

  // Spline length / lift height limits
  const splineLimits = require('../../data/splineLimits.json');
  const splineType = className.includes('ConveyorBelt') ? 'belt'
    : className.includes('Pipeline') || className === 'Build_Pipeline_C' ? 'pipe'
    : className.includes('RailroadTrack') ? 'track'
    : className.includes('ConveyorLift') ? 'lift' : null;
  if (splineType && splineLimits[splineType]) {
    const { min, max } = splineLimits[splineType];
    page.limits = { type: splineType, min, max, unit: 'UU' };
  }

  return page;
};

/**
 * Build a summary string for the wiki index.
 * @param {object} page  Wiki page object (from wikiPage)
 * @returns {string}
 */
Builder.wikiSummary = function(page) {
  const dims = page.clearance?.[0]
    ? `${Math.round(page.clearance[0].max.x - page.clearance[0].min.x)}x${Math.round(page.clearance[0].max.y - page.clearance[0].min.y)}x${Math.round(page.clearance[0].max.z - page.clearance[0].min.z)}`
    : '?';
  const portCounts = [];
  if (page.ports === 'virtual') {
    portCounts.push('virtual');
  } else if (page.ports) {
    const belts = page.ports.filter(p => p.type === 'belt').length;
    const pipes = page.ports.filter(p => p.type === 'pipe').length;
    const power = page.ports.filter(p => p.type === 'power').length;
    if (belts) portCounts.push(`${belts} belt`);
    if (pipes) portCounts.push(`${pipes} pipe`);
    if (power) portCounts.push(`${power} power`);
  }
  return portCounts.length > 0 ? `${portCounts.join(', ')} — ${dims}` : dims;
};

module.exports = Builder;
