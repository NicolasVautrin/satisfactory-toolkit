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

  // ── Snap / Wire / Attach (overridable by subclasses) ──────────────

  /**
   * Can this builder reposition srcPort when snapping onto anchorPort?
   * Default: false (producers, extractors). Override in subclasses.
   */
  isSnappable(srcPort, anchorPort) { return false; }

  /**
   * Snap srcPort onto anchorPort: reposition this builder so srcPort aligns
   * with anchorPort's world position/direction.
   * Base: portType check + isSnappable guard + _snappedBy bookkeeping + _snapPropName.
   * Override in subclasses for actual repositioning (call super first).
   */
  snapPorts(srcPort, anchorPort) {
    if (srcPort.portType && anchorPort.portType && srcPort.portType !== anchorPort.portType) {
      throw new Error(`Incompatible port types: ${srcPort.portType} and ${anchorPort.portType}`);
    }
    if (!this.isSnappable(srcPort, anchorPort)) {
      const ownerName = this.constructor?.name || 'Entity';
      throw new Error(
        `Cannot snap: ${ownerName} is not snappable onto this port. ` +
        `Use a belt/pipe/lift to connect.`
      );
    }
    anchorPort._snappedBy.push(srcPort);
    if (anchorPort._snapPropName && anchorPort.component && srcPort.pathName) {
      const { ref } = require('../../satisfactoryLib');
      anchorPort.component.properties[anchorPort._snapPropName] = {
        type:   'ObjectProperty',
        ueType: 'ObjectProperty',
        name:   anchorPort._snapPropName,
        value:  ref(srcPort.pathName),
      };
    }
    // Subclasses override snapPorts, call super for bookkeeping,
    // then do their own repositioning.
  }

  /**
   * Snap srcPort to a free world position (no anchor port).
   * Base: no-op. Override in spline subclasses.
   */
  snapToPos(srcPort, pos, dir) {
    // no-op by default
  }

  /**
   * Wire srcPort to anchorPort (logical connection only, no repositioning).
   * Base: portType + flowType checks + mConnectedComponent on both sides.
   * Override in RailroadTrack for mConnectedComponents array + guards.
   */
  wirePorts(srcPort, anchorPort) {
    const { ref } = require('../../satisfactoryLib');
    if (srcPort.portType && anchorPort.portType && srcPort.portType !== anchorPort.portType) {
      throw new Error(`Incompatible port types: ${srcPort.portType} and ${anchorPort.portType}`);
    }
    if (srcPort.flowType && anchorPort.flowType && srcPort.flowType === anchorPort.flowType) {
      throw new Error(`Incompatible connection: both ports are ${srcPort.flowType}`);
    }
    if (srcPort._wiredTo) {
      throw new Error(`Port already connected: ${srcPort.pathName}`);
    }
    if (anchorPort._wiredTo) {
      throw new Error(`Port already connected: ${anchorPort.pathName}`);
    }
    if (srcPort.component) {
      srcPort.component.properties.mConnectedComponent = {
        type: 'ObjectProperty', ueType: 'ObjectProperty',
        name: 'mConnectedComponent', value: ref(anchorPort.pathName),
      };
    }
    if (anchorPort.component) {
      anchorPort.component.properties.mConnectedComponent = {
        type: 'ObjectProperty', ueType: 'ObjectProperty',
        name: 'mConnectedComponent', value: ref(srcPort.pathName),
      };
    }
    srcPort._wiredTo = anchorPort;
    anchorPort._wiredTo = srcPort;
  }

  /**
   * Snap + wire: snap srcPort onto anchorPort, then wire them.
   * For support/pole anchors: snap only, auto-wire when sibling is also snapped.
   */
  attachPorts(srcPort, anchorPort) {
    if (anchorPort._sibling) {
      this.snapPorts(srcPort, anchorPort);
      const siblingSnap = anchorPort._sibling._snappedBy[0];
      if (siblingSnap) {
        this.wirePorts(srcPort, siblingSnap);
      }
    } else {
      this.snapPorts(srcPort, anchorPort);
      this.wirePorts(srcPort, anchorPort);
    }
  }


  /**
   * Connect a port on this builder to a port on another builder.
   * Override in subclasses that use a different connection mechanism (e.g. tracks).
   */
  connectPorts(myPortName, other, otherPortName) {
    this.attachPorts(this.port(myPortName), other.port(otherPortName));
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
