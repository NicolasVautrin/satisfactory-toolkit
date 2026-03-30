const {
  ref, FlowPort, PortType, makeCustomizationData, makeRecipeProp, makeFluidBox,
  makeEntity, makePipeConnection, makeSnappedPassthroughs, makeSpline,
  nextId, findComp,
  Vector3D,
  projectOnSpline,
} = require('../../satisfactoryLib');
const Builder = require('../shared/Builder');

const TIERS = {
  1: {
    typePath: '/Game/FactoryGame/Buildable/Factory/Pipeline/Build_Pipeline.Build_Pipeline_C',
    recipe: '/Game/FactoryGame/Recipes/Buildings/Recipe_Pipeline.Recipe_Pipeline_C',
    prefix: 'Pipeline',
  },
  2: {
    typePath: '/Game/FactoryGame/Buildable/Factory/PipelineMk2/Build_PipelineMK2.Build_PipelineMK2_C',
    recipe: '/Game/FactoryGame/Recipes/Buildings/Recipe_PipelineMK2.Recipe_PipelineMK2_C',
    prefix: 'PipelineMK2',
  },
};

class Pipe extends Builder {
  constructor(entity, comp0, comp1) {
    super(entity, comp0, comp1);
    const spline = entity.properties?.mSplineData?.values;
    let offset0 = { x: 0, y: 0, z: 0 }, offset1 = { x: 0, y: 0, z: 0 };
    if (spline && spline.length >= 2) {
      const p0 = spline[0].value?.properties?.Location?.value;
      const pN = spline[spline.length - 1].value?.properties?.Location?.value;
      if (p0) offset0 = p0;
      if (pN) offset1 = pN;
    }

    const componentMap = { PipelineConnection0: comp0, PipelineConnection1: comp1 };
    const portDefs = {
      PipelineConnection0: { offset: offset0, dir: null, flow: 'input',  type: PortType.PIPE },
      PipelineConnection1: { offset: offset1, dir: null, flow: 'output', type: PortType.PIPE },
    };
    const ports = FlowPort.fromLayout(componentMap, entity.transform, portDefs);
    this._ports = ports;
    this._ports[Pipe.Ports.CONN0]._owner = this;
    this._ports[Pipe.Ports.CONN1]._owner = this;
    this.components = [comp0, comp1];
  }

  get tier() {
    for (const [t, info] of Object.entries(TIERS)) {
      if (this.entity.typePath === info.typePath) return parseInt(t);
    }
    return 2;
  }

  onPortSnapped() {
    const conn0 = this._ports[Pipe.Ports.CONN0];
    const conn1 = this._ports[Pipe.Ports.CONN1];
    const startPos = conn0.pos;
    const endPos = conn1.pos;
    this.entity.transform.translation = startPos;
    const dx = endPos.x - startPos.x;
    const dy = endPos.y - startPos.y;
    const dz = endPos.z - startPos.z;
    this.entity.properties.mSplineData = makeSpline(dx, dy, dz, conn0.dir, conn1.dir);
  }

  static create(from, to, tier = 2) {
    const tierInfo = TIERS[tier];
    if (!tierInfo) throw new Error(`Invalid pipe tier: ${tier}`);

    const id = nextId();
    const baseName = `Build_${tierInfo.prefix}_C_${id}`;
    const inst = `Persistent_Level:PersistentLevel.${baseName}`;

    const entity = makeEntity(tierInfo.typePath, inst);
    entity.transform = {
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      translation: from?.pos || to?.pos || new Vector3D(0, 0, 0),
      scale3d: { x: 1, y: 1, z: 1 },
    };

    const conn0Name = `${inst}.PipelineConnection0`;
    const conn1Name = `${inst}.PipelineConnection1`;
    entity.components = [ref(conn1Name), ref(conn0Name)];
    entity.properties = {
      mFluidBox: makeFluidBox(0),
      mSplineData: makeSpline(0, 0, 0),
      mSnappedPassthroughs: makeSnappedPassthroughs(),
      mCustomizationData: makeCustomizationData(),
      mBuiltWithRecipe: makeRecipeProp(tierInfo.recipe),
    };

    const comp0 = makePipeConnection(conn0Name, inst, null, null);
    const comp1 = makePipeConnection(conn1Name, inst, null, null);
    const pipe = new Pipe(entity, comp0, comp1);
    const pConn0 = pipe._ports[Pipe.Ports.CONN0];
    const pConn1 = pipe._ports[Pipe.Ports.CONN1];

    if (from?.pos) { pConn0.pos = from.pos; pConn0.dir = from.dir || null; }
    if (to?.pos) { pConn1.pos = to.pos; pConn1.dir = to.dir || null; }
    if (from?.pos && to?.pos) pipe.onPortSnapped();

    return pipe;
  }

  static fromSave(entity, saveObjects) {
    const inst = entity.instanceName;
    return new Pipe(entity,
      findComp(saveObjects, `${inst}.PipelineConnection0`),
      findComp(saveObjects, `${inst}.PipelineConnection1`),
    );
  }
}

Pipe.Ports = { CONN0: 'PipelineConnection0', CONN1: 'PipelineConnection1' };
Pipe.TIERS = TIERS;
Pipe.IS_SPLINE = true;
Pipe.SNAP_BEHAVIOR = 'Recalcule sa spline entre les deux endpoints après connexion.';

Pipe.getPorts = function(entity) {
  return Builder._splinePorts(entity, ['PipelineConnection0', 'PipelineConnection1'], 'pipe');
};

module.exports = Pipe;
