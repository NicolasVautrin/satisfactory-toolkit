const {
  ref, FlowPort, PortType, makeCustomizationData, makeRecipeProp,
  makeEntity, makeComponent, makeSpline,
  nextId, findComp,
  Vector3D,
  projectOnSpline,
} = require('../../satisfactoryLib');

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

class ConveyorBelt {
  /**
   * @param entity    SaveEntity for the belt
   * @param comp0     ConveyorAny0 component (start / output side)
   * @param comp1     ConveyorAny1 component (end / input side)
   */
  constructor(entity, comp0, comp1) {
    this.entity = entity;
    this.inst = entity.instanceName;

    // Reconstruct endpoint offsets from spline data
    const spline = entity.properties?.mSplineData?.values;
    let offset0 = { x: 0, y: 0, z: 0 }, offset1 = { x: 0, y: 0, z: 0 };
    if (spline && spline.length >= 2) {
      const p0 = spline[0].value?.properties?.Location?.value;
      const pN = spline[spline.length - 1].value?.properties?.Location?.value;
      if (p0) offset0 = p0;
      if (pN) offset1 = pN;
    }

    const componentMap = { ConveyorAny0: comp0, ConveyorAny1: comp1 };
    const portDefs = {
      ConveyorAny0: { offset: offset0, dir: null, flow: 'input',  type: PortType.BELT },
      ConveyorAny1: { offset: offset1, dir: null, flow: 'output', type: PortType.BELT },
    };
    const ports = FlowPort.fromLayout(componentMap, entity.transform, portDefs);
    this._ports = ports;
    this._ports[ConveyorBelt.Ports.INPUT]._owner = this;
    this._ports[ConveyorBelt.Ports.OUTPUT]._owner = this;
    this.components = [comp0, comp1];
  }

  port(name) {
    const p = this._ports[name];
    if (!p) throw new Error(`ConveyorBelt ${this.inst}: unknown port "${name}"`);
    return p;
  }

  recalcSpline() {
    const input = this._ports[ConveyorBelt.Ports.INPUT];
    const output = this._ports[ConveyorBelt.Ports.OUTPUT];
    const startPos = input.pos;
    const endPos = output.pos;
    this.entity.transform.translation = { ...startPos };
    const dx = endPos.x - startPos.x;
    const dy = endPos.y - startPos.y;
    const dz = endPos.z - startPos.z;
    this.entity.properties.mSplineData = makeSpline(dx, dy, dz, input.dir, output.dir);
  }

  /** Get all save objects (entity + components) to inject into save */
  allObjects() {
    return [this.entity, ...this.components];
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

    if (from?.pos) { input.pos = from.pos; input.dir = from.dir || null; }
    if (to?.pos) { output.pos = to.pos; output.dir = to.dir || null; }
    if (from?.pos && to?.pos) belt.recalcSpline();

    return belt;
  }

  /** Get the belt tier from the entity typePath */
  get tier() {
    for (const [t, info] of Object.entries(TIERS)) {
      if (this.entity.typePath === info.typePath) return parseInt(t);
    }
    return 6;
  }

  /**
   * Attach a splitter onto this belt, splitting it in two.
   * The belt is reused as belt1 (input → splitter.input).
   * A new belt2 is created (splitter.center → original output).
   * @param splitter  ConveyorSplitter instance
   * @param position  {x,y,z} world position — projected onto belt, error if > 100u away
   * @returns belt2   The new belt after the splitter
   */
  attachSplitter(splitter, position) {
    const input = this._ports[ConveyorBelt.Ports.INPUT];
    const output = this._ports[ConveyorBelt.Ports.OUTPUT];
    const origin = this.entity.transform.translation;
    const spline = this.entity.properties.mSplineData.values;
    const proj = projectOnSpline(spline, origin, position);

    // Position and orient the splitter
    // Splitter input faces -X local, so forward = tangent direction maps to +X
    splitter.entity.transform.translation = proj.pos;
    splitter.entity.transform.rotation = proj.rotation;
    // Rebuild splitter ports with new transform
    splitter._rebuildPorts();

    // Save original output info and detach (frees both sides)
    const origOutputPos = output.pos;
    const origOutputDir = output.dir;
    const origTarget = output._wiredTo;
    output.detach();

    // Truncate this belt: output → splitter.input
    const splInput = splitter.port('Input1');
    output.wire(splInput);
    output.pos = splInput.pos;
    output.dir = new Vector3D(splInput.dir).scale(-1);
    this.recalcSpline();

    // Create belt2: splitter.center → original output destination
    const splCenter = splitter.port('Output1');
    const belt2 = ConveyorBelt.create(null, null, this.tier);
    const belt2Input = belt2._ports[ConveyorBelt.Ports.INPUT];
    const belt2Output = belt2._ports[ConveyorBelt.Ports.OUTPUT];
    belt2Input.pos = splCenter.pos;
    belt2Input.dir = splCenter.dir;
    belt2Output.pos = origOutputPos;
    belt2Output.dir = origOutputDir;
    belt2Input.wire(splCenter);
    if (origTarget) belt2Output.wire(origTarget);
    belt2.recalcSpline();

    return belt2;
  }

  /**
   * Attach a merger onto this belt, splitting it in two.
   * The belt is reused as belt1 (input → merger.center).
   * A new belt2 is created (merger.output → original output).
   * @param merger    ConveyorMerger instance
   * @param position  {x,y,z} world position — projected onto belt, error if > 100u away
   * @returns belt2   The new belt after the merger
   */
  attachMerger(merger, position) {
    const input = this._ports[ConveyorBelt.Ports.INPUT];
    const output = this._ports[ConveyorBelt.Ports.OUTPUT];
    const origin = this.entity.transform.translation;
    const spline = this.entity.properties.mSplineData.values;
    const proj = projectOnSpline(spline, origin, position);

    // Position and orient the merger
    // Merger center input faces -X local, output faces +X — same as splitter
    merger.entity.transform.translation = proj.pos;
    merger.entity.transform.rotation = proj.rotation;
    merger._rebuildPorts();

    // Save original output info and detach (frees both sides)
    const origOutputPos = output.pos;
    const origOutputDir = output.dir;
    const origTarget = output._wiredTo;
    output.detach();

    // Truncate this belt: output → merger.center
    const mrgCenter = merger.port('Input1');
    output.wire(mrgCenter);
    output.pos = mrgCenter.pos;
    output.dir = new Vector3D(mrgCenter.dir).scale(-1);
    this.recalcSpline();

    // Create belt2: merger.output → original output destination
    const mrgOutput = merger.port('Output1');
    const belt2 = ConveyorBelt.create(null, null, this.tier);
    const belt2Input = belt2._ports[ConveyorBelt.Ports.INPUT];
    const belt2Output = belt2._ports[ConveyorBelt.Ports.OUTPUT];
    belt2Input.pos = mrgOutput.pos;
    belt2Input.dir = mrgOutput.dir;
    belt2Output.pos = origOutputPos;
    belt2Output.dir = origOutputDir;
    belt2Input.wire(mrgOutput);
    if (origTarget) belt2Output.wire(origTarget);
    belt2.recalcSpline();

    return belt2;
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

module.exports = ConveyorBelt;
