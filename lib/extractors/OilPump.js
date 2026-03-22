const {
  ref, FlowPort, PortType, makeCustomizationData, makeRecipeProp,
  makeEntity, makeComponent, makePowerConnection, makeInventoryPotential,
  makePowerInfo, makePipeConnectionFactory, makeOutputInventory, nextId, findComp,
  PORT_TANGENT,
} = require('../../satisfactoryLib');

const TYPE_PATH = '/Game/FactoryGame/Buildable/Factory/OilPump/Build_OilPump.Build_OilPump_C';
const RECIPE_BUILT = '/Game/FactoryGame/Recipes/Buildings/Recipe_OilPump.Recipe_OilPump_C';

const FLAGS_POWER_CONN = 2097152;
const FLAGS_INVENTORY = 262152;
const FLAGS_POWER_INFO = 262152;
const FLAGS_PIPE = 2097152;
const FLAGS_LEGS = 2097152;

const PORTS = {
  FGPipeConnectionFactory: { offset: { x: 0, y: 760, z: 175 }, dir: { x: 0, y: PORT_TANGENT, z: 0 }, flow: 'output', type: PortType.PIPE },
  PowerInput:              { offset: { x: 0, y: 0, z: 0 },     dir: null,                            flow: 'output', type: PortType.POWER },
};

class OilPump {
  constructor(entity, pipeConn, powerConnComp) {
    this.entity = entity;
    this.inst = entity.instanceName;
    const componentMap = { FGPipeConnectionFactory: pipeConn, PowerInput: powerConnComp };
    this._ports = FlowPort.fromLayout(componentMap, entity.transform, PORTS);
  }

  port(name) {
    const p = this._ports[name];
    if (!p) throw new Error(`OilPump ${this.inst}: unknown port "${name}"`);
    return p;
  }

  allObjects() {
    return [this.entity, ...this.components];
  }

  static create(x, y, z, rotation = { x: 0, y: 0, z: 0, w: 1 }) {
    const id = nextId();
    const baseName = `Build_OilPump_C_${id}`;
    const inst = `Persistent_Level:PersistentLevel.${baseName}`;

    const entity = makeEntity(TYPE_PATH, inst);
    entity.transform = { rotation, translation: { x, y, z }, scale3d: { x: 1, y: 1, z: 1 } };

    const pipeConnName = `${inst}.FGPipeConnectionFactory`;
    const invPotName = `${inst}.InventoryPotential`;
    const powerInfoName = `${inst}.powerInfo`;
    const outputInvName = `${inst}.OutputInventory`;
    const powerConnName = `${inst}.PowerInput`;
    const legsName = `${inst}.FGFactoryLegs`;

    entity.components = [
      ref(pipeConnName), ref(invPotName), ref(powerInfoName),
      ref(outputInvName), ref(powerConnName), ref(legsName),
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
    const powerConnComp = makePowerConnection(powerConnName, inst, []);
    powerConnComp.flags = FLAGS_POWER_CONN;

    const wrapper = new OilPump(entity, pipeConn, powerConnComp);
    wrapper.components = [
      pipeConn, makeInventoryPotential(invPotName, inst),
      makePowerInfo(powerInfoName, inst, 40),
      makeOutputInventory(outputInvName, inst), powerConnComp,
      makeComponent('/Script/FactoryGame.FGFactoryLegsComponent', legsName, inst, FLAGS_LEGS),
    ];
    return wrapper;
  }

  static fromBlueprint(entity, blueprintTransform) {
    const Transform = require('../shared/Transform');
    const worldTransform = blueprintTransform.apply(Transform.fromSave(entity.transform));
    return OilPump.create(worldTransform.translation.x, worldTransform.translation.y, worldTransform.translation.z, worldTransform.rotation);
  }

  static fromSave(entity, saveObjects) {
    const inst = entity.instanceName;
    return new OilPump(entity,
      findComp(saveObjects, `${inst}.FGPipeConnectionFactory`),
      findComp(saveObjects, `${inst}.PowerInput`),
    );
  }
}

OilPump.TYPE_PATH = TYPE_PATH;
OilPump.Ports = { OUTPUT: 'FGPipeConnectionFactory', POWER: 'PowerInput' };

module.exports = OilPump;