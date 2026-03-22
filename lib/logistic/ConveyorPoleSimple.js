const {
  ref, FlowPort, PortType, makeCustomizationData, makeRecipeProp,
  makeEntity, makeComponent, nextId, findComp,
  Vector3D,
} = require('../../satisfactoryLib');

const TYPE_PATH = '/Game/FactoryGame/Buildable/Factory/ConveyorPole/Build_ConveyorPole.Build_ConveyorPole_C';
const RECIPE = '/Game/FactoryGame/Recipes/Buildings/Recipe_ConveyorPole.Recipe_ConveyorPole_C';
const FLAGS_SNAP = 2097152;

// Snap point is at entity origin (height is purely visual)
const SNAP_OFFSET = { x: 0, y: 0, z: 0 };
const SNAP_DIR = { x: 1, y: 0, z: 0 };

class ConveyorPoleSimple {
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
      [ConveyorPoleSimple.Ports.SIDE0]: p0,
      [ConveyorPoleSimple.Ports.SIDE1]: p1,
    };
    p0._sibling = p1;
    p1._sibling = p0;
  }

  port(name) {
    const p = this._ports[name];
    if (!p) throw new Error(`ConveyorPoleSimple ${this.inst}: unknown port "${name}"`);
    return p;
  }

  allObjects() {
    return [this.entity, ...this.components];
  }

  static create(x, y, z, rotation = { x: 0, y: 0, z: 0, w: 1 }) {
    const id = nextId();
    const baseName = `Build_ConveyorPole_C_${id}`;
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

    return new ConveyorPoleSimple(entity, snapComp);
  }

  static fromSave(entity, saveObjects) {
    const inst = entity.instanceName;
    return new ConveyorPoleSimple(entity, findComp(saveObjects, `${inst}.SnapOnly0`));
  }
}

ConveyorPoleSimple.Ports = { SIDE0: '0', SIDE1: '1' };
ConveyorPoleSimple.TYPE_PATH = TYPE_PATH;
ConveyorPoleSimple.SNAP_OFFSET = SNAP_OFFSET;
ConveyorPoleSimple.SNAP_DIR = SNAP_DIR;

module.exports = ConveyorPoleSimple;
