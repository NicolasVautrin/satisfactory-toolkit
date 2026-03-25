const {
  ref, FlowPort, PortType, makeCustomizationData, makeRecipeProp,
  makeEntity, makeComponent, nextId, findComp,
  Vector3D, FlowType,
} = require('../../satisfactoryLib');

const VARIANTS = {
  basic: {
    typePath: '/Game/FactoryGame/Buildable/Factory/CA_Merger/Build_ConveyorAttachmentMerger.Build_ConveyorAttachmentMerger_C',
    recipe: '/Game/FactoryGame/Recipes/Buildings/Recipe_ConveyorAttachmentMerger.Recipe_ConveyorAttachmentMerger_C',
    prefix: 'ConveyorAttachmentMerger',
  },
  priority: {
    typePath: '/Game/FactoryGame/Buildable/Factory/CA_MergerPriority/Build_ConveyorAttachmentMergerPriority.Build_ConveyorAttachmentMergerPriority_C',
    recipe: '/Game/FactoryGame/Recipes/Buildings/Recipe_ConveyorAttachmentMergerPriority.Recipe_ConveyorAttachmentMergerPriority_C',
    prefix: 'ConveyorAttachmentMergerPriority',
  },
};

const FLAGS_CONVEYOR = 2097152;
const FLAGS_INVENTORY = 262152;

// Port offsets and directions in local space
const PORT_OFFSETS = {
  Input1:  { x: -100, y: 0, z: 0 },
  Input2:  { x: 0, y:  100, z: 0 },
  Input3:  { x: 0, y: -100, z: 0 },
  Output1: { x:  100, y: 0, z: 0 },
};

const PORT_DIRS = {
  Input1:  { x: -1, y: 0, z: 0 },
  Input2:  { x:  0, y: 1, z: 0 },
  Input3:  { x:  0, y: -1, z: 0 },
  Output1: { x:  1, y: 0, z: 0 },
};

class ConveyorMerger {
  constructor(entity, components) {
    this.entity = entity;
    this.inst = entity.instanceName;
    this.components = components;
    this._componentMap = {};
    for (const c of components) {
      const short = c.instanceName.split('.').pop();
      this._componentMap[short] = c;
    }

    this._rebuildPorts();
  }

  _rebuildPorts() {
    const { translation, rotation } = this.entity.transform;
    this._ports = {};
    for (const [name, offset] of Object.entries(PORT_OFFSETS)) {
      const ct = new FlowPort(
        this._componentMap[name],
        new Vector3D(translation).add(new Vector3D(offset).rotate(rotation)),
        new Vector3D(PORT_DIRS[name]).rotate(rotation)
      );
      ct.portType = PortType.BELT;
      ct.flowType = name.startsWith('Input') ? FlowType.INPUT : FlowType.OUTPUT;
      this._ports[name] = ct;
    }
  }

  port(name) {
    const p = this._ports[name];
    if (!p) throw new Error(`ConveyorMerger ${this.inst}: unknown port "${name}"`);
    return p;
  }

  /**
   * Set input priorities (priority merger only).
   * @param priorities  Array of 3 ints (0 = normal, higher = higher priority)
   */
  setPriorities(priorities) {
    this.entity.properties.mInputPriorities = {
      type: 'Int32ArrayProperty', ueType: 'ArrayProperty',
      name: 'mInputPriorities', subtype: 'IntProperty',
      values: priorities,
    };
  }

  allObjects() {
    return [this.entity, ...this.components];
  }

  static create(x, y, z, rotation = { x: 0, y: 0, z: 0, w: 1 }, variant = 'basic') {
    const v = VARIANTS[variant];
    if (!v) throw new Error(`Invalid merger variant: ${variant}`);

    const id = nextId();
    const baseName = `Build_${v.prefix}_C_${id}`;
    const inst = `Persistent_Level:PersistentLevel.${baseName}`;

    const entity = makeEntity(v.typePath, inst);
    entity.transform = { rotation, translation: { x, y, z }, scale3d: { x: 1, y: 1, z: 1 } };

    const names = {
      input1: `${inst}.Input1`,
      input2: `${inst}.Input2`,
      input3: `${inst}.Input3`,
      output1: `${inst}.Output1`,
      storageInv: `${inst}.StorageInventory`,
    };

    entity.components = Object.values(names).map(n => ref(n));

    entity.properties = {
      mBufferInventory: { type: 'ObjectProperty', ueType: 'ObjectProperty', name: 'mBufferInventory', value: ref(names.storageInv) },
      mCustomizationData: makeCustomizationData(),
      mBuiltWithRecipe: makeRecipeProp(v.recipe),
    };

    const makeConvConn = (name) => makeComponent('/Script/FactoryGame.FGFactoryConnectionComponent', name, inst, FLAGS_CONVEYOR);
    const storageInv = makeComponent('/Script/FactoryGame.FGInventoryComponent', names.storageInv, inst, FLAGS_INVENTORY);

    const components = [
      makeConvConn(names.input1),
      makeConvConn(names.input2),
      makeConvConn(names.input3),
      makeConvConn(names.output1),
      storageInv,
    ];

    return new ConveyorMerger(entity, components);
  }

  static fromSave(entity, saveObjects) {
    const inst = entity.instanceName;
    const compNames = ['Input1', 'Input2', 'Input3', 'Output1', 'StorageInventory'];
    const components = compNames.map(n => findComp(saveObjects, `${inst}.${n}`));
    return new ConveyorMerger(entity, components);
  }

  static fromBlueprint(entity, blueprintTransform) {
    const Transform = require('../shared/Transform');
    const worldTransform = blueprintTransform.apply(Transform.fromSave(entity.transform));
    const variant = entity.typePath.includes('Priority') ? 'priority' : 'basic';
    return ConveyorMerger.create(worldTransform.translation.x, worldTransform.translation.y, worldTransform.translation.z, worldTransform.rotation, variant);
  }
}

ConveyorMerger.Ports = { CENTER: 'Input1', LEFT: 'Input2', RIGHT: 'Input3', OUTPUT: 'Output1' };
ConveyorMerger.PORT_LAYOUT = Object.fromEntries(
  Object.keys(PORT_OFFSETS).map(k => [k, {
    offset: PORT_OFFSETS[k], dir: PORT_DIRS[k],
    flow: k.startsWith('Input') ? 'input' : 'output', type: PortType.BELT,
  }])
);
ConveyorMerger.VARIANTS = VARIANTS;

module.exports = ConveyorMerger;
