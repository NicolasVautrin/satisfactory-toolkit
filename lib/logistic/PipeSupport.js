

const {
  ref, FlowPort, PortType, makeCustomizationData, makeRecipeProp,
  makeEntity, makeComponent, COMP_FLAGS,
  nextId, findComp, PORT_TANGENT, Vector3D,
} = require('../../satisfactoryLib');

// Pipe support snap point offset (measured: clamp is 375u above entity origin)
const SUPPORT_SNAP_OFFSET = { x: 0, y: 0, z: 375 };
// Pipe direction at support clamp (local space, magnitude 2)
const SUPPORT_SNAP_DIR = { x: PORT_TANGENT, y: 0, z: 0 };

const STACK_HEIGHT = 200;
const SUPPORT_TYPE = '/Game/FactoryGame/Buildable/Factory/PipelineSupport/Build_PipeSupportStackable.Build_PipeSupportStackable_C';
const SUPPORT_RECIPE = '/Game/FactoryGame/Recipes/Buildings/Recipe_PipeSupportStackable.Recipe_PipeSupportStackable_C';

class PipeSupport {
  constructor(entity, snapComp) {
    this.entity = entity;
    this.inst = entity.instanceName;
    this.components = snapComp ? [snapComp] : [];
    const { translation, rotation } = entity.transform;
    const snapPos = new Vector3D(translation).add(SUPPORT_SNAP_OFFSET);
    const dir = new Vector3D(SUPPORT_SNAP_DIR).rotate(rotation);
    const p0 = new FlowPort(snapComp, snapPos, dir);
    p0.portType = PortType.PIPE;
    const p1 = new FlowPort(snapComp, snapPos, dir.scale(-1));
    p1.portType = PortType.PIPE;
    this._ports = {
      [PipeSupport.Ports.SIDE0]: p0,
      [PipeSupport.Ports.SIDE1]: p1,
    };
    p0._sibling = p1;
    p1._sibling = p0;
  }

  port(name) {
    const p = this._ports[name];
    if (!p) throw new Error(`PipeSupport ${this.inst}: unknown port "${name}"`);
    return p;
  }

  static create(x, y, z, rotation = { x: 0, y: 0, z: 0, w: 1 }) {
    const id = nextId();
    const baseName = `Build_PipeSupportStackable_C_${id}`;
    const inst = `Persistent_Level:PersistentLevel.${baseName}`;

    const entity = makeEntity(SUPPORT_TYPE, inst);
    entity.transform = { rotation, translation: { x, y, z }, scale3d: { x: 1, y: 1, z: 1 } };

    const snapName = `${inst}.SnapOnly0`;
    entity.components = [ref(snapName)];
    entity.properties = {
      mCustomizationData: makeCustomizationData(),
      mBuiltWithRecipe: makeRecipeProp(SUPPORT_RECIPE),
    };

    const snap = makeComponent(
      '/Script/FactoryGame.FGPipeConnectionComponent',
      snapName, inst, COMP_FLAGS.pipeConnectionJunction
    );
    return new PipeSupport(entity, snap);
  }

  /**
   * Create a vertical stack of N pipe supports.
   * @returns Array of PipeSupport instances (bottom to top)
   */
  static createStack(x, y, z, count, rotation = { x: 0, y: 0, z: 0, w: 1 }) {
    const stack = [];
    for (let i = 0; i < count; i++) {
      stack.push(PipeSupport.create(x, y, z + i * STACK_HEIGHT, rotation));
    }
    return stack;
  }

  static fromSave(entity, saveObjects) {
    const inst = entity.instanceName;
    const snap = findComp(saveObjects, `${inst}.SnapOnly0`);
    return new PipeSupport(entity, snap);
  }

  allObjects() {
    return [this.entity, ...this.components];
  }
}

PipeSupport.Ports = { SIDE0: '0', SIDE1: '1' };
PipeSupport.SNAP_DIR = SUPPORT_SNAP_DIR;
PipeSupport.SNAP_OFFSET = SUPPORT_SNAP_OFFSET;
PipeSupport.STACK_HEIGHT = STACK_HEIGHT;

module.exports = PipeSupport;
