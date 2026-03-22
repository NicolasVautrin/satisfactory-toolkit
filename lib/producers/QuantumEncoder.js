const {
  ref, FlowPort, makeCustomizationData, makeRecipeProp,
  makeEntity, makeComponent, makePowerConnection, makeInventoryPotential,
  makePowerInfo, makePipeConnectionFactory, makeOutputInventory, nextId, findComp,
  PortType,
} = require('../../satisfactoryLib');

const TYPE_PATH = '/Game/FactoryGame/Buildable/Factory/QuantumEncoder/Build_QuantumEncoder.Build_QuantumEncoder_C';
const RECIPE_BUILT = '/Game/FactoryGame/Recipes/Buildings/Recipe_QuantumEncoder.Recipe_QuantumEncoder_C';

const STACK_HEIGHT = 3200;

const FLAGS_POWER_CONN = 2097152;
const FLAGS_INVENTORY = 262152;
const FLAGS_POWER_INFO = 262152;
const FLAGS_CONVEYOR = 2097152;
const FLAGS_PIPE = 2097152;
const FLAGS_LEGS = 2097152;

const PORTS = {
  Input1:      { offset: { x:  200, y: -2460, z: 100 }, dir: { x: 0, y: -1, z: 0 }, flow: 'input',  type: PortType.BELT },
  Input2:      { offset: { x: -200, y: -2460, z: 100 }, dir: { x: 0, y: -1, z: 0 }, flow: 'input',  type: PortType.BELT },
  Input3:      { offset: { x: -600, y: -2400, z: 100 }, dir: { x: 0, y: -1, z: 0 }, flow: 'input',  type: PortType.BELT },
  Output0:     { offset: { x: -200, y:  2100, z: 100 }, dir: { x: 0, y:  1, z: 0 }, flow: 'output', type: PortType.BELT },
  PipeInput1:  { offset: { x:  600, y: -2090, z: 175 }, dir: { x: 0, y: -1, z: 0 }, flow: 'input',  type: PortType.PIPE },
  PipeOutput1: { offset: { x:  200, y:  2160, z: 175 }, dir: { x: 0, y:  1, z: 0 }, flow: 'output', type: PortType.PIPE },
};

class QuantumEncoder {
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
    if (!p) throw new Error(`QuantumEncoder ${this.inst}: unknown port "${name}"`);
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
    const baseName = `Build_QuantumEncoder_C_${id}`;
    const inst = `Persistent_Level:PersistentLevel.${baseName}`;

    const entity = makeEntity(TYPE_PATH, inst);
    entity.transform = { rotation, translation: { x, y, z }, scale3d: { x: 1, y: 1, z: 1 } };

    const names = {
      powerConn: `${inst}.PowerInput`,
      invPotential: `${inst}.InventoryPotential`,
      powerInfo: `${inst}.powerInfo`,
      inputInv: `${inst}.InputInventory`,
      outputInv: `${inst}.OutputInventory`,
      input1: `${inst}.Input1`,
      input2: `${inst}.Input2`,
      input3: `${inst}.Input3`,
      output0: `${inst}.Output0`,
      pipeIn1: `${inst}.PipeInput1`,
      pipeOut1: `${inst}.PipeOutput1`,
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

    const powerInfo = makePowerInfo(names.powerInfo, inst, 500);
    powerInfo.flags = FLAGS_POWER_INFO;

    const inputInv = makeComponent('/Script/FactoryGame.FGInventoryComponent', names.inputInv, inst, FLAGS_INVENTORY);
    const outputInv = makeComponent('/Script/FactoryGame.FGInventoryComponent', names.outputInv, inst, FLAGS_INVENTORY);

    const makeConveyorConn = (name) =>
      makeComponent('/Script/FactoryGame.FGFactoryConnectionComponent', name, inst, FLAGS_CONVEYOR);

    const input1 = makeConveyorConn(names.input1);
    const input2 = makeConveyorConn(names.input2);
    const input3 = makeConveyorConn(names.input3);
    const output0 = makeConveyorConn(names.output0);

    const pipeIn1 = makePipeConnectionFactory(names.pipeIn1, inst, null, null, null);
    pipeIn1.flags = FLAGS_PIPE;
    const pipeOut1 = makePipeConnectionFactory(names.pipeOut1, inst, null, null, null);
    pipeOut1.flags = FLAGS_PIPE;

    const legs = makeComponent('/Script/FactoryGame.FGFactoryLegsComponent', names.legs, inst, FLAGS_LEGS);

    const components = [powerConn, invPotential, powerInfo, inputInv, outputInv,
      input1, input2, input3, output0, pipeIn1, pipeOut1, legs];

    return new QuantumEncoder(entity, components);
  }

  static fromSave(entity, saveObjects) {
    const inst = entity.instanceName;
    const compNames = ['PowerInput', 'InventoryPotential', 'powerInfo',
      'InputInventory', 'OutputInventory', 'Input1', 'Input2', 'Input3', 'Output0',
      'PipeInput1', 'PipeOutput1', 'FGFactoryLegs'];
    const components = compNames.map(n => findComp(saveObjects, `${inst}.${n}`));
    return new QuantumEncoder(entity, components);
  }

  static fromBlueprint(entity, blueprintTransform) {
    const Transform = require('../shared/Transform');
    const worldTransform = blueprintTransform.apply(Transform.fromSave(entity.transform));
    const machine = QuantumEncoder.create(worldTransform.translation.x, worldTransform.translation.y, worldTransform.translation.z, worldTransform.rotation);
    const recipe = entity.properties?.mCurrentRecipe?.value?.pathName;
    if (recipe) machine.setRecipe(recipe);
    return machine;
  }
}

QuantumEncoder.TYPE_PATH = TYPE_PATH;
QuantumEncoder.STACK_HEIGHT = STACK_HEIGHT;
QuantumEncoder.Ports = {
  INPUT1: 'Input1', INPUT2: 'Input2', INPUT3: 'Input3', OUTPUT0: 'Output0',
  PIPE_INPUT: 'PipeInput1', PIPE_OUTPUT: 'PipeOutput1',
};

module.exports = QuantumEncoder;