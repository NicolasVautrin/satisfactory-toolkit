const {
  ref, FlowPort, PortType, makeCustomizationData, makeRecipeProp,
  makeEntity, makeComponent, makePowerConnection, makeInventoryPotential,
  makePowerInfo, makeOutputInventory, nextId, findComp,
} = require('../../satisfactoryLib');

const TYPE_PATH = '/Game/FactoryGame/Buildable/Factory/FoundryMk1/Build_FoundryMk1.Build_FoundryMk1_C';
const RECIPE_BUILT = '/Game/FactoryGame/Recipes/Buildings/Recipe_FoundryMk1.Recipe_FoundryMk1_C';

const STACK_HEIGHT = 1000;

const FLAGS_POWER_CONN = 2097152;
const FLAGS_INVENTORY = 262152;
const FLAGS_POWER_INFO = 262152;
const FLAGS_CONVEYOR = 2097152;
const FLAGS_LEGS = 2097152;

const PORTS = {
  Input0:  { offset: { x:  200, y: -300, z: 100 }, dir: { x: 0, y: -1, z: 0 }, flow: 'input',  type: PortType.BELT },
  Input1:  { offset: { x: -200, y: -300, z: 100 }, dir: { x: 0, y: -1, z: 0 }, flow: 'input',  type: PortType.BELT },
  Output2: { offset: { x: -200, y:  200, z: 100 }, dir: { x: 0, y:  1, z: 0 }, flow: 'output', type: PortType.BELT },
};

class Foundry {
  constructor(entity, components) {
    this.entity = entity;
    this.inst = entity.instanceName;
    this.components = components;
    this._componentMap = {};
    for (const c of components) {
      const short = c.instanceName.split('.').pop();
      this._componentMap[short] = c;
    }
    this._ports = FlowPort.fromLayout(this._componentMap, entity.transform, PORTS);
    this._powerConnTarget = new FlowPort(this._componentMap['PowerConnection'], entity.transform.translation, null);
    this._powerConnTarget.portType = PortType.POWER;
  }

  get powerConn() { return this._powerConnTarget; }
  get ports() { return { ...this._ports, PowerConnection: this._powerConnTarget }; }

  port(name) {
    const p = this._ports[name];
    if (!p) throw new Error(`Foundry ${this.inst}: unknown port "${name}"`);
    return p;
  }

  setRecipe(recipePath) {
    this.entity.properties.mCurrentRecipe = {
      type: 'ObjectProperty', ueType: 'ObjectProperty',
      name: 'mCurrentRecipe', value: ref(recipePath, ''),
    };
  }

  allObjects() {
    return [this.entity, ...this.components];
  }

  static create(x, y, z, rotation = { x: 0, y: 0, z: 0, w: 1 }) {
    const id = nextId();
    const baseName = `Build_FoundryMk1_C_${id}`;
    const inst = `Persistent_Level:PersistentLevel.${baseName}`;

    const entity = makeEntity(TYPE_PATH, inst);
    entity.transform = { rotation, translation: { x, y, z }, scale3d: { x: 1, y: 1, z: 1 } };

    const names = {
      powerConn: `${inst}.PowerConnection`,
      invPotential: `${inst}.InventoryPotential`,
      powerInfo: `${inst}.powerInfo`,
      inputInv: `${inst}.InputInventory`,
      outputInv: `${inst}.OutputInventory`,
      input0: `${inst}.Input0`,
      input1: `${inst}.Input1`,
      output2: `${inst}.Output2`,
      legs: `${inst}.FGFactoryLegs`,
    };

    entity.components = Object.values(names).map(n => ref(n));

    entity.properties = {
      mInputInventory: { type: 'ObjectProperty', ueType: 'ObjectProperty', name: 'mInputInventory', value: ref(names.inputInv) },
      mOutputInventory: { type: 'ObjectProperty', ueType: 'ObjectProperty', name: 'mOutputInventory', value: ref(names.outputInv) },
      mPowerInfo: { type: 'ObjectProperty', ueType: 'ObjectProperty', name: 'mPowerInfo', value: ref(names.powerInfo) },
      mInventoryPotential: { type: 'ObjectProperty', ueType: 'ObjectProperty', name: 'mInventoryPotential', value: ref(names.invPotential) },
      mProductivityMonitorEnabled: { type: 'BoolProperty', ueType: 'BoolProperty', name: 'mProductivityMonitorEnabled', value: true },
      mCustomizationData: makeCustomizationData(),
      mBuiltWithRecipe: makeRecipeProp(RECIPE_BUILT),
    };

    const powerConn = makePowerConnection(names.powerConn, inst, []);
    powerConn.flags = FLAGS_POWER_CONN;

    const invPotential = makeInventoryPotential(names.invPotential, inst);
    invPotential.flags = FLAGS_INVENTORY;

    const powerInfo = makePowerInfo(names.powerInfo, inst, 16);
    powerInfo.flags = FLAGS_POWER_INFO;

    const inputInv = makeComponent('/Script/FactoryGame.FGInventoryComponent', names.inputInv, inst, FLAGS_INVENTORY);
    const outputInv = makeComponent('/Script/FactoryGame.FGInventoryComponent', names.outputInv, inst, FLAGS_INVENTORY);

    const makeConveyorConn = (name) =>
      makeComponent('/Script/FactoryGame.FGFactoryConnectionComponent', name, inst, FLAGS_CONVEYOR);

    const input0 = makeConveyorConn(names.input0);
    const input1 = makeConveyorConn(names.input1);
    const output2 = makeConveyorConn(names.output2);

    const legs = makeComponent('/Script/FactoryGame.FGFactoryLegsComponent', names.legs, inst, FLAGS_LEGS);

    const components = [powerConn, invPotential, powerInfo, inputInv, outputInv,
      input0, input1, output2, legs];

    return new Foundry(entity, components);
  }

  static createStack(x, y, z, count, rotation = { x: 0, y: 0, z: 0, w: 1 }) {
    const stack = [];
    for (let i = 0; i < count; i++) {
      stack.push(Foundry.create(x, y, z + i * STACK_HEIGHT, rotation));
    }
    return stack;
  }

  static fromSave(entity, saveObjects) {
    const inst = entity.instanceName;
    const compNames = ['PowerConnection', 'InventoryPotential', 'powerInfo',
      'InputInventory', 'OutputInventory', 'Input0', 'Input1', 'Output2', 'FGFactoryLegs'];
    const components = compNames.map(n => findComp(saveObjects, `${inst}.${n}`));
    return new Foundry(entity, components);
  }

  static fromBlueprint(entity, blueprintTransform) {
    const Transform = require('../shared/Transform');
    const worldTransform = blueprintTransform.apply(Transform.fromSave(entity.transform));
    const machine = Foundry.create(worldTransform.translation.x, worldTransform.translation.y, worldTransform.translation.z, worldTransform.rotation);
    const recipe = entity.properties?.mCurrentRecipe?.value?.pathName;
    if (recipe) machine.setRecipe(recipe);
    return machine;
  }
}

Foundry.TYPE_PATH = TYPE_PATH;
Foundry.STACK_HEIGHT = STACK_HEIGHT;
Foundry.Ports = { INPUT0: 'Input0', INPUT1: 'Input1', OUTPUT0: 'Output2' };
Foundry.PORT_LAYOUT = PORTS;

module.exports = Foundry;