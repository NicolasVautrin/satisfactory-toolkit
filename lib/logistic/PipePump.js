
const {
  ref, FlowPort, PortType, makeCustomizationData, makeRecipeProp, makeFluidBox,
  makeEntity, makePipeConnection, makePowerConnection,
  makeInventoryPotential, makePowerInfo,
  nextId, TYPE_PATHS, RECIPES, findComp, PORT_TANGENT,
  Vector3D,
} = require('../../satisfactoryLib');

class PipePump {
  constructor(entity, comp0, comp1, powerConnComp) {
    this.entity = entity;
    this.inst = entity.instanceName;
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

  port(name) {
    const p = this._ports[name];
    if (!p) throw new Error(`PipePump ${this.inst}: unknown port "${name}"`);
    return p;
  }

  attachPipe(pipeConn, side) {
    const port = this._ports[side];
    if (!port) throw new Error(`PipePump ${this.inst}: unknown port "${side}"`);
    port.attach(pipeConn);
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

module.exports = PipePump;
