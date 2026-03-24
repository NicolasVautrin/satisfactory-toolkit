const {
  ref, FlowPort, PortType, makeCustomizationData, makeRecipeProp, makeFluidBox,
  makeEntity, makeComponent, makeInventoryPotential, makePowerInfo,
  nextId, TYPE_PATHS, RECIPES, COMP_FLAGS, findComp, PORT_TANGENT,
  Vector3D,
} = require('../../satisfactoryLib');

// Local directions for each junction port
const JUNCTION_DIRS = [
  { x: PORT_TANGENT, y: 0, z: 0 },
  { x: -PORT_TANGENT, y: 0, z: 0 },
  { x: 0, y: PORT_TANGENT, z: 0 },
  { x: 0, y: -PORT_TANGENT, z: 0 },
];

class PipeJunction {
  constructor(entity, connComps) {
    this.entity = entity;
    this.inst = entity.instanceName;
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

  port(name) {
    const p = this._ports[name];
    if (!p) throw new Error(`PipeJunction ${this.inst}: unknown port "${name}"`);
    return p;
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

module.exports = PipeJunction;
