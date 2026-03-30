
const {
  ref, FlowPort, PortType, makeCustomizationData, makeRecipeProp, makeFluidBox,
  makeEntity, makePipeConnection, makePowerConnection,
  makeInventoryPotential, makePowerInfo,
  nextId, TYPE_PATHS, RECIPES, findComp, PORT_TANGENT,
  Vector3D, projectOnSpline,
} = require('../../satisfactoryLib');
const Builder = require('../shared/Builder');

class PipePump extends Builder {
  constructor(entity, comp0, comp1, powerConnComp) {
    super(entity, comp0, comp1, powerConnComp);
    const { translation, rotation } = entity.transform;
    const pos = new Vector3D(translation);

    const inputPort = new FlowPort(comp0, pos, new Vector3D(-PORT_TANGENT, 0, 0).rotate(rotation));
    inputPort.portType = PortType.PIPE;
    const outputPort = new FlowPort(comp1, pos, new Vector3D(PORT_TANGENT, 0, 0).rotate(rotation));
    outputPort.portType = PortType.PIPE;
    const powerPort = new FlowPort(powerConnComp, pos, null);
    powerPort.portType = PortType.POWER;

    this._ports = {
      [PipePump.Ports.INPUT]: inputPort,
      [PipePump.Ports.OUTPUT]: outputPort,
      [PipePump.Ports.POWER]: powerPort,
    };
  }

  /**
   * Reposition the pump after a port has been snapped.
   * Only allowed if no other pipe port is already connected.
   */
  onPortSnapped(snappedPort) {
    for (const [name, p] of Object.entries(this._ports)) {
      if (p !== snappedPort && p !== this._ports[PipePump.Ports.POWER] && p.isConnected) {
        throw new Error(`Cannot reposition ${this.constructor.name}: port ${name} already connected`);
      }
    }
    // Pump ports are at entity center (offset 0,0,0) — just move the entity
    this.entity.transform.translation = { ...snappedPort.pos };
    // Rebuild port directions with current rotation
    const rotation = this.entity.transform.rotation;
    this._ports[PipePump.Ports.INPUT].pos = { ...snappedPort.pos };
    this._ports[PipePump.Ports.INPUT].dir = new Vector3D(-PORT_TANGENT, 0, 0).rotate(rotation);
    this._ports[PipePump.Ports.OUTPUT].pos = { ...snappedPort.pos };
    this._ports[PipePump.Ports.OUTPUT].dir = new Vector3D(PORT_TANGENT, 0, 0).rotate(rotation);
    this._ports[PipePump.Ports.POWER].pos = { ...snappedPort.pos };
  }

  /**
   * Insert this pump onto an existing pipe, cutting it in two.
   * The pump has an orientation: input (-X) → output (+X).
   * @param pipe      Pipe instance to cut
   * @param position  {x,y,z} world position — projected onto pipe spline
   * @param reverse   If true, reverse the pump direction (output faces conn0 side)
   * @returns pipe2   The new pipe after the pump
   */
  attachPipe(pipe, position, reverse = false) {
    // Guard: cannot insert if already connected (not virgin)
    for (const [name, p] of Object.entries(this._ports)) {
      if (p !== this._ports[PipePump.Ports.POWER] && p.isConnected) {
        throw new Error(`Cannot insert ${this.constructor.name}: port ${name} already connected`);
      }
    }
    const Pipe = require('./Pipe');
    const conn0 = pipe._ports[Pipe.Ports.CONN0];
    const conn1 = pipe._ports[Pipe.Ports.CONN1];
    const origin = pipe.entity.transform.translation;
    const spline = pipe.entity.properties.mSplineData.values;
    const proj = projectOnSpline(spline, origin, position);

    // Position and orient the pump on the spline
    this.entity.transform.translation = proj.pos;
    if (reverse) {
      // Rotate 180° around Z to flip direction
      const q = proj.rotation;
      this.entity.transform.rotation = {
        x: q.z * 0 + q.w * 0 + q.x * 0 - q.y * 0, // simplified: quat * (0,0,1,0)
        y: q.y, z: -q.w * q.z < 0 ? q.z : q.z, w: q.w,
      };
      // Actually, rotate 180° around up axis of the spline
      const Vector3D_ = Vector3D;
      const fwd = new Vector3D_(proj.tangent).norm();
      const up = new Vector3D_(0, 0, 1);
      let right = up.cross(fwd);
      if (right.length < 0.001) right = new Vector3D_(0, 1, 0);
      right = right.norm();
      const normal = fwd.cross(right);
      const { quatFromBasis } = require('../../satisfactoryLib');
      this.entity.transform.rotation = quatFromBasis(fwd.scale(-1), right.scale(-1), normal);
    } else {
      this.entity.transform.rotation = proj.rotation;
    }

    // Rebuild ports with new transform
    const rotation = this.entity.transform.rotation;
    const pos = new Vector3D(proj.pos);
    this._ports[PipePump.Ports.INPUT].pos = pos;
    this._ports[PipePump.Ports.INPUT].dir = new Vector3D(-PORT_TANGENT, 0, 0).rotate(rotation);
    this._ports[PipePump.Ports.OUTPUT].pos = pos;
    this._ports[PipePump.Ports.OUTPUT].dir = new Vector3D(PORT_TANGENT, 0, 0).rotate(rotation);
    this._ports[PipePump.Ports.POWER].pos = pos;

    // Save original conn1 info and detach
    const origConn1Pos = conn1.pos;
    const origConn1Dir = conn1.dir;
    const origTarget = conn1._wiredTo;
    conn1.detach();

    // Truncate pipe: conn1 → pump input
    const pumpInput = this._ports[PipePump.Ports.INPUT];
    conn1.attach(pumpInput);

    // Create pipe2: pump output → original conn1 destination
    const pumpOutput = this._ports[PipePump.Ports.OUTPUT];
    const pipe2 = Pipe.create(null, null, pipe.tier);
    const pipe2Conn0 = pipe2._ports[Pipe.Ports.CONN0];
    const pipe2Conn1 = pipe2._ports[Pipe.Ports.CONN1];
    pipe2Conn0.pos = pumpOutput.pos;
    pipe2Conn0.dir = pumpOutput.dir;
    pipe2Conn1.pos = origConn1Pos;
    pipe2Conn1.dir = origConn1Dir;
    pipe2Conn0.attach(pumpOutput);
    if (origTarget) pipe2Conn1.wire(origTarget);
    pipe2.onPortSnapped();

    return pipe2;
  }

