const {
  ref, FlowPort, makeCustomizationData, makeRecipeProp,
  makeEntity, makeComponent, makePowerConnection, makeInventoryPotential,
  makePowerInfo, makePipeConnectionFactory, makeOutputInventory, nextId, findComp,
  PortType,
} = require('../../satisfactoryLib');

const TYPE_PATH = '/Game/FactoryGame/Buildable/Factory/Converter/Build_Converter.Build_Converter_C';
const RECIPE_BUILT = '/Game/FactoryGame/Recipes/Buildings/Recipe_Converter.Recipe_Converter_C';

const STACK_HEIGHT = 1600;

const FLAGS_POWER_CONN = 2097152;
const FLAGS_INVENTORY = 262152;
const FLAGS_POWER_INFO = 262152;
const FLAGS_CONVEYOR = 2097152;
const FLAGS_PIPE = 2097152;
const FLAGS_LEGS = 2097152;

const PORTS = {
  Input0:  { offset: { x: -200, y: -680, z: 100 }, dir: { x: 0, y: -1, z: 0 }, flow: 'input',  type: PortType.BELT },
  Input1:  { offset: { x:  200, y: -680, z: 100 }, dir: { x: 0, y: -1, z: 0 }, flow: 'input',  type: PortType.BELT },
  Output0: { offset: { x:  200, y:  660, z: 100 }, dir: { x: 0, y:  1, z: 0 }, flow: 'output', type: PortType.BELT },
  // Component name is 'FGPipeConnectionFactory' (not descriptive)
  FGPipeConnectionFactory: { offset: { x: -200, y: 700, z: 175 }, dir: { x: 0, y: 1, z: 0 }, flow: 'output', type: PortType.PIPE },
};

class Converter {
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
    this._powerConnTarget = new FlowPort(this._componentMap['PowerInput'], entity.transform.translation, null);
    this._powerConnTarget.portType = PortType.POWER;
  }

  get powerConn() { return this._powerConnTarget; }
  get ports() { return { ...this._ports, PowerConnection: this._powerConnTarget }; }

  port(name) {
    const p = this._ports[name];
    if (!p) throw new Error(`Converter ${this.inst}: unknown port "${name}"`);
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
    const baseName = `Build_Converter_C_${id}`;
    const inst = `Persistent_Level:PersistentLevel.${baseName}`;

    const entity = makeEntity(TYPE_PATH, inst);
    entity.transform = { rotation, translation: { x, y, z }, scale3d: { x: 1, y: 1, z: 1 } };

    const names = {
      powerConn: `${inst}.PowerInput`,
      invPotential: `${inst}.InventoryPotential`,
      powerInfo: `${inst}.powerInfo`,
      inputInv: `${inst}.InputInventory`,
      outputInv: `${inst}.OutputInventory`,
      input0: `${inst}.Input0`,
      input1: `${inst}.Input1`,
      output0: `${inst}.Output0`,
      pipeConn: `${inst}.FGPipeConnectionFactory`,
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

    const powerInfo = makePowerInfo(names.powerInfo, inst, 400);
    powerInfo.flags = FLAGS_POWER_INFO;

    const inputInv = makeComponent('/Script/FactoryGame.FGInventoryComponent', names.inputInv, inst, FLAGS_INVENTORY);
    const outputInv = makeComponent('/Script/FactoryGame.FGInventoryComponent', names.outputInv, inst, FLAGS_INVENTORY);

    const makeConveyorConn = (name) =>
      makeComponent('/Script/FactoryGame.FGFactoryConnectionComponent', name, inst, FLAGS_CONVEYOR);

    const input0 = makeConveyorConn(names.input0);
    const input1 = makeConveyorConn(names.input1);
    const output0 = makeConveyorConn(names.output0);

    const pipeConn = makePipeConnectionFactory(names.pipeConn, inst, null, null, null);
    pipeConn.flags = FLAGS_PIPE;

    const legs = makeComponent('/Script/FactoryGame.FGFactoryLegsComponent', names.legs, inst, FLAGS_LEGS);

    const components = [powerConn, invPotential, powerInfo, inputInv, outputInv,
      input0, input1, output0, pipeConn, legs];

    return new Converter(entity, components);
  }

  static fromSave(entity, saveObjects) {
    const inst = entity.instanceName;
    const compNames = ['PowerInput', 'InventoryPotential', 'powerInfo',
      'InputInventory', 'OutputInventory', 'Input0', 'Input1', 'Output0',
      'FGPipeConnectionFactory', 'FGFactoryLegs'];
    const components = compNames.map(n => findComp(saveObjects, `${inst}.${n}`));
    return new Converter(entity, components);
  }

  static fromBlueprint(entity, blueprintTransform) {
    const Transform = require('../shared/Transform');
    const worldTransform = blueprintTransform.apply(Transform.fromSave(entity.transform));
    const machine = Converter.create(worldTransform.translation.x, worldTransform.translation.y, worldTransform.translation.z, worldTransform.rotation);
    const recipe = entity.properties?.mCurrentRecipe?.value?.pathName;
    if (recipe) machine.setRecipe(recipe);
    return machine;
  }
}

Converter.TYPE_PATH = TYPE_PATH;
Converter.STACK_HEIGHT = STACK_HEIGHT;
Converter.Ports = {
  INPUT0: 'Input0', INPUT1: 'Input1', OUTPUT0: 'Output0',
  PIPE_OUTPUT: 'FGPipeConnectionFactory',
};

module.exports = Converter;