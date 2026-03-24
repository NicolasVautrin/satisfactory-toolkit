const {
  ref, FlowPort, PortType, makeCustomizationData, makeRecipeProp,
  makeEntity, makeComponent, nextId, findComp,
  Vector3D, FlowType,
} = require('../../satisfactoryLib');

const VARIANTS = {
  basic: {
    typePath: '/Game/FactoryGame/Buildable/Factory/CA_Splitter/Build_ConveyorAttachmentSplitter.Build_ConveyorAttachmentSplitter_C',
    recipe: '/Game/FactoryGame/Recipes/Buildings/Recipe_ConveyorAttachmentSplitter.Recipe_ConveyorAttachmentSplitter_C',
    prefix: 'ConveyorAttachmentSplitter',
  },
  smart: {
    typePath: '/Game/FactoryGame/Buildable/Factory/CA_SplitterSmart/Build_ConveyorAttachmentSplitterSmart.Build_ConveyorAttachmentSplitterSmart_C',
    recipe: '/Game/FactoryGame/Recipes/Buildings/Recipe_ConveyorAttachmentSplitterSmart.Recipe_ConveyorAttachmentSplitterSmart_C',
    prefix: 'ConveyorAttachmentSplitterSmart',
  },
  programmable: {
    typePath: '/Game/FactoryGame/Buildable/Factory/CA_SplitterProgrammable/Build_ConveyorAttachmentSplitterProgrammable.Build_ConveyorAttachmentSplitterProgrammable_C',
    recipe: '/Game/FactoryGame/Recipes/Buildings/Recipe_ConveyorAttachmentSplitterProgrammable.Recipe_ConveyorAttachmentSplitterProgrammable_C',
    prefix: 'ConveyorAttachmentConveyorSplitterProgrammable',
  },
};

const FLAGS_CONVEYOR = 2097152;
const FLAGS_INVENTORY = 262152;

// Port offsets and directions in local space
const PORT_OFFSETS = {
  Input1:  { x: -100, y: 0, z: 0 },
  Output1: { x:  100, y: 0, z: 0 },
  Output2: { x: 0, y:  100, z: 0 },
  Output3: { x: 0, y: -100, z: 0 },
};

const PORT_DIRS = {
  Input1:  { x: -1, y:  0, z: 0 },
  Output1: { x:  1, y:  0, z: 0 },
  Output2: { x:  0, y:  1, z: 0 },
  Output3: { x:  0, y: -1, z: 0 },
};

class ConveyorSplitter {
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
    if (!p) throw new Error(`ConveyorSplitter ${this.inst}: unknown port "${name}"`);
    return p;
  }

  /**
   * Set sort rules (smart/programmable splitters).
   * @param rules  Array of { itemPath, outputIndex } — outputIndex 0-2 maps to Output1-3
   *               Special items: Desc_Wildcard (any), Desc_Overflow (overflow), Desc_None (none)
   */
  setSortRules(rules) {
    this.entity.properties.mSortRules = {
      type: 'StructArrayProperty', ueType: 'ArrayProperty',
      name: 'mSortRules',
      structValueFields: { allStructType: 'ConveyorSplitterSortRule' },
      subtype: 'StructProperty',
      values: rules.map(r => ({
        type: 'StructProperty', ueType: 'StructProperty',
        name: '', subtype: 'ConveyorSplitterSortRule',
        value: {
          type: 'ConveyorSplitterSortRule',
          properties: {
            ItemClass: {
              type: 'ObjectProperty', ueType: 'ObjectProperty',
              name: 'ItemClass', value: ref(r.itemPath, ''),
            },
            OutputIndex: {
              type: 'Int32Property', ueType: 'IntProperty',
              name: 'OutputIndex', value: r.outputIndex,
            },
          },
        },
      })),
    };
  }

  allObjects() {
    return [this.entity, ...this.components];
  }

  static create(x, y, z, rotation = { x: 0, y: 0, z: 0, w: 1 }, variant = 'basic') {
    const v = VARIANTS[variant];
    if (!v) throw new Error(`Invalid splitter variant: ${variant}`);

    const id = nextId();
    const baseName = `Build_${v.prefix}_C_${id}`;
    const inst = `Persistent_Level:PersistentLevel.${baseName}`;

    const entity = makeEntity(v.typePath, inst);
    entity.transform = { rotation, translation: { x, y, z }, scale3d: { x: 1, y: 1, z: 1 } };

    const names = {
      input1: `${inst}.Input1`,
      output1: `${inst}.Output1`,
      output2: `${inst}.Output2`,
      output3: `${inst}.Output3`,
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
      makeConvConn(names.output1),
      makeConvConn(names.output2),
      makeConvConn(names.output3),
      storageInv,
    ];

    return new ConveyorSplitter(entity, components);
  }

  static fromSave(entity, saveObjects) {
    const inst = entity.instanceName;
    const compNames = ['Input1', 'Output1', 'Output2', 'Output3', 'StorageInventory'];
    const components = compNames.map(n => findComp(saveObjects, `${inst}.${n}`));
    return new ConveyorSplitter(entity, components);
  }

  static fromBlueprint(entity, blueprintTransform) {
    const Transform = require('../shared/Transform');
    const worldTransform = blueprintTransform.apply(Transform.fromSave(entity.transform));
    const variant = entity.typePath.includes('Smart') ? 'smart'
      : entity.typePath.includes('Programmable') ? 'programmable' : 'basic';
    return ConveyorSplitter.create(worldTransform.translation.x, worldTransform.translation.y, worldTransform.translation.z, worldTransform.rotation, variant);
  }
}

ConveyorSplitter.Ports = { INPUT: 'Input1', CENTER: 'Output1', LEFT: 'Output2', RIGHT: 'Output3' };
ConveyorSplitter.PORT_LAYOUT = Object.fromEntries(
  Object.keys(PORT_OFFSETS).map(k => [k, {
    offset: PORT_OFFSETS[k], dir: PORT_DIRS[k],
    flow: k.startsWith('Input') ? 'input' : 'output', type: PortType.BELT,
  }])
);
ConveyorSplitter.VARIANTS = VARIANTS;

module.exports = ConveyorSplitter;
