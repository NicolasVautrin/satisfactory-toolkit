const {
  FlowPort, PortType, makeCustomizationData, makeRecipeProp,
  makeEntity, nextId, PORT_TANGENT,
} = require('../../satisfactoryLib');

const TYPE_PATH = '/Game/FactoryGame/Buildable/Factory/FoundationPassthrough/Build_FoundationPassthrough_Pipe.Build_FoundationPassthrough_Pipe_C';
const RECIPE = '/Game/FactoryGame/Buildable/Factory/FoundationPassthrough/Recipe_FoundationPassthrough_Pipe.Recipe_FoundationPassthrough_Pipe_C';

const PORTS = {
  top:    { offset: { x: 0, y: 0, z: 25 },  dir: { x: 0, y: 0, z: PORT_TANGENT },  flow: 'output', type: PortType.PIPE },
  bottom: { offset: { x: 0, y: 0, z: -25 }, dir: { x: 0, y: 0, z: -PORT_TANGENT }, flow: 'input',  type: PortType.PIPE },
};

class PipeHole {
  constructor(entity) {
    this.entity = entity;
    this.inst = entity.instanceName;

    const componentMap = { top: entity, bottom: entity };
    this._ports = FlowPort.fromLayout(componentMap, entity.transform, PORTS);
    this._ports.top._snapPropName = 'mTopSnappedConnection';
    this._ports.bottom._snapPropName = 'mBottomSnappedConnection';
    this._ports.top._sibling = this._ports.bottom;
    this._ports.bottom._sibling = this._ports.top;
  }

  port(name) {
    const p = this._ports[name];
    if (!p) throw new Error(`PipeHole ${this.inst}: unknown port "${name}"`);
    return p;
  }

  allObjects() {
    return [this.entity];
  }

  static create(x, y, z, rotation = { x: 0, y: 0, z: 0, w: 1 }, thickness = 100) {
    const id = nextId();
    const baseName = `Build_FoundationPassthrough_Pipe_C_${id}`;
    const inst = `Persistent_Level:PersistentLevel.${baseName}`;

    const entity = makeEntity(TYPE_PATH, inst);
    entity.transform = { rotation, translation: { x, y, z }, scale3d: { x: 1, y: 1, z: 1 } };
    entity.components = [];
    entity.properties = {
      mSnappedBuildingThickness: {
        type: 'FloatProperty', ueType: 'FloatProperty',
        name: 'mSnappedBuildingThickness', value: thickness,
      },
      mCustomizationData: makeCustomizationData(),
      mBuiltWithRecipe: makeRecipeProp(RECIPE),
    };
    entity.specialProperties = { type: 'EmptySpecialProperties' };

    return new PipeHole(entity);
  }

  static fromSave(entity) {
    return new PipeHole(entity);
  }
}

PipeHole.Ports = { TOP: 'top', BOTTOM: 'bottom' };

module.exports = PipeHole;
