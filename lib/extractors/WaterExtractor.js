const {
  ref, FlowPort, PortType, makeCustomizationData, makeRecipeProp,
  makeEntity, makePipeConnectionFactory, makePowerConnection,
  makeInventoryPotential, makePowerInfo, makeOutputInventory,
  nextId, TYPE_PATHS, RECIPES, findComp, PORT_TANGENT,
} = require('../../satisfactoryLib');

const PORTS = {
  FGPipeConnectionFactory: { offset: { x: 0, y: -460, z: 240 }, dir: { x: 0, y: -PORT_TANGENT, z: 0 }, flow: 'output', type: PortType.PIPE },
  PowerConnection:         { offset: { x: 0, y: 0, z: 0 },      dir: null,                             flow: 'output', type: PortType.POWER },
};

class WaterExtractor {
  constructor(entity, pipeConn, powerConnComp) {
    this.entity = entity;
    this.inst = entity.instanceName;
    const componentMap = { FGPipeConnectionFactory: pipeConn, PowerConnection: powerConnComp };
    this._ports = FlowPort.fromLayout(componentMap, entity.transform, PORTS);
  }

  port(name) {
    const p = this._ports[name];
    if (!p) throw new Error(`WaterExtractor ${this.inst}: unknown port "${name}"`);
    return p;
  }

  static create(x, y, z, rotation = { x: 0, y: 0, z: 0, w: 1 }) {
    const id = nextId();
    const baseName = `Build_WaterPump_C_${id}`;
    const inst = `Persistent_Level:PersistentLevel.${baseName}`;

    const entity = makeEntity(TYPE_PATHS.waterPump, inst);
    entity.transform = { rotation, translation: { x, y, z }, scale3d: { x: 1, y: 1, z: 1 } };

    const pipeConnName = `${inst}.FGPipeConnectionFactory`;
    const invPotName = `${inst}.InventoryPotential`;
    const powerInfoName = `${inst}.powerInfo`;
    const outputInvName = `${inst}.OutputInventory`;
    const powerConnName = `${inst}.PowerConnection`;

    entity.components = [
      ref(pipeConnName), ref(invPotName), ref(powerInfoName),
      ref(outputInvName), ref(powerConnName),
    ];
    entity.properties = {
      mOutputInventory: { type: 'ObjectProperty', ueType: 'ObjectProperty', name: 'mOutputInventory', value: ref(outputInvName) },
      mPowerInfo: { type: 'ObjectProperty', ueType: 'ObjectProperty', name: 'mPowerInfo', value: ref(powerInfoName) },
      mInventoryPotential: { type: 'ObjectProperty', ueType: 'ObjectProperty', name: 'mInventoryPotential', value: ref(invPotName) },
      mProductivityMonitorEnabled: { type: 'BoolProperty', ueType: 'BoolProperty', name: 'mProductivityMonitorEnabled', value: true },
      mCustomizationData: makeCustomizationData(),
      mBuiltWithRecipe: makeRecipeProp(RECIPES.waterPump),
    };

    const pipeConn = makePipeConnectionFactory(pipeConnName, inst, null, null, outputInvName);
    const powerConnComp = makePowerConnection(powerConnName, inst, []);
    const wrapper = new WaterExtractor(entity, pipeConn, powerConnComp);
    wrapper.components = [
      pipeConn, makeInventoryPotential(invPotName, inst),
      makePowerInfo(powerInfoName, inst, 0.1),
      makeOutputInventory(outputInvName, inst), powerConnComp,
    ];
    return wrapper;
  }

  static fromBlueprint(entity, blueprintTransform) {
    const Transform = require('../shared/Transform');
    const worldTransform = blueprintTransform.apply(Transform.fromSave(entity.transform));
    return WaterExtractor.create(worldTransform.translation.x, worldTransform.translation.y, worldTransform.translation.z, worldTransform.rotation);
  }

  static fromSave(entity, saveObjects) {
    const inst = entity.instanceName;
    return new WaterExtractor(entity,
      findComp(saveObjects, `${inst}.FGPipeConnectionFactory`),
      findComp(saveObjects, `${inst}.PowerConnection`),
    );
  }
}

WaterExtractor.Ports = { OUTPUT: 'FGPipeConnectionFactory', POWER: 'PowerConnection' };

module.exports = WaterExtractor;