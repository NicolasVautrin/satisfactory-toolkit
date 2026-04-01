const {
  ref, FlowPort, PortType, makeCustomizationData, makeRecipeProp,
  makeEntity, makeComponent, makeSpline,
  nextId, findComp,
  Vector3D,
  projectOnSpline,
} = require('../../satisfactoryLib');
const Builder = require('../shared/Builder');

const TIERS = {
  1: {
    typePath: '/Game/FactoryGame/Buildable/Factory/ConveyorBeltMk1/Build_ConveyorBeltMk1.Build_ConveyorBeltMk1_C',
    recipe: '/Game/FactoryGame/Recipes/Buildings/Recipe_ConveyorBeltMk1.Recipe_ConveyorBeltMk1_C',
  },
  2: {
    typePath: '/Game/FactoryGame/Buildable/Factory/ConveyorBeltMk2/Build_ConveyorBeltMk2.Build_ConveyorBeltMk2_C',
    recipe: '/Game/FactoryGame/Recipes/Buildings/Recipe_ConveyorBeltMk2.Recipe_ConveyorBeltMk2_C',
  },
  3: {
    typePath: '/Game/FactoryGame/Buildable/Factory/ConveyorBeltMk3/Build_ConveyorBeltMk3.Build_ConveyorBeltMk3_C',
    recipe: '/Game/FactoryGame/Recipes/Buildings/Recipe_ConveyorBeltMk3.Recipe_ConveyorBeltMk3_C',
  },
  4: {
    typePath: '/Game/FactoryGame/Buildable/Factory/ConveyorBeltMk4/Build_ConveyorBeltMk4.Build_ConveyorBeltMk4_C',
    recipe: '/Game/FactoryGame/Recipes/Buildings/Recipe_ConveyorBeltMk4.Recipe_ConveyorBeltMk4_C',
  },
  5: {
    typePath: '/Game/FactoryGame/Buildable/Factory/ConveyorBeltMk5/Build_ConveyorBeltMk5.Build_ConveyorBeltMk5_C',
    recipe: '/Game/FactoryGame/Recipes/Buildings/Recipe_ConveyorBeltMk5.Recipe_ConveyorBeltMk5_C',
  },
  6: {
    typePath: '/Game/FactoryGame/Buildable/Factory/ConveyorBeltMk6/Build_ConveyorBeltMk6.Build_ConveyorBeltMk6_C',
    recipe: '/Game/FactoryGame/Recipes/Buildings/Recipe_ConveyorBeltMk6.Recipe_ConveyorBeltMk6_C',
  },
};

const FLAGS_CONVEYOR_CONN = 262152;

class ConveyorBelt extends Builder {
  /**
   * @param entity    SaveEntity for the belt
   * @param comp0     ConveyorAny0 component (start / output side)
   * @param comp1     ConveyorAny1 component (end / input side)
   */
  constructor(entity, comp0, comp1) {
    super(entity, comp0, comp1);

    // Reconstruct endpoint offsets from spline data
    const spline = entity.properties?.mSplineData?.values;
    let offset0 = { x: 0, y: 0, z: 0 }, offset1 = { x: 0, y: 0, z: 0 };
    if (spline && spline.length >= 2) {
      const p0 = spline[0].value?.properties?.Location?.value;
      const pN = spline[spline.length - 1].value?.properties?.Location?.value;
      if (p0) offset0 = p0;
      if (pN) offset1 = pN;
    }

    // Extract tangent directions from spline
    let dir0 = null, dir1 = null;
    if (spline && spline.length >= 2) {
      const sp0 = spline[0].value?.properties;
      const spN = spline[spline.length - 1].value?.properties;
      if (sp0?.LeaveTangent?.value) dir0 = sp0.LeaveTangent.value;
      if (spN?.LeaveTangent?.value) dir1 = spN.LeaveTangent.value;
    }

    const componentMap = { ConveyorAny0: comp0, ConveyorAny1: comp1 };
    const portDefs = {
      ConveyorAny0: { offset: offset0, dir: dir0, flow: 'input',  type: PortType.BELT },
      ConveyorAny1: { offset: offset1, dir: dir1, flow: 'output', type: PortType.BELT },
    };
    this._ports = FlowPort.fromLayout(componentMap, portDefs, this);
    this.components = [comp0, comp1];
  }

