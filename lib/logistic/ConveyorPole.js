const {
  ref, FlowPort, PortType, makeCustomizationData, makeRecipeProp,
  makeEntity, makeComponent, nextId, findComp,
  Vector3D,
} = require('../../satisfactoryLib');

const TYPE_PATH = '/Game/FactoryGame/Buildable/Factory/ConveyorPoleStackable/Build_ConveyorPoleStackable.Build_ConveyorPoleStackable_C';
const RECIPE = '/Game/FactoryGame/Recipes/Buildings/Recipe_ConveyorPoleStackable.Recipe_ConveyorPoleStackable_C';
const STACK_HEIGHT = 200;
const FLAGS_SNAP = 2097152;

// Snap point: 300u above entity origin (measured: pole z=1461, belt z=1761 → +300)
const SNAP_OFFSET = { x: 0, y: 0, z: 300 };
const SNAP_DIR = { x: 1, y: 0, z: 0 };

class ConveyorPole {
  constructor(entity, snapComp) {
    this.entity = entity;
    this.inst = entity.instanceName;
    this.components = [snapComp];

    const { translation, rotation } = entity.transform;
    const snapPos = new Vector3D(translation).add(SNAP_OFFSET);
    const dir = new Vector3D(SNAP_DIR).rotate(rotation);
    const p0 = new FlowPort(snapComp, snapPos, dir);
    p0.portType = PortType.BELT;
    const p1 = new FlowPort(snapComp, snapPos, dir.scale(-1));
    p1.portType = PortType.BELT;
    this._ports = {
      [ConveyorPole.Ports.SIDE0]: p0,
      [ConveyorPole.Ports.SIDE1]: p1,
    };
    p0._sibling = p1;
    p1._sibling = p0;
  }

  port(name) {
    const p = this._ports[name];
    if (!p) throw new Error(`ConveyorPole ${this.inst}: unknown port "${name}"`);
    return p;
  }

  allObjects() {
    return [this.entity, ...this.components];
  }

  static create(x, y, z, rotation = { x: 0, y: 0, z: 0, w: 1 }) {
    const id = nextId();
    const baseName = `Build_ConveyorPoleStackable_C_${id}`;
    const inst = `Persistent_Level:PersistentLevel.${baseName}`;

    const entity = makeEntity(TYPE_PATH, inst);
    entity.transform = { rotation, translation: { x, y, z }, scale3d: { x: 1, y: 1, z: 1 } };

    const snapName = `${inst}.SnapOnly0`;
    entity.components = [ref(snapName)];

    entity.properties = {
      mCustomizationData: makeCustomizationData(),
      mBuiltWithRecipe: makeRecipeProp(RECIPE),
    };

    const snapComp = makeComponent('/Script/FactoryGame.FGFactoryConnectionComponent', snapName, inst, FLAGS_SNAP);

    return new ConveyorPole(entity, snapComp);
  }

  /**
   * Create a vertical stack of N poles.
   * @returns Array of ConveyorPole instances (bottom to top)
   */
  static createStack(x, y, z, count, rotation = { x: 0, y: 0, z: 0, w: 1 }) {
    const stack = [];
    for (let i = 0; i < count; i++) {
      stack.push(ConveyorPole.create(x, y, z + i * STACK_HEIGHT, rotation));
    }
    return stack;
  }

  static fromSave(entity, saveObjects) {
    const inst = entity.instanceName;
    return new ConveyorPole(entity, findComp(saveObjects, `${inst}.SnapOnly0`));
  }
}

ConveyorPole.Ports = { SIDE0: '0', SIDE1: '1' };
ConveyorPole.TYPE_PATH = TYPE_PATH;
ConveyorPole.STACK_HEIGHT = STACK_HEIGHT;
ConveyorPole.SNAP_OFFSET = SNAP_OFFSET;
ConveyorPole.SNAP_DIR = SNAP_DIR;

module.exports = ConveyorPole;
