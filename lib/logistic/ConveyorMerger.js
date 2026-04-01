const {
  ref, FlowPort, PortType, makeCustomizationData, makeRecipeProp,
  makeEntity, makeComponent, nextId, findComp,
  Vector3D, FlowType, projectOnSpline,
} = require('../../satisfactoryLib');
const Builder = require('../shared/Builder');
const snapAttachment = require('../shared/snapAttachment');

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

class ConveyorMerger extends Builder {
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
   * Reposition the merger after a port has been snapped.
   * Only allowed if no other port is already connected (merger is "virgin").
   */
  onPortSnapped(snappedPort, wPos, wDir) {
    snapAttachment(this, snappedPort, PORT_OFFSETS, PORT_DIRS, wPos, wDir);
  }

  /**
   * Insert this merger onto an existing belt, cutting it in two.
   * @param belt      ConveyorBelt instance to cut
   * @param position  {x,y,z} world position — projected onto belt spline
   * @returns belt2   The new belt after the merger
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

    // Position and orient the merger on the spline
    this.entity.transform.translation = proj.pos;
    this.entity.transform.rotation = proj.rotation;

    // Save original output info (world) and detach
    const wOrigOutputPos = output.worldPos();
    const wOrigOutputDir = output.worldDir();
    const origTarget = output._wiredTo;
    output.detach();

    // Truncate belt: output → merger.center input
    const mrgCenter = this.port('Input1');
    const wMrgCenterPos = mrgCenter.worldPos();
    const wMrgCenterDir = mrgCenter.worldDir();
    output.wire(mrgCenter);
    output._pos = wMrgCenterPos;
    output._dir = new Vector3D(wMrgCenterDir).scale(-1);
    belt.onPortSnapped();

    // Create belt2: merger.output → original output destination
    const mrgOutput = this.port('Output1');
    const wMrgOutputPos = mrgOutput.worldPos();
    const wMrgOutputDir = mrgOutput.worldDir();
    const belt2 = ConveyorBelt.create(null, null, belt.tier);
    const belt2Input = belt2._ports[ConveyorBelt.Ports.INPUT];
    const belt2Output = belt2._ports[ConveyorBelt.Ports.OUTPUT];
    belt2Input._pos = wMrgOutputPos;
    belt2Input._dir = wMrgOutputDir;
    belt2Output._pos = wOrigOutputPos;
    belt2Output._dir = wOrigOutputDir;
    belt2Input.wire(mrgOutput);
    if (origTarget) belt2Output.wire(origTarget);
    belt2.onPortSnapped();

    return belt2;
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

ConveyorMerger.SNAP_BEHAVIOR = 'Si vierge : se repositionne sur un endpoint belt/lift uniquement (pas sur producer, pole ou support). Centre recalculé depuis le port snappé (offset 100 UU). Après première connexion, devient fixe. Insertion au milieu d\'un belt via {from, on, position}. Pour connecter à un producer, utiliser belt:tier.';

module.exports = ConveyorMerger;
