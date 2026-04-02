
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

    const inputPort = new FlowPort(comp0, { x: 0, y: 0, z: 0 }, { x: -PORT_TANGENT, y: 0, z: 0 });
    inputPort.portType = PortType.PIPE;
    inputPort._owner = this;
    const outputPort = new FlowPort(comp1, { x: 0, y: 0, z: 0 }, { x: PORT_TANGENT, y: 0, z: 0 });
    outputPort.portType = PortType.PIPE;
    outputPort._owner = this;
    const powerPort = new FlowPort(powerConnComp, { x: 0, y: 0, z: 0 }, null);
    powerPort.portType = PortType.POWER;
    powerPort._owner = this;

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
  onPortSnapped(snappedPort, wPos, wDir) {
    this.snapSpline(snappedPort, wPos, wDir);
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

    // Save original conn1 info (world) and detach
    const wOrigConn1Pos = conn1.worldPos();
    const wOrigConn1Dir = conn1.worldDir();
    const origTarget = conn1._wiredTo;
    conn1.detach();

    // Truncate pipe: conn1 → pump input
    const pumpInput = this._ports[PipePump.Ports.INPUT];
    const wPumpInputPos = pumpInput.worldPos();
    const wPumpInputDir = pumpInput.worldDir();
    conn1._pos = wPumpInputPos;
    conn1._dir = wPumpInputDir;
    conn1.wire(pumpInput);
    pipe.onPortSnapped();

    // Create pipe2: pump output → original conn1 destination
    const pumpOutput = this._ports[PipePump.Ports.OUTPUT];
    const wPumpOutputPos = pumpOutput.worldPos();
    const wPumpOutputDir = pumpOutput.worldDir();
    const pipe2 = Pipe.create(null, null, pipe.tier);
    const pipe2Conn0 = pipe2._ports[Pipe.Ports.CONN0];
    const pipe2Conn1 = pipe2._ports[Pipe.Ports.CONN1];
    pipe2Conn0._pos = wPumpOutputPos;
    pipe2Conn0._dir = wPumpOutputDir;
    pipe2Conn1._pos = wOrigConn1Pos;
    pipe2Conn1._dir = wOrigConn1Dir;
    pipe2Conn0.wire(pumpOutput);
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

PipePump.CAN_SNAP_SPLINE = true;

PipePump.SNAP_BEHAVIOR = 'Si vierge : se repositionne sur un endpoint pipe uniquement (pas sur producer ou support). Ports au centre (offset 0). Après première connexion, devient fixe. Insertion au milieu d\'un pipe via {from, on, position} (option reverse pour inverser l\'orientation). Pour connecter à un producer, utiliser pipe:tier.';

module.exports = PipePump;
