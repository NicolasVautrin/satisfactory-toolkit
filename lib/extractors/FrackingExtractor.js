const {
  ref, FlowPort, PortType, makeCustomizationData, makeRecipeProp,
  makeEntity, makeComponent, makeInventoryPotential,
  makePowerInfo, makePipeConnectionFactory, makeOutputInventory, nextId, findComp,
  PORT_TANGENT,
} = require('../../satisfactoryLib');

const TYPE_PATH = '/Game/FactoryGame/Buildable/Factory/FrackingExtractor/Build_FrackingExtractor.Build_FrackingExtractor_C';
const RECIPE_BUILT = '/Game/FactoryGame/Recipes/Buildings/Recipe_FrackingExtractor.Recipe_FrackingExtractor_C';

const FLAGS_INVENTORY = 262152;
const FLAGS_POWER_INFO = 262152;
const FLAGS_PIPE = 2097152;

const PORTS = {
  FGPipeConnectionFactory: { offset: { x: 100, y: 0, z: 375 }, dir: { x: PORT_TANGENT, y: 0, z: 0 }, flow: 'output', type: PortType.PIPE },
};

class FrackingExtractor {
  constructor(entity, pipeConn) {
    this.entity = entity;
    this.inst = entity.instanceName;
    const componentMap = { FGPipeConnectionFactory: pipeConn };
    this._ports = FlowPort.fromLayout(componentMap, entity.transform, PORTS);
  }

  port(name) {
    const p = this._ports[name];
    if (!p) throw new Error(`FrackingExtractor ${this.inst}: unknown port "${name}"`);
    return p;
  }

  allObjects() {
    return [this.entity, ...this.components];
  }

  static create(x, y, z, rotation = { x: 0, y: 0, z: 0, w: 1 }) {
    const id = nextId();
    const baseName = `Build_FrackingExtractor_C_${id}`;
    const inst = `Persistent_Level:PersistentLevel.${baseName}`;

    const entity = makeEntity(TYPE_PATH, inst);
    entity.transform = { rotation, translation: { x, y, z }, scale3d: { x: 1, y: 1, z: 1 } };

    const pipeConnName = `${inst}.FGPipeConnectionFactory`;
    const invPotName = `${inst}.InventoryPotential`;
    const powerInfoName = `${inst}.powerInfo`;
    const outputInvName = `${inst}.OutputInventory`;

    entity.components = [
      ref(pipeConnName), ref(invPotName), ref(powerInfoName), ref(outputInvName),
    ];
    entity.properties = {
      mOutputInventory: { type: 'ObjectProperty', ueType: 'ObjectProperty', name: 'mOutputInventory', value: ref(outputInvName) },
      mPowerInfo: { type: 'ObjectProperty', ueType: 'ObjectProperty', name: 'mPowerInfo', value: ref(powerInfoName) },
      mInventoryPotential: { type: 'ObjectProperty', ueType: 'ObjectProperty', name: 'mInventoryPotential', value: ref(invPotName) },
      mProductivityMonitorEnabled: { type: 'BoolProperty', ueType: 'BoolProperty', name: 'mProductivityMonitorEnabled', value: true },
      mCustomizationData: makeCustomizationData(),
      mBuiltWithRecipe: makeRecipeProp(RECIPE_BUILT),
    };

    const pipeConn = makePipeConnectionFactory(pipeConnName, inst, null, null, outputInvName);
    pipeConn.flags = FLAGS_PIPE;

    const wrapper = new FrackingExtractor(entity, pipeConn);
    wrapper.components = [
      pipeConn, makeInventoryPotential(invPotName, inst),
      makePowerInfo(powerInfoName, inst, 0),
      makeOutputInventory(outputInvName, inst),
    ];
    return wrapper;
  }

  static fromBlueprint(entity, blueprintTransform) {
    const Transform = require('../shared/Transform');
    const worldTransform = blueprintTransform.apply(Transform.fromSave(entity.transform));
    return FrackingExtractor.create(worldTransform.translation.x, worldTransform.translation.y, worldTransform.translation.z, worldTransform.rotation);
  }

  static fromSave(entity, saveObjects) {
    const inst = entity.instanceName;
    return new FrackingExtractor(entity,
      findComp(saveObjects, `${inst}.FGPipeConnectionFactory`),
    );
  }
}

FrackingExtractor.TYPE_PATH = TYPE_PATH;
FrackingExtractor.Ports = { OUTPUT: 'FGPipeConnectionFactory' };

module.exports = FrackingExtractor;