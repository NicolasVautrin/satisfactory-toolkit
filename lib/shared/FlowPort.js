const FlowType = { INPUT: 'input', OUTPUT: 'output' };
const PortType = { BELT: 'belt', PIPE: 'pipe', POWER: 'power', TRACK: 'track' };

class FlowPort {
  /**
   * @param {object} component  SaveComponent (or null for position-only)
   * @param {{x,y,z}} pos      World-space position
   * @param {{x,y,z}|null} dir World-space direction
   */
  constructor(component, pos, dir) {
    this.pathName = component?.instanceName || null;
    this.component = component;
    this.pos = pos;
    this.dir = dir;
    this.flowType = null;
    this.portType = null;
    this._wiredTo = null;
    this._owner = null;       // Back-reference to parent (belt, pipe, lift...)
    this._sibling = null;     // Other port of a support/pole (for auto-wire)
    this._snappedTo = null;   // Port snapped here (support/pole only)
    this._snapPropName = null; // Custom property name to write on snap (e.g. 'mTopSnappedConnection')
    this._portName = null;
  }

  get isInput() { return this.flowType === FlowType.INPUT; }
  get isOutput() { return this.flowType === FlowType.OUTPUT; }
  get isBelt() { return this.portType === PortType.BELT; }
  get isPipe() { return this.portType === PortType.PIPE; }
  get isPower() { return this.portType === PortType.POWER; }
  get isConnected() { return this._wiredTo !== null; }
  get isSupport() { return this._sibling !== null; }

  /**
   * Wire this port to another port (logical link only).
   * Validates compatibility and sets mConnectedComponent on both sides.
   */
  wire(other) {
    // Lazy require to avoid circular dependency
    const { ref } = require('../../satisfactoryLib');
    // Validate compatibility
    if (this.portType && other.portType && this.portType !== other.portType) {
      throw new Error(`Incompatible port types: ${this.portType} and ${other.portType}`);
    }
    if (this.flowType && other.flowType && this.flowType === other.flowType) {
      throw new Error(`Incompatible connection: both ports are ${this.flowType}`);
    }
    if (this._wiredTo) {
      throw new Error(`Port already connected: ${this.pathName}`);
    }
    if (other._wiredTo) {
      throw new Error(`Port already connected: ${other.pathName}`);
    }
    // Set mConnectedComponent on both components
    if (this.component) {
      this.component.properties.mConnectedComponent = {
        type: 'ObjectProperty', ueType: 'ObjectProperty',
        name: 'mConnectedComponent', value: ref(other.pathName),
      };
    }
    if (other.component) {
      other.component.properties.mConnectedComponent = {
        type: 'ObjectProperty', ueType: 'ObjectProperty',
        name: 'mConnectedComponent', value: ref(this.pathName),
      };
    }
    this._wiredTo = other;
    other._wiredTo = this;
  }

  /**
   * Snap this port onto an anchor port: this adapts to anchor's position/direction.
   * Calls this._owner.onPortSnapped(this) so the owning entity can reposition.
   * @param {FlowPort} anchor  The fixed port to snap onto
   */
  snapTo(anchor) {
    if (anchor._snappedTo) {
      throw new Error(`Port already snapped: ${anchor.pathName}`);
    }
    if (this.portType && anchor.portType && this.portType !== anchor.portType) {
      throw new Error(`Incompatible port types: ${this.portType} and ${anchor.portType}`);
    }
    // If this port cannot be repositioned (no onPortSnapped owner),
    // check that ports are close enough to connect
    if (this.pos && anchor.pos && !this._owner?.onPortSnapped) {
      const dx = this.pos.x - anchor.pos.x;
      const dy = this.pos.y - anchor.pos.y;
      const dz = this.pos.z - anchor.pos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist > 1) {
        const fmt = p => `(${Math.round(p.x)}, ${Math.round(p.y)}, ${Math.round(p.z)})`;
        throw new Error(
          `Cannot snap: port positions must coincide but are ${Math.round(dist)}u apart. ` +
          `This port ${this._portName || '?'} at ${fmt(this.pos)}, ` +
          `anchor port ${anchor._portName || '?'} at ${fmt(anchor.pos)}. ` +
          `Position the entities so their ports overlap.`
        );
      }
    }
    this.pos = anchor.pos;
    this.dir = anchor.dir;
    anchor._snappedTo = this;
    if (anchor._snapPropName && anchor.component && this.pathName) {
      const { ref } = require('../../satisfactoryLib');
      anchor.component.properties[anchor._snapPropName] = {
        type:   'ObjectProperty',
        ueType: 'ObjectProperty',
        name:   anchor._snapPropName,
        value:  ref(this.pathName),
      };
    }
    if (this._owner?.onPortSnapped) this._owner.onPortSnapped(this);
  }

  /**
   * Snap + wire: this port adapts to anchor's position and connects.
   * For support/pole anchors: snap only + auto-wire when sibling is also snapped.
   * @param {FlowPort} anchor  The fixed port to attach to
   */
  attach(anchor) {
    if (anchor._sibling) {
      // Anchor is a support port: snap this onto it, auto-wire if sibling also snapped
      this.snapTo(anchor);
      if (anchor._sibling._snappedTo) {
        this.wire(anchor._sibling._snappedTo);
      }
    } else {
      // Machine/logistic port: snap first (validates distance), then wire
      this.snapTo(anchor);
      this.wire(anchor);
    }
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
   * Build FlowPorts from a unified port layout and a component map.
   * @param {Object<string, SaveComponent>} componentMap  short-name → component
   * @param {{translation:{x,y,z}, rotation:{x,y,z,w}}} transform  entity transform
   * @param {Object<string, {offset:{x,y,z}, dir:{x,y,z}, flow:string, type:string}>} portDefs
   * @returns {Object<string, FlowPort>}
   */
  static fromLayout(componentMap, transform, portDefs) {
    const Vector3D = require('./Vector3D');
    const { translation, rotation } = transform;
    const ports = {};
    for (const [name, def] of Object.entries(portDefs)) {
      const worldPos = new Vector3D(translation).add(new Vector3D(def.offset).rotateZ(rotation));
      const worldDir = def.dir ? new Vector3D(def.dir).rotateZ(rotation) : null;
      const port = new FlowPort(componentMap[name], worldPos, worldDir);
      port.flowType = def.flow === 'input' ? FlowType.INPUT : FlowType.OUTPUT;
      port.portType = def.type;
      port._portName = name;
      ports[name] = port;
    }
    return ports;
  }
}

FlowPort.FlowType = FlowType;
FlowPort.PortType = PortType;

module.exports = FlowPort;