  static create(x, y, z, rotation = { x: 0, y: 0, z: 0, w: 1 }) {
    const id = nextId();
    const baseName = `Build_PipelinePumpMk2_C_${id}`;
    const inst = `Persistent_Level:PersistentLevel.${baseName}`;

    const entity = makeEntity(TYPE_PATHS.pipelinePumpMK2, inst);
    entity.transform = { rotation, translation: { x, y, z }, scale3d: { x: 1, y: 1, z: 1 } };

    const conn0Name = `${inst}.Connection0`;
    const conn1Name = `${inst}.Connection1`;
    const invPotName = `${inst}.InventoryPotential`;
    const powerInfoName = `${inst}.powerInfo`;
    const powerInputName = `${inst}.PowerInput`;

    entity.components = [
      ref(conn0Name), ref(invPotName), ref(powerInfoName),
      ref(conn1Name), ref(powerInputName),
    ];
    entity.properties = {
      mFluidBox: makeFluidBox(0),
      mPowerInfo: { type: 'ObjectProperty', ueType: 'ObjectProperty', name: 'mPowerInfo', value: ref(powerInfoName) },
      mInventoryPotential: { type: 'ObjectProperty', ueType: 'ObjectProperty', name: 'mInventoryPotential', value: ref(invPotName) },
      mIsProducing: { type: 'BoolProperty', ueType: 'BoolProperty', name: 'mIsProducing', value: true },
      mCustomizationData: makeCustomizationData(),
      mBuiltWithRecipe: makeRecipeProp(RECIPES.pipelinePumpMK2),
    };

    const comp0 = makePipeConnection(conn0Name, inst, null, null);
    const comp1 = makePipeConnection(conn1Name, inst, null, null);
    const powerConnComp = makePowerConnection(powerInputName, inst, []);
    const wrapper = new PipePump(entity, comp0, comp1, powerConnComp);
    wrapper.components = [
      comp0, comp1, makeInventoryPotential(invPotName, inst),
      makePowerInfo(powerInfoName, inst, 8), powerConnComp,
    ];
    return wrapper;
  }

  static fromSave(entity, saveObjects) {
    const inst = entity.instanceName;
    return new PipePump(entity,
      findComp(saveObjects, `${inst}.Connection0`),
      findComp(saveObjects, `${inst}.Connection1`),
      findComp(saveObjects, `${inst}.PowerInput`),
    );
  }
}

PipePump.Ports = { INPUT: 'input', OUTPUT: 'output', POWER: 'power' };
PipePump.PORT_LAYOUT = {
  input:  { offset: { x: 0, y: 0, z: 0 }, dir: { x: -PORT_TANGENT, y: 0, z: 0 }, flow: 'input', type: PortType.PIPE },
  output: { offset: { x: 0, y: 0, z: 0 }, dir: { x: PORT_TANGENT, y: 0, z: 0 }, flow: 'output', type: PortType.PIPE },
};

module.exports = PipePump;
