const {
  ref, FlowPort, PortType, makeCustomizationData, makeRecipeProp,
  makeEntity, makeComponent, COMP_FLAGS,
  nextId, findComp, PORT_TANGENT, Vector3D,
} = require('../../satisfactoryLib');

const TYPE_PATH = '/Game/FactoryGame/Buildable/Factory/PipelineSupport/Build_PipelineSupport.Build_PipelineSupport_C';
const RECIPE = '/Game/FactoryGame/Recipes/Buildings/Recipe_PipelineSupport.Recipe_PipelineSupport_C';

// Default height (variable in game, stored as mHeight property)
const DEFAULT_HEIGHT = 175;
// Pipe direction at clamp (local space, magnitude = PORT_TANGENT)
const SNAP_DIR = { x: PORT_TANGENT, y: 0, z: 0 };

class PipeSupportSimple {
  constructor(entity, snapComp) {
    this.entity = entity;
    this.inst = entity.instanceName;
    this.components = snapComp ? [snapComp] : [];

    const { translation, rotation } = entity.transform;
    const height = entity.properties?.mHeight?.value ?? DEFAULT_HEIGHT;
    const snapPos = new Vector3D(translation.x, translation.y, translation.z + height);
    const dir = new Vector3D(SNAP_DIR).rotate(rotation);
    const p0 = new FlowPort(snapComp, snapPos, dir);
    p0.portType = PortType.PIPE;
    const p1 = new FlowPort(snapComp, snapPos, dir.scale(-1));
    p1.portType = PortType.PIPE;
    this._ports = {
      [PipeSupportSimple.Ports.SIDE0]: p0,
      [PipeSupportSimple.Ports.SIDE1]: p1,
    };
    p0._sibling = p1;
    p1._sibling = p0;
  }

  port(name) {
    const p = this._ports[name];
    if (!p) throw new Error(`PipeSupportSimple ${this.inst}: unknown port "${name}"`);
    return p;
  }

  allObjects() {
    return [this.entity, ...this.components];
  }

  static create(x, y, z, height = DEFAULT_HEIGHT, rotation = { x: 0, y: 0, z: 0, w: 1 }) {
    const id = nextId();
    const baseName = `Build_PipelineSupport_C_${id}`;
    const inst = `Persistent_Level:PersistentLevel.${baseName}`;

    const entity = makeEntity(TYPE_PATH, inst);
    entity.transform = { rotation, translation: { x, y, z }, scale3d: { x: 1, y: 1, z: 1 } };

    const snapName = `${inst}.SnapOnly0`;
    entity.components = [ref(snapName)];
    entity.properties = {
      mHeight: { type: 'FloatProperty', ueType: 'FloatProperty', name: 'mHeight', value: height },
      mCustomizationData: makeCustomizationData(),
      mBuiltWithRecipe: makeRecipeProp(RECIPE),
    };

    const snap = makeComponent(
      '/Script/FactoryGame.FGPipeConnectionComponent',
      snapName, inst, COMP_FLAGS.pipeConnectionJunction
    );
    return new PipeSupportSimple(entity, snap);
  }

  static fromSave(entity, saveObjects) {
    const inst = entity.instanceName;
    const snap = findComp(saveObjects, `${inst}.SnapOnly0`);
    return new PipeSupportSimple(entity, snap);
  }
}

PipeSupportSimple.Ports = { SIDE0: '0', SIDE1: '1' };
PipeSupportSimple.TYPE_PATH = TYPE_PATH;
PipeSupportSimple.SNAP_DIR = SNAP_DIR;
PipeSupportSimple.DEFAULT_HEIGHT = DEFAULT_HEIGHT;

module.exports = PipeSupportSimple;
