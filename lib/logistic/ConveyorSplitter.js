const {
  ref, FlowPort, PortType, makeCustomizationData, makeRecipeProp,
  makeEntity, makeComponent, nextId, findComp,
  Vector3D, FlowType, projectOnSpline,
} = require('../../satisfactoryLib');
const Builder = require('../shared/Builder');
const snapAttachment = require('../shared/snapAttachment');

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

class ConveyorSplitter extends Builder {
  constructor(entity, components) {
    super(entity, components);
    this._componentMap = {};
    for (const c of components) {
      const short = c.instanceName.split('.').pop();
      this._componentMap[short] = c;
    }

    this._ports = {};
    for (const [name, offset] of Object.entries(PORT_OFFSETS)) {
      const port = new FlowPort(this._componentMap[name], offset, PORT_DIRS[name]);
      port.portType = PortType.BELT;
      port.flowType = name.startsWith('Input') ? FlowType.INPUT : FlowType.OUTPUT;
      port._owner = this;
      this._ports[name] = port;
    }
  }

  /**
   * Reposition the splitter after a port has been snapped.
   * Only allowed if no other port is already connected (splitter is "virgin").
   */
  onPortSnapped(snappedPort, wPos, wDir) {
    snapAttachment(this, snappedPort, PORT_OFFSETS, PORT_DIRS, wPos, wDir);
  }

  /**
   * Insert this splitter onto an existing belt, cutting it in two.
   * @param belt      ConveyorBelt instance to cut
   * @param position  {x,y,z} world position — projected onto belt spline
   * @returns belt2   The new belt after the splitter
   */
  attachBelt(belt, position) {
    // Guard: cannot insert if already connected (not virgin)
    for (const [name, p] of Object.entries(this._ports)) {
      if (p.isConnected) {
        throw new Error(`Cannot insert ${this.constructor.name}: port ${name} already connected`);
      }
    }
    const ConveyorBelt = require('./ConveyorBelt');
    const input = belt._ports[ConveyorBelt.Ports.INPUT];
    const output = belt._ports[ConveyorBelt.Ports.OUTPUT];
    const origin = belt.entity.transform.translation;
    const spline = belt.entity.properties.mSplineData.values;
    const proj = projectOnSpline(spline, origin, position);

    // Position and orient the splitter on the spline
    this.entity.transform.translation = proj.pos;
    this.entity.transform.rotation = proj.rotation;

    // Save original output info (world) and detach
    const wOrigOutputPos = output.worldPos();
    const wOrigOutputDir = output.worldDir();
    const origTarget = output._wiredTo;
    output.detach();

    // Truncate belt: output → splitter.input
    const splInput = this.port('Input1');
    const wSplInputPos = splInput.worldPos();
    const wSplInputDir = splInput.worldDir();
    output.wire(splInput);
    output._pos = wSplInputPos;
    output._dir = new Vector3D(wSplInputDir).scale(-1);
    belt.onPortSnapped();

    // Create belt2: splitter.center → original output destination
    const splCenter = this.port('Output1');
    const wSplCenterPos = splCenter.worldPos();
    const wSplCenterDir = splCenter.worldDir();
    const belt2 = ConveyorBelt.create(null, null, belt.tier);
    const belt2Input = belt2._ports[ConveyorBelt.Ports.INPUT];
    const belt2Output = belt2._ports[ConveyorBelt.Ports.OUTPUT];
    belt2Input._pos = wSplCenterPos;
    belt2Input._dir = wSplCenterDir;
    belt2Output._pos = wOrigOutputPos;
    belt2Output._dir = wOrigOutputDir;
    belt2Input.wire(splCenter);
    if (origTarget) belt2Output.wire(origTarget);
    belt2.onPortSnapped();

    return belt2;
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

ConveyorSplitter.SNAP_BEHAVIOR = 'Si vierge : se repositionne sur un endpoint belt/lift uniquement (pas sur producer, pole ou support). Centre recalculé depuis le port snappé (offset 100 UU). Après première connexion, devient fixe. Insertion au milieu d\'un belt via {from, on, position}. Pour connecter à un producer, utiliser belt:tier.';

module.exports = ConveyorSplitter;
