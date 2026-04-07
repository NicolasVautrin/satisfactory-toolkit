const Vector3D = require('./Vector3D');

const FlowType = { INPUT: 'input', OUTPUT: 'output' };
const PortType = { BELT: 'belt', PIPE: 'pipe', POWER: 'power', TRACK: 'track' };

class FlowPort {
  /**
   * @param {object} component  SaveComponent (or null for position-only)
   * @param {{x,y,z}} lPos     Local-space position (offset from entity origin)
   * @param {{x,y,z}|null} lDir Local-space direction
   */
  constructor(component, lPos, lDir) {
    this.pathName = component?.instanceName || null;
    this.component = component;
    this._pos = lPos;
    this._dir = lDir;
    this.flowType = null;
    this.portType = null;
    this._wiredTo = null;
    this._owner = null;       // Back-reference to parent Builder (provides portTransform)
    this._sibling = null;     // Other port of a support/pole (for auto-wire)
    this._snappedBy = [];     // Ports snapped here (array, tracks can have up to 3)
    this._snapPropName = null; // Custom property name to write on snap
    this._portName = null;
  }

  // ── Local accessors ──────────────────────────────────────────
  localPos() { return this._pos; }
  localDir() { return this._dir; }

  // ── World accessors (computed from owner's portTransform) ────
  worldPos() {
    const { translation, rotation } = this._owner.portTransform(this);
    return new Vector3D(this._pos).rotateZ(rotation).add(new Vector3D(translation));
  }

  worldDir() {
    if (!this._dir) return null;
    const { rotation } = this._owner.portTransform(this);
    return new Vector3D(this._dir).rotateZ(rotation);
  }

  // ── Convenience getters ──────────────────────────────────────
  get isInput() { return this.flowType === FlowType.INPUT; }
  get isOutput() { return this.flowType === FlowType.OUTPUT; }
  get isBelt() { return this.portType === PortType.BELT; }
  get isPipe() { return this.portType === PortType.PIPE; }
  get isPower() { return this.portType === PortType.POWER; }
  get isConnected() { return this._wiredTo !== null; }
  get isSupport() { return this._sibling !== null; }

  /**
   * Wire this port to another port (logical link only).
   * Delegates to the owning Builder's wirePorts method.
   */
  wire(other) {
    if (!this._owner) throw new Error(`Port ${this.pathName} has no owner builder`);
    this._owner.wirePorts(this, other);
  }

  /**
   * Snap this port onto an anchor port: the owning entity repositions
   * so this port aligns with the anchor's world position/direction.
   * Delegates to the owning Builder's snapPorts method.
   * @param {FlowPort} anchorPort  The fixed port to snap onto
   */
  snapTo(anchorPort) {
    if (!this._owner) throw new Error(`Port ${this.pathName} has no owner builder`);
    if (anchorPort._virtual) throw new Error('Cannot snapTo a virtual port — use snapToPos instead');
    this._owner.snapPorts(this, anchorPort);
  }

  /**
   * Snap this port to an anchor port's world position/direction.
   * The anchor can be a real port or a virtual port (FlowPort.virtual).
   * Uses face-to-face opposition (same as snapTo), but goes through the
   * positional snap path (no re-snap of already-positioned tracks).
   * @param {FlowPort} anchorPort  The anchor port (real or virtual)
   */
  snapToPos(anchorPort) {
    if (!this._owner) throw new Error(`Port ${this.pathName} has no owner builder`);
    this._owner.snapToPos(this, anchorPort.worldPos(), anchorPort.worldDir());
  }

  /**
   * Create a virtual port at a world position with a given outward direction.
   * Used for positional endpoints: represents the anchor port that a track port
   * snaps onto (face-to-face opposition). Virtual ports cannot be used as anchor
   * in snapTo — use snapToPos instead.
   * @param {{x,y,z}} pos  World position
   * @param {{x,y,z}} dir  Outward direction of the virtual port
   * @returns {FlowPort}
   */
  static virtual(pos, dir) {
    const port = new FlowPort(null, { x: 0, y: 0, z: 0 }, dir);
    port.portType = PortType.TRACK;
    port._portName = 'Virtual';
    port._virtual = true;
    // Override worldPos/worldDir to return world-space values directly
    port.worldPos = () => new Vector3D(pos);
    port.worldDir = () => dir ? new Vector3D(dir) : null;
    return port;
  }

  /**
   * Snap + wire: this port adapts to anchor's position and connects.
   * Delegates to the owning Builder's attachPorts method.
   * @param {FlowPort} anchorPort  The fixed port to attach to
   */
  attach(anchorPort) {
    if (!this._owner) throw new Error(`Port ${this.pathName} has no owner builder`);
    this._owner.attachPorts(this, anchorPort);
  }

  /**
   * Detach this port from its connected port (bidirectional).
   */
  detach() {
    if (this._wiredTo) {
      const other = this._wiredTo;
      if (other.component?.properties?.mConnectedComponent) {
        delete other.component.properties.mConnectedComponent;
      }
      other._wiredTo = null;
    }
    if (this.component?.properties?.mConnectedComponent) {
      delete this.component.properties.mConnectedComponent;
    }
    this._wiredTo = null;
  }

  /**
   * Build FlowPorts from a port layout definition.
   * Ports are stored in LOCAL space — use worldPos()/worldDir() for world coordinates.
   * @param {Object<string, SaveComponent>} componentMap  short-name → component
   * @param {Object<string, {offset:{x,y,z}, dir:{x,y,z}, flow:string, type:string}>} portDefs
   * @param {Builder} owner  The owning Builder (provides portTransform)
   * @returns {Object<string, FlowPort>}
   */
  static fromLayout(componentMap, portDefs, owner) {
    const ports = {};
    for (const [name, def] of Object.entries(portDefs)) {
      const port = new FlowPort(componentMap[name], def.offset, def.dir || null);
      port.flowType = def.flow === 'input' ? FlowType.INPUT : FlowType.OUTPUT;
      port.portType = def.type;
      port._portName = name;
      port._owner = owner;
      ports[name] = port;
    }
    return ports;
  }
}

FlowPort.FlowType = FlowType;
FlowPort.PortType = PortType;

module.exports = FlowPort;
