const {
  ref, FlowPort, PortType, makeCustomizationData, makeRecipeProp,
  makeEntity, makeComponent, makePowerConnection, makeInventoryPotential,
  makePowerInfo, makeOutputInventory, nextId, findComp,
} = require('../../satisfactoryLib');

const TIERS = {
  1: {
    typePath: '/Game/FactoryGame/Buildable/Factory/MinerMK1/Build_MinerMk1.Build_MinerMk1_C',
    recipe: '/Game/FactoryGame/Recipes/Buildings/Recipe_MinerMk1.Recipe_MinerMk1_C',
    power: 5,
  },
  2: {
    typePath: '/Game/FactoryGame/Buildable/Factory/MinerMk2/Build_MinerMk2.Build_MinerMk2_C',
    recipe: '/Game/FactoryGame/Recipes/Buildings/Recipe_MinerMk2.Recipe_MinerMk2_C',
    power: 12,
  },
  3: {
    typePath: '/Game/FactoryGame/Buildable/Factory/MinerMk3/Build_MinerMk3.Build_MinerMk3_C',
    recipe: '/Game/FactoryGame/Recipes/Buildings/Recipe_MinerMk3.Recipe_MinerMk3_C',
    power: 30,
  },
};

const FLAGS_POWER_CONN = 2097152;
const FLAGS_INVENTORY = 262152;
const FLAGS_POWER_INFO = 262152;
const FLAGS_CONVEYOR = 2097152;
const FLAGS_LEGS = 2097152;

const PORTS = {
  Output0: { offset: { x: 0, y: 800, z: 100 }, dir: { x: 0, y: 1, z: 0 }, flow: 'output', type: PortType.BELT },
};

class Miner {
  constructor(entity, components, tier) {
    this.entity = entity;
    this.inst = entity.instanceName;
    this.tier = tier;
    this.components = components;
    this._componentMap = {};
    for (const c of components) {
      const short = c.instanceName.split('.').pop();
      this._componentMap[short] = c;
    }
    this._ports = FlowPort.fromLayout(this._componentMap, entity.transform, PORTS);
    this._powerConnTarget = new FlowPort(this._componentMap['PowerInput'], entity.transform.translation, null);
    this._powerConnTarget.portType = PortType.POWER;
  }

  get powerConn() { return this._powerConnTarget; }
  get ports() { return { ...this._ports, PowerConnection: this._powerConnTarget }; }

  port(name) {
    const p = this._ports[name];
    if (!p) throw new Error(`Miner ${this.inst}: unknown port "${name}"`);
    return p;
  }

  allObjects() {
    return [this.entity, ...this.components];
  }

  static create(x, y, z, tier = 3, rotation = { x: 0, y: 0, z: 0, w: 1 }) {
    const tierInfo = TIERS[tier];
    if (!tierInfo) throw new Error(`Miner: invalid tier ${tier}`);
    const id = nextId();
    const baseName = `Build_MinerMk${tier}_C_${id}`;
    const inst = `Persistent_Level:PersistentLevel.${baseName}`;

    const entity = makeEntity(tierInfo.typePath, inst);
    entity.transform = { rotation, translation: { x, y, z }, scale3d: { x: 1, y: 1, z: 1 } };

    const names = {
      powerConn: `${inst}.PowerInput`,
      invPotential: `${inst}.InventoryPotential`,
      powerInfo: `${inst}.powerInfo`,
      outputInv: `${inst}.OutputInventory`,
      output0: `${inst}.Output0`,
      legs: `${inst}.FGFactoryLegs`,
    };

    entity.components = Object.values(names).map(n => ref(n));

    entity.properties = {
      mOutputInventory: { type: 'ObjectProperty', ueType: 'ObjectProperty', name: 'mOutputInventory', value: ref(names.outputInv) },
      mPowerInfo: { type: 'ObjectProperty', ueType: 'ObjectProperty', name: 'mPowerInfo', value: ref(names.powerInfo) },
      mInventoryPotential: { type: 'ObjectProperty', ueType: 'ObjectProperty', name: 'mInventoryPotential', value: ref(names.invPotential) },
      mProductivityMonitorEnabled: { type: 'BoolProperty', ueType: 'BoolProperty', name: 'mProductivityMonitorEnabled', value: true },
      mCustomizationData: makeCustomizationData(),
      mBuiltWithRecipe: makeRecipeProp(tierInfo.recipe),
    };

    const powerConn = makePowerConnection(names.powerConn, inst, []);
    powerConn.flags = FLAGS_POWER_CONN;

    const invPotential = makeInventoryPotential(names.invPotential, inst);
    invPotential.flags = FLAGS_INVENTORY;

    const powerInfo = makePowerInfo(names.powerInfo, inst, tierInfo.power);
    powerInfo.flags = FLAGS_POWER_INFO;

    const outputInv = makeComponent('/Script/FactoryGame.FGInventoryComponent', names.outputInv, inst, FLAGS_INVENTORY);

    const output0 = makeComponent('/Script/FactoryGame.FGFactoryConnectionComponent', names.output0, inst, FLAGS_CONVEYOR);

    const legs = makeComponent('/Script/FactoryGame.FGFactoryLegsComponent', names.legs, inst, FLAGS_LEGS);

    const components = [powerConn, invPotential, powerInfo, outputInv, output0, legs];

    return new Miner(entity, components, tier);
  }

  static fromSave(entity, saveObjects) {
    const inst = entity.instanceName;
    const tier = entity.typePath.includes('Mk1') ? 1 : entity.typePath.includes('Mk2') ? 2 : 3;
    const compNames = ['PowerInput', 'InventoryPotential', 'powerInfo',
      'OutputInventory', 'Output0', 'FGFactoryLegs'];
    const components = compNames.map(n => findComp(saveObjects, `${inst}.${n}`));
    return new Miner(entity, components, tier);
  }

  static fromBlueprint(entity, blueprintTransform) {
    const Transform = require('../shared/Transform');
    const worldTransform = blueprintTransform.apply(Transform.fromSave(entity.transform));
    const tier = entity.typePath.includes('Mk1') ? 1 : entity.typePath.includes('Mk2') ? 2 : 3;
    return Miner.create(worldTransform.translation.x, worldTransform.translation.y, worldTransform.translation.z, tier, worldTransform.rotation);
  }
}

Miner.TIERS = TIERS;
Miner.Ports = { OUTPUT0: 'Output0' };
Miner.PORT_LAYOUT = PORTS;

module.exports = Miner;