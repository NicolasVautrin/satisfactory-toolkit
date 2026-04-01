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
    this._snappedTo = null;   // Port snapped here (support/pole only)
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
   * Validates compatibility and sets mConnectedComponent on both sides.
   */
  wire(other) {
    const { ref } = require('../../satisfactoryLib');
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
   * Snap this port onto an anchor port: the owning entity repositions
   * so this port aligns with the anchor's world position/direction.
   * @param {FlowPort} anchor  The fixed port to snap onto
   */
  snapTo(anchor) {
    if (anchor._snappedTo) {
      throw new Error(`Port already snapped: ${anchor.pathName}`);
    }
    if (this.portType && anchor.portType && this.portType !== anchor.portType) {
      throw new Error(`Incompatible port types: ${this.portType} and ${anchor.portType}`);
    }
    if (this._owner && !this._owner.onPortSnapped) {
      const ownerName = this._owner.constructor?.name || 'Entity';
      throw new Error(
        `Cannot snap: ${ownerName} has fixed ports and cannot reposition. ` +
        `Use a belt/pipe/lift to connect, or use attachBelt/attachPipe.`
      );
    }
    if (this._owner?.onPortSnapped && !this._owner.constructor.IS_SPLINE) {
      if (!anchor._owner?.constructor?.IS_SPLINE) {
        const ownerName = this._owner.constructor?.name || 'Entity';
        throw new Error(
          `Cannot snap ${ownerName} onto this port. ` +
          `Use a belt/pipe between them, or snap onto a belt/pipe/lift endpoint.`
        );
      }
    }

    // Compute anchor world pos/dir, then let the owner reposition
    const wPos = anchor.worldPos();
    const wDir = anchor.worldDir();
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
    if (this._owner?.onPortSnapped) this._owner.onPortSnapped(this, wPos, wDir);
  }

  /**
   * Snap + wire: this port adapts to anchor's position and connects.
   * For support/pole anchors: snap only + auto-wire when sibling is also snapped.
   * @param {FlowPort} anchor  The fixed port to attach to
   */
  attach(anchor) {
    if (anchor._sibling) {
      this.snapTo(anchor);
      if (anchor._sibling._snappedTo) {
        this.wire(anchor._sibling._snappedTo);
      }
    } else {
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
