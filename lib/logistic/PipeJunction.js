const {
  ref, FlowPort, PortType, makeCustomizationData, makeRecipeProp, makeFluidBox,
  makeEntity, makeComponent, makeInventoryPotential, makePowerInfo,
  nextId, TYPE_PATHS, RECIPES, COMP_FLAGS, findComp, PORT_TANGENT,
  Vector3D, projectOnSpline,
} = require('../../satisfactoryLib');
const Builder = require('../shared/Builder');

// Local directions for each junction port
const JUNCTION_DIRS = [
  { x: PORT_TANGENT, y: 0, z: 0 },
  { x: -PORT_TANGENT, y: 0, z: 0 },
  { x: 0, y: PORT_TANGENT, z: 0 },
  { x: 0, y: -PORT_TANGENT, z: 0 },
];

class PipeJunction extends Builder {
  constructor(entity, connComps) {
    super(entity, connComps);
    this._connComps = connComps;
    const { translation, rotation } = entity.transform;
    const pos = new Vector3D(translation);
    this._ports = {};
    connComps.forEach((comp, i) => {
      const p = new FlowPort(comp, pos, new Vector3D(JUNCTION_DIRS[i]).rotate(rotation));
      p.portType = PortType.PIPE;
      this._ports[String(i)] = p;
    });
  }

  _rebuildPorts() {
    const { translation, rotation } = this.entity.transform;
    const pos = new Vector3D(translation);
    this._connComps.forEach((comp, i) => {
      const port = this._ports[String(i)];
      port.pos = pos;
      port.dir = new Vector3D(JUNCTION_DIRS[i]).rotate(rotation);
    });
  }

  /**
   * Reposition the junction after a port has been snapped.
   * Only allowed if no other port is already connected.
   */
  onPortSnapped(snappedPort) {
    for (const [name, p] of Object.entries(this._ports)) {
      if (p !== snappedPort && p.isConnected) {
        throw new Error(`Cannot reposition ${this.constructor.name}: port ${name} already connected`);
      }
    }
    // Junction ports are all at the entity center (offset 0,0,0) — just move the entity
    this.entity.transform.translation = { ...snappedPort.pos };
    this._rebuildPorts();
  }

  /**
   * Insert this junction onto an existing pipe, cutting it in two.
   * @param pipe      Pipe instance to cut
   * @param position  {x,y,z} world position — projected onto pipe spline
   * @returns pipe2   The new pipe after the junction
   */
  attachPipe(pipe, position) {
    // Guard: cannot insert if already connected (not virgin)
    for (const [name, p] of Object.entries(this._ports)) {
      if (p.isConnected) {
        throw new Error(`Cannot insert ${this.constructor.name}: port ${name} already connected`);
      }
    }
    const Pipe = require('./Pipe');
    const conn0 = pipe._ports[Pipe.Ports.CONN0];
    const conn1 = pipe._ports[Pipe.Ports.CONN1];
    const origin = pipe.entity.transform.translation;
    const spline = pipe.entity.properties.mSplineData.values;
    const proj = projectOnSpline(spline, origin, position);

    // Position and orient the junction on the spline
    this.entity.transform.translation = proj.pos;
    this.entity.transform.rotation = proj.rotation;
    this._rebuildPorts();

    // Save original conn1 info and detach
    const origConn1Pos = conn1.pos;
    const origConn1Dir = conn1.dir;
    const origTarget = conn1._wiredTo;
    conn1.detach();

    // Truncate pipe: conn1 → junction port 0 (+X direction, forward)
    conn1.attach(this.port('0'));

    // Create pipe2: junction port 1 (-X direction, backward) → original conn1 destination
    const jPort1 = this.port('1');
    const pipe2 = Pipe.create(null, null, pipe.tier);
    const pipe2Conn0 = pipe2._ports[Pipe.Ports.CONN0];
    const pipe2Conn1 = pipe2._ports[Pipe.Ports.CONN1];
    pipe2Conn0.pos = jPort1.pos;
    pipe2Conn0.dir = jPort1.dir;
    pipe2Conn1.pos = origConn1Pos;
    pipe2Conn1.dir = origConn1Dir;
    pipe2Conn0.attach(jPort1);
    if (origTarget) pipe2Conn1.wire(origTarget);
    pipe2.onPortSnapped();

    return pipe2;
  }

  static create(x, y, z, rotation = { x: 0, y: 0, z: 0, w: 1 }) {
    const id = nextId();
    const baseName = `Build_PipelineJunction_Cross_C_${id}`;
    const inst = `Persistent_Level:PersistentLevel.${baseName}`;

    const entity = makeEntity(TYPE_PATHS.junctionCross, inst);
    entity.transform = { rotation, translation: { x, y, z }, scale3d: { x: 1, y: 1, z: 1 } };

    const connNames = [0, 1, 2, 3].map(i => `${inst}.Connection${i}`);
    const invPotName = `${inst}.InventoryPotential`;
    const powerInfoName = `${inst}.powerInfo`;

    entity.components = [
      ref(connNames[0]), ref(invPotName), ref(powerInfoName),
      ref(connNames[3]), ref(connNames[1]), ref(connNames[2]),
    ];
    entity.properties = {
      mFluidBox: makeFluidBox(0),
      mPowerInfo: { type: 'ObjectProperty', ueType: 'ObjectProperty', name: 'mPowerInfo', value: ref(powerInfoName) },
      mTimeSinceStartStopProducing: { type: 'FloatProperty', ueType: 'FloatProperty', name: 'mTimeSinceStartStopProducing', value: 3.4e+38 },
      mInventoryPotential: { type: 'ObjectProperty', ueType: 'ObjectProperty', name: 'mInventoryPotential', value: ref('', '') },
      mCustomizationData: makeCustomizationData(),
      mBuiltWithRecipe: makeRecipeProp(RECIPES.junctionCross),
    };

    const connComps = connNames.map(name =>
      makeComponent('/Script/FactoryGame.FGPipeConnectionComponent', name, inst, COMP_FLAGS.pipeConnectionJunction)
    );
    const wrapper = new PipeJunction(entity, connComps);
    wrapper.components = [
      ...connComps,
      (() => { const c = makeInventoryPotential(invPotName, inst); c.flags = COMP_FLAGS.junctionInventory; return c; })(),
      (() => { const c = makePowerInfo(powerInfoName, inst, 0); c.flags = COMP_FLAGS.junctionPowerInfo; return c; })(),
    ];
    return wrapper;
  }

  static fromSave(entity, saveObjects) {
    const inst = entity.instanceName;
    const connComps = [0, 1, 2, 3].map(i =>
      findComp(saveObjects, `${inst}.Connection${i}`)
    );
    return new PipeJunction(entity, connComps);
  }
}

PipeJunction.Ports = { CONN0: '0', CONN1: '1', CONN2: '2', CONN3: '3' };
PipeJunction.PORT_LAYOUT = Object.fromEntries(
  JUNCTION_DIRS.map((dir, i) => [String(i), {
    offset: { x: 0, y: 0, z: 0 }, dir,
    flow: 'input', type: PortType.PIPE,
  }])
);

PipeJunction.SNAP_BEHAVIOR = 'Si vierge : se repositionne sur un endpoint pipe uniquement (pas sur producer ou support). Tous les ports au centre (offset 0). Après première connexion, devient fixe. Insertion au milieu d\'un pipe via {from, on, position}. Pour connecter à un producer, utiliser pipe:tier.';

module.exports = PipeJunction;
