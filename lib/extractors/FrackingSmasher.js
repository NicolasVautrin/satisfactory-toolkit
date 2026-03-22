const {
  ref, FlowPort, PortType, makeCustomizationData, makeRecipeProp,
  makeEntity, makeComponent, makePowerConnection, makeInventoryPotential,
  makePowerInfo, nextId, findComp,
} = require('../../satisfactoryLib');

const TYPE_PATH = '/Game/FactoryGame/Buildable/Factory/FrackingSmasher/Build_FrackingSmasher.Build_FrackingSmasher_C';
const RECIPE_BUILT = '/Game/FactoryGame/Recipes/Buildings/Recipe_FrackingSmasher.Recipe_FrackingSmasher_C';

const FLAGS_POWER_CONN = 2097152;
const FLAGS_INVENTORY = 262152;
const FLAGS_POWER_INFO = 262152;
const FLAGS_LEGS = 2097152;

class FrackingSmasher {
  constructor(entity, powerConnComp) {
    this.entity = entity;
    this.inst = entity.instanceName;
    const { translation } = entity.transform;
    const powerPort = new FlowPort(powerConnComp, translation, null);
    powerPort.portType = PortType.POWER;
    this._ports = { Power: powerPort };
  }

  port(name) {
    const p = this._ports[name];
    if (!p) throw new Error(`FrackingSmasher ${this.inst}: unknown port "${name}"`);
    return p;
  }

  setExtractableResource(levelName, pathName) {
    this.entity.properties.mExtractableResource = {
      type: 'ObjectProperty', ueType: 'ObjectProperty',
      name: 'mExtractableResource', value: { levelName, pathName },
    };
  }

  allObjects() {
    return [this.entity, ...this.components];
  }

  static create(x, y, z, rotation = { x: 0, y: 0, z: 0, w: 1 }) {
    const id = nextId();
    const baseName = `Build_FrackingSmasher_C_${id}`;
    const inst = `Persistent_Level:PersistentLevel.${baseName}`;

    const entity = makeEntity(TYPE_PATH, inst);
    entity.transform = { rotation, translation: { x, y, z }, scale3d: { x: 1, y: 1, z: 1 } };

    const powerConnName = `${inst}.FGPowerConnection1`;
    const invPotName = `${inst}.InventoryPotential`;
    const powerInfoName = `${inst}.powerInfo`;
    const legsName = `${inst}.FGFactoryLegs`;

    entity.components = [
      ref(powerConnName), ref(invPotName), ref(powerInfoName), ref(legsName),
    ];
    entity.properties = {
      mPowerInfo: { type: 'ObjectProperty', ueType: 'ObjectProperty', name: 'mPowerInfo', value: ref(powerInfoName) },
      mInventoryPotential: { type: 'ObjectProperty', ueType: 'ObjectProperty', name: 'mInventoryPotential', value: ref(invPotName) },
      mCustomizationData: makeCustomizationData(),
      mBuiltWithRecipe: makeRecipeProp(RECIPE_BUILT),
    };

    const powerConnComp = makePowerConnection(powerConnName, inst, []);
    powerConnComp.flags = FLAGS_POWER_CONN;

    const invPotential = makeInventoryPotential(invPotName, inst);
    invPotential.flags = FLAGS_INVENTORY;

    const powerInfo = makePowerInfo(powerInfoName, inst, 150);
    powerInfo.flags = FLAGS_POWER_INFO;

    const legs = makeComponent('/Script/FactoryGame.FGFactoryLegsComponent', legsName, inst, FLAGS_LEGS);

    const wrapper = new FrackingSmasher(entity, powerConnComp);
    wrapper.components = [powerConnComp, invPotential, powerInfo, legs];
    return wrapper;
  }

  static fromBlueprint(entity, blueprintTransform) {
    const Transform = require('../shared/Transform');
    const worldTransform = blueprintTransform.apply(Transform.fromSave(entity.transform));
    return FrackingSmasher.create(worldTransform.translation.x, worldTransform.translation.y, worldTransform.translation.z, worldTransform.rotation);
  }

  static fromSave(entity, saveObjects) {
    const inst = entity.instanceName;
    return new FrackingSmasher(entity,
      findComp(saveObjects, `${inst}.FGPowerConnection1`),
    );
  }
}

FrackingSmasher.TYPE_PATH = TYPE_PATH;
FrackingSmasher.Ports = { POWER: 'Power' };

module.exports = FrackingSmasher;