  /**
   * Rebuild the belt spline.
   * When called with args (from snapTo): one port moved to wPos, other stays.
   * When called without args (from attachBelt): _pos/_dir are world-space, set by caller.
   */
  onPortSnapped(snappedPort, wPos, wDir) {
    const input = this._ports[ConveyorBelt.Ports.INPUT];
    const output = this._ports[ConveyorBelt.Ports.OUTPUT];

    let wInputPos, wInputDir, wOutputPos, wOutputDir;
    if (!snappedPort) {
      // No-args: _pos/_dir are world-space (set by caller)
      wInputPos = input._pos;
      wInputDir = input._dir;
      wOutputPos = output._pos;
      wOutputDir = output._dir;
    } else if (snappedPort === input) {
      wInputPos = wPos;
      wInputDir = input.worldDir();
      wOutputPos = output.worldPos();
      wOutputDir = output.worldDir();
    } else {
      wOutputPos = wPos;
      wOutputDir = output.worldDir();
      wInputPos = input.worldPos();
      wInputDir = input.worldDir();
    }

    this.entity.transform.translation = { ...wInputPos };
    this.entity.transform.rotation = { x: 0, y: 0, z: 0, w: 1 };
    const dx = wOutputPos.x - wInputPos.x;
    const dy = wOutputPos.y - wInputPos.y;
    const dz = (wOutputPos.z || 0) - (wInputPos.z || 0);
    this.entity.properties.mSplineData = makeSpline(dx, dy, dz, wInputDir, wOutputDir);

    // Update ports to local space (identity rotation)
    input._pos = { x: 0, y: 0, z: 0 };
    input._dir = wInputDir;
    output._pos = { x: dx, y: dy, z: dz };
    output._dir = wOutputDir;
  }

  /**
   * Create a new ConveyorBelt.
   * @param from  ConnTarget for belt start (ConveyorAny0) — or null
   * @param to    ConnTarget for belt end (ConveyorAny1) — or null
   * @param tier  Belt tier 1-6 (default 6)
   */
  static create(from, to, tier = 6) {
    const tierInfo = TIERS[tier];
    if (!tierInfo) throw new Error(`Invalid belt tier: ${tier}`);

    const id = nextId();
    const mkName = `ConveyorBeltMk${tier}`;
    const baseName = `Build_${mkName}_C_${id}`;
    const inst = `Persistent_Level:PersistentLevel.${baseName}`;

    const entity = makeEntity(tierInfo.typePath, inst);
    const origin = from?.pos || to?.pos || new Vector3D(0, 0, 0);
    entity.transform = {
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      translation: { ...origin },
      scale3d: { x: 1, y: 1, z: 1 },
    };

    const conn0Name = `${inst}.ConveyorAny0`;
    const conn1Name = `${inst}.ConveyorAny1`;
    entity.components = [ref(conn1Name), ref(conn0Name)];

    entity.properties = {
      mSplineData: makeSpline(0, 0, 0),
      mCustomizationData: makeCustomizationData(),
      mBuiltWithRecipe: makeRecipeProp(tierInfo.recipe),
    };
    entity.specialProperties = { type: 'ConveyorSpecialProperties' };

    const comp0 = makeComponent('/Script/FactoryGame.FGFactoryConnectionComponent', conn0Name, inst, FLAGS_CONVEYOR_CONN);
    const comp1 = makeComponent('/Script/FactoryGame.FGFactoryConnectionComponent', conn1Name, inst, FLAGS_CONVEYOR_CONN);

    const belt = new ConveyorBelt(entity, comp0, comp1);
    const input = belt._ports[ConveyorBelt.Ports.INPUT];
    const output = belt._ports[ConveyorBelt.Ports.OUTPUT];

    if (from?.pos) { input._pos = from.pos; input._dir = from.dir || null; }
    if (to?.pos) { output._pos = to.pos; output._dir = to.dir || null; }
    if (from?.pos && to?.pos) belt.onPortSnapped();

    return belt;
  }

  /** Get the belt tier from the entity typePath */
  get tier() {
    for (const [t, info] of Object.entries(TIERS)) {
      if (this.entity.typePath === info.typePath) return parseInt(t);
    }
    return 6;
  }

  static fromSave(entity, saveObjects) {
    const inst = entity.instanceName;
    const comp0 = findComp(saveObjects, `${inst}.ConveyorAny0`);
    const comp1 = findComp(saveObjects, `${inst}.ConveyorAny1`);
    return new ConveyorBelt(entity, comp0, comp1);
  }

  static fromBlueprint(entity, blueprintTransform) {
    const Transform = require('../shared/Transform');
    const worldTransform = blueprintTransform.apply(Transform.fromSave(entity.transform));
    const tier = entity.typePath.includes('Mk1') ? 1 : entity.typePath.includes('Mk2') ? 2
      : entity.typePath.includes('Mk3') ? 3 : entity.typePath.includes('Mk4') ? 4
      : entity.typePath.includes('Mk5') ? 5 : 6;
    const belt = ConveyorBelt.create(null, null, tier);

    // Copy world transform and spline from the blueprint entity
    belt.entity.transform = worldTransform.toSave();
    if (entity.properties?.mSplineData) {
      belt.entity.properties.mSplineData = JSON.parse(JSON.stringify(entity.properties.mSplineData));
    }
    if (entity.specialProperties) {
      belt.entity.specialProperties = JSON.parse(JSON.stringify(entity.specialProperties));
    }
    return belt;
  }
}

ConveyorBelt.Ports = { INPUT: 'ConveyorAny0', OUTPUT: 'ConveyorAny1' };
ConveyorBelt.TIERS = TIERS;
ConveyorBelt.IS_SPLINE = true;
ConveyorBelt.SNAP_BEHAVIOR = 'Recalcule sa spline entre les deux endpoints après connexion.';

ConveyorBelt.getPorts = function(entity) {
  return Builder._splinePorts(entity, ['ConveyorAny0', 'ConveyorAny1'], 'belt');
};

module.exports = ConveyorBelt;
