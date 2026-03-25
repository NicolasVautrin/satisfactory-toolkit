/**
 * Shared library for Satisfactory save file manipulation.
 * Provides entity/component creators, pipe/power wiring, spline math,
 * and common constants used by the satisfactory-file-parser.
 */
const fs = require('fs');
const crypto = require('crypto');
const { Parser, SaveEntity, SaveComponent } = require('@etothepii/satisfactory-file-parser');

// --- Constants ---
const BUILDABLE_SUBSYSTEM = 'Persistent_Level:PersistentLevel.BuildableSubsystem';
const SWATCH_DEFAULT = '/Game/FactoryGame/Buildable/-Shared/Customization/Swatches/SwatchDesc_Concrete.SwatchDesc_Concrete_C';

const TYPE_PATHS = {
  waterPump: '/Game/FactoryGame/Buildable/Factory/WaterPump/Build_WaterPump.Build_WaterPump_C',
  pipelineMK2: '/Game/FactoryGame/Buildable/Factory/PipelineMk2/Build_PipelineMK2.Build_PipelineMK2_C',
  pipelinePumpMK2: '/Game/FactoryGame/Buildable/Factory/PipePumpMk2/Build_PipelinePumpMK2.Build_PipelinePumpMk2_C',
  junctionCross: '/Game/FactoryGame/Buildable/Factory/PipeJunction/Build_PipelineJunction_Cross.Build_PipelineJunction_Cross_C',
  powerLine: '/Game/FactoryGame/Buildable/Factory/PowerLine/Build_PowerLine.Build_PowerLine_C',
  flowIndicator: '/Game/FactoryGame/Buildable/Factory/Pipeline/FlowIndicator/Build_PipelineFlowIndicator.Build_PipelineFlowIndicator_C',
};

const RECIPES = {
  waterPump: '/Game/FactoryGame/Recipes/Buildings/Recipe_WaterPump.Recipe_WaterPump_C',
  pipelineMK2: '/Game/FactoryGame/Recipes/Buildings/Recipe_PipelineMK2.Recipe_PipelineMK2_C',
  pipelinePumpMK2: '/Game/FactoryGame/Recipes/Buildings/Recipe_PipelinePumpMK2.Recipe_PipelinePumpMK2_C',
  junctionCross: '/Game/FactoryGame/Recipes/Buildings/Recipe_PipelineJunction_Cross.Recipe_PipelineJunction_Cross_C',
};

const FLAGS = 8;
const SAVE_CUSTOM_VERSION = 52;
const PORT_TANGENT = 50;

// Component flags (from reference entities in working saves)
const COMP_FLAGS = {
  pipeConnection: 262152,           // 0x40008  - pipe endpoints
  pipeConnectionFactory: 2097152,   // 0x200000 - building fluid ports (extractors)
  pipeConnectionJunction: 2097152,  // 0x200000 - junction ports
  powerConnection: 2883592,         // 0x2c0008
  powerInfo: 2883592,               // 0x2c0008
  inventory: 2883592,               // 0x2c0008
  factoryLegs: 2097152,             // 0x200000
  junctionInventory: 262152,        // 0x40008  - junction aux components
  junctionPowerInfo: 262152,        // 0x40008
};

// --- Clearance Data ---
let _clearanceData = null;
function getClearance(typePath) {
  if (!_clearanceData) return null;
  const className = typePath.split('.').pop();
  return _clearanceData[className] || null;
}

// --- ID Generator ---
let _sessionId = null;
let _counter = 0;
function initSession() {
  const d = new Date();
  _sessionId = [d.getDate(), d.getMonth()+1, d.getFullYear()%100, d.getHours(), d.getMinutes(), d.getSeconds()]
    .map(n => String(n).padStart(2, '0')).join('');
  _counter = 0;
  _clearanceData = require('./data/clearanceData.json');
  return _sessionId;
}
function getSessionId() { return _sessionId; }
function nextId() {
  if (!_sessionId) throw new Error('Call initSession() before using the lib');
  return `${_sessionId}_${String(++_counter).padStart(3, '0')}`;
}

// --- File I/O ---
function readFileAsArrayBuffer(path) {
  const buf = fs.readFileSync(path);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

function writeSaveToFile(save, outputPath) {
  let headerBuf;
  const bodyChunks = [];
  Parser.WriteSave(save,
    h => { headerBuf = h; },
    c => { bodyChunks.push(c); }
  );
  const outputBuf = Buffer.concat([headerBuf, ...bodyChunks]);
  fs.writeFileSync(outputPath, outputBuf);
  return outputBuf.length;
}

const FlowPort = require('./lib/shared/FlowPort');
const Vector3D = require('./lib/shared/Vector3D');

// --- Basic Helpers ---
function ref(pathName, levelName = 'Persistent_Level') {
  return { levelName, pathName };
}

function makeCustomizationData() {
  return {
    type: 'StructProperty', ueType: 'StructProperty',
    name: 'mCustomizationData',
    value: {
      type: 'FactoryCustomizationData',
      properties: {
        SwatchDesc: {
          type: 'ObjectProperty', ueType: 'ObjectProperty',
          name: 'SwatchDesc', value: ref(SWATCH_DEFAULT, ''),
        },
      },
    },
    subtype: 'FactoryCustomizationData',
  };
}

function makeRecipeProp(recipe) {
  return {
    type: 'ObjectProperty', ueType: 'ObjectProperty',
    name: 'mBuiltWithRecipe', value: ref(recipe, ''),
  };
}

function makeFluidBox(value = 0) {
  return {
    type: 'StructProperty', ueType: 'StructProperty',
    name: 'mFluidBox', value: { value }, subtype: 'FluidBox',
  };
}

function makeEntity(typePath, instanceName) {
  const e = new SaveEntity(typePath, 'Persistent_Level', instanceName, '');
  e.needTransform = true;
  e.wasPlacedInLevel = false;
  e.flags = FLAGS;
  e.saveCustomVersion = SAVE_CUSTOM_VERSION;
  e.parentObject = ref(BUILDABLE_SUBSYSTEM);
  return e;
}

function makeComponent(typePath, instanceName, parentEntityName, flags = 0) {
  const c = new SaveComponent(typePath, 'Persistent_Level', instanceName, parentEntityName);
  c.saveCustomVersion = SAVE_CUSTOM_VERSION;
  c.flags = flags;
  c.properties = {};
  return c;
}

// --- Component Creators ---
function makePipeConnection(instanceName, parentEntityName, networkId, connectedTo) {
  const c = makeComponent('/Script/FactoryGame.FGPipeConnectionComponent', instanceName, parentEntityName, COMP_FLAGS.pipeConnection);
  if (connectedTo) {
    c.properties.mConnectedComponent = {
      type: 'ObjectProperty', ueType: 'ObjectProperty',
      name: 'mConnectedComponent', value: ref(connectedTo),
    };
  }
  return c;
}

function makePipeConnectionFactory(instanceName, parentEntityName, networkId, connectedTo, outputInvName) {
  const c = makeComponent('/Script/FactoryGame.FGPipeConnectionFactory', instanceName, parentEntityName, COMP_FLAGS.pipeConnectionFactory);
  if (connectedTo) {
    c.properties.mConnectedComponent = {
      type: 'ObjectProperty', ueType: 'ObjectProperty',
      name: 'mConnectedComponent', value: ref(connectedTo),
    };
  }
  if (outputInvName) {
    c.properties.mFluidBox = makeFluidBox(7);
    c.properties.mConnectionInventory = {
      type: 'ObjectProperty', ueType: 'ObjectProperty',
      name: 'mConnectionInventory', value: ref(outputInvName),
    };
  }
  return c;
}

function makePowerConnection(instanceName, parentEntityName, wireRefs) {
  const c = makeComponent('/Script/FactoryGame.FGPowerConnectionComponent', instanceName, parentEntityName, COMP_FLAGS.powerConnection);
  if (wireRefs && wireRefs.length > 0) {
    c.properties.mWires = {
      type: 'ObjectArrayProperty', ueType: 'ArrayProperty',
      name: 'mWires', subtype: 'ObjectProperty',
      values: wireRefs.map(w => ref(w)),
    };
  }
  return c;
}

function makePowerInfo(instanceName, parentEntityName, targetConsumption) {
  const c = makeComponent('/Script/FactoryGame.FGPowerInfoComponent', instanceName, parentEntityName, COMP_FLAGS.powerInfo);
  c.properties.mTargetConsumption = {
    type: 'FloatProperty', ueType: 'FloatProperty',
    name: 'mTargetConsumption', value: targetConsumption,
  };
  return c;
}

function makeInventoryPotential(instanceName, parentEntityName) {
  return makeComponent('/Script/FactoryGame.FGInventoryComponent', instanceName, parentEntityName, COMP_FLAGS.inventory);
}

function makeOutputInventory(instanceName, parentEntityName) {
  return makeComponent('/Script/FactoryGame.FGInventoryComponent', instanceName, parentEntityName, COMP_FLAGS.inventory);
}

// --- Spline evaluation ---

/** Evaluate a Hermite cubic segment at t∈[0,1]. Returns {pos, tangent}. */
function evalHermite(p0, p1, t0, t1, t) {
  const t2 = t * t, t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  const pos = new Vector3D(
    h00 * p0.x + h10 * t0.x + h01 * p1.x + h11 * t1.x,
    h00 * p0.y + h10 * t0.y + h01 * p1.y + h11 * t1.y,
    h00 * p0.z + h10 * t0.z + h01 * p1.z + h11 * t1.z
  );
  // Derivative of Hermite: tangent
  const d00 = 6 * t2 - 6 * t;
  const d10 = 3 * t2 - 4 * t + 1;
  const d01 = -6 * t2 + 6 * t;
  const d11 = 3 * t2 - 2 * t;
  const tangent = new Vector3D(
    d00 * p0.x + d10 * t0.x + d01 * p1.x + d11 * t1.x,
    d00 * p0.y + d10 * t0.y + d01 * p1.y + d11 * t1.y,
    d00 * p0.z + d10 * t0.z + d01 * p1.z + d11 * t1.z
  );
  return { pos, tangent };
}

/**
 * Project a world position onto a spline. Finds the closest point.
 * @param splineValues  mSplineData.values array
 * @param origin        entity.transform.translation (spline locations are local)
 * @param position      {x,y,z} world position to project
 * @param maxDist       max distance allowed (default 100)
 * @returns {pos, tangent, normal, rotation, t, segIndex, distance}
 */
function projectOnSpline(splineValues, origin, position, maxDist = 100) {
  const STEPS = 64;
  const segments = splineValues.length - 1;
  if (segments < 1) throw new Error('Spline needs at least 2 points');

  let bestDist = Infinity, bestResult = null;

  for (let seg = 0; seg < segments; seg++) {
    const sp0 = splineValues[seg].value.properties;
    const sp1 = splineValues[seg + 1].value.properties;
    const p0 = new Vector3D(origin).add(sp0.Location.value);
    const p1 = new Vector3D(origin).add(sp1.Location.value);
    const t0 = sp0.LeaveTangent.value;
    const t1 = sp1.ArriveTangent.value;

    for (let i = 0; i <= STEPS; i++) {
      const t = i / STEPS;
      const { pos, tangent } = evalHermite(p0, p1, t0, t1, t);
      const dist = new Vector3D(position).sub(pos).length;
      if (dist < bestDist) {
        bestDist = dist;
        bestResult = { pos, tangent, t, segIndex: seg };
      }
    }
  }

  if (bestDist > maxDist) {
    throw new Error(`Position too far from spline: ${bestDist.toFixed(1)}u (max ${maxDist}u)`);
  }

  // Compute normal and full rotation quaternion
  const tangentNorm = new Vector3D(bestResult.tangent).norm();
  const up = new Vector3D(0, 0, 1);
  let right = up.cross(tangentNorm);
  if (right.length < 0.001) right = new Vector3D(0, 1, 0); // fallback if tangent is vertical
  right = right.norm();
  const normal = tangentNorm.cross(right);

  bestResult.normal = normal;
  bestResult.rotation = quatFromBasis(tangentNorm, right, normal);
  bestResult.distance = bestDist;
  return bestResult;
}

/**
 * Build a quaternion from an orthonormal basis (forward=X, right=Y, up=Z).
 * Forward corresponds to local +X (splitter input direction is -X).
 */
function quatFromBasis(forward, right, up) {
  // Rotation matrix to quaternion
  // Matrix columns: forward=X, right=Y, up=Z
  const m00 = forward.x, m01 = right.x, m02 = up.x;
  const m10 = forward.y, m11 = right.y, m12 = up.y;
  const m20 = forward.z, m21 = right.z, m22 = up.z;
  const trace = m00 + m11 + m22;
  let x, y, z, w;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    w = 0.25 / s;
    x = (m21 - m12) * s;
    y = (m02 - m20) * s;
    z = (m10 - m01) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    w = (m21 - m12) / s;
    x = 0.25 * s;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    w = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = 0.25 * s;
    z = (m12 + m21) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    w = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = 0.25 * s;
  }
  return { x, y, z, w };
}

// --- Spline builder ---
function splinePoint(loc, arriveTangent, leaveTangent) {
  return {
    type: 'StructProperty', ueType: 'StructProperty', name: '',
    subtype: 'SplinePointData',
    value: {
      type: 'SplinePointData',
      properties: {
        Location: { type: 'StructProperty', ueType: 'StructProperty', name: 'Location', value: loc, subtype: 'Vector' },
        ArriveTangent: { type: 'StructProperty', ueType: 'StructProperty', name: 'ArriveTangent', value: arriveTangent, subtype: 'Vector' },
        LeaveTangent: { type: 'StructProperty', ueType: 'StructProperty', name: 'LeaveTangent', value: leaveTangent, subtype: 'Vector' },
      },
    },
  };
}

function wrapSplineData(points) {
  return {
    type: 'StructArrayProperty', ueType: 'ArrayProperty',
    name: 'mSplineData',
    structValueFields: { allStructType: 'SplinePointData' },
    subtype: 'StructProperty',
    values: points,
  };
}

/**
 * Creates spline data for a pipe from (0,0,0) to (dx, dy, dz) in local space.
 * 4-point Hermite spline matching Satisfactory's native format:
 *   P0 (endpoint) -> P1 (guard at GUARD_DIST) -> P2 (guard at GUARD_DIST from end) -> P3 (endpoint)
 * Guard segments: 100u (2×PORT_TANGENT) straight sections at each port.
 * Tangent norms: 1 at outer extremities, PORT_TANGENT at connections,
 * intermediate tangents oriented toward the central segment.
 */
function makeSpline(dx, dy, dz, dirIn, dirOut) {
  const end = new Vector3D(dx, dy, dz);
  const totalLen = end.length;
  if (totalLen < 1) {
    return wrapSplineData([
      splinePoint(new Vector3D(0, 0, 0), new Vector3D(1, 0, 0), new Vector3D(1, 0, 0)),
      splinePoint(new Vector3D(1, 0, 0), new Vector3D(1, 0, 0), new Vector3D(1, 0, 0)),
    ]);
  }

  const straightDir = end.norm();
  if (!dirIn) dirIn = straightDir;
  if (!dirOut) dirOut = straightDir;

  const dirInNorm = new Vector3D(dirIn).norm();
  // dirOut points away from destination building; pipe arrives in -dirOut direction
  const arriveNorm = new Vector3D(dirOut).norm().scale(-1);

  // Guard distance: 100u (2×PORT_TANGENT), clamped for short pipes
  const GUARD_DIST = Math.min(2 * PORT_TANGENT, totalLen / 4);

  // P1: GUARD_DIST from P0 in dirIn direction (straight guard segment)
  const p1 = dirInNorm.scale(GUARD_DIST);
  // P2: GUARD_DIST from P3 back along arrival direction (straight guard segment)
  const p2 = end.sub(arriveNorm.scale(GUARD_DIST));

  // Central segment direction (P1 -> P2)
  const midVec = p2.sub(p1);
  const midLen = midVec.length;

  // Midpoint between P1 and P2
  const pMid = p1.add(p2).scale(0.5);
  // Midpoint tangents: arrive from P1, leave toward P2
  const midFromP1 = pMid.sub(p1);
  const midToP2 = p2.sub(pMid);

  return wrapSplineData([
    // P0: endpoint
    splinePoint(new Vector3D(0, 0, 0), dirInNorm, dirInNorm.scale(PORT_TANGENT)),
    // P1: guard
    splinePoint(p1, dirInNorm.scale(PORT_TANGENT), dirInNorm.scale(midLen / 3)),
    // Pmid: midpoint
    splinePoint(pMid, midFromP1, midToP2),
    // P2: guard
    splinePoint(p2, arriveNorm.scale(midLen / 3), arriveNorm.scale(PORT_TANGENT)),
    // P3: endpoint
    splinePoint(end, arriveNorm.scale(PORT_TANGENT), arriveNorm),
  ]);
}

function makeSnappedPassthroughs() {
  return {
    type: 'ObjectArrayProperty', ueType: 'ArrayProperty',
    name: 'mSnappedPassthroughs', subtype: 'ObjectProperty',
    values: [ref('', ''), ref('', '')],
  };
}

/**
 * Wires a power line and updates mWires on both power connections.
 */
function wirePowerLine(powerLine, from, to) {
  for (const conn of [from, to]) {
    if (!conn?.component) continue;
    if (!conn.component.properties.mWires) {
      conn.component.properties.mWires = {
        type: 'ObjectArrayProperty', ueType: 'ArrayProperty',
        name: 'mWires', subtype: 'ObjectProperty', values: [],
      };
    }
    conn.component.properties.mWires.values.push(ref(powerLine.inst));
  }
}

// Helper to find a component in saveObjects by instanceName
function findComp(saveObjects, name) {
  const comp = saveObjects.find(o => o.instanceName === name);
  if (!comp) throw new Error(`Component not found: ${name}`);
  return comp;
}

const { FlowType, PortType } = FlowPort;

// Populate module.exports in-place so that circular requires from lib/
// classes receive the same object (already filled with functions/constants).
Object.assign(module.exports, {
  // Constants
  BUILDABLE_SUBSYSTEM, SWATCH_DEFAULT, TYPE_PATHS, RECIPES,
  FLAGS, SAVE_CUSTOM_VERSION, COMP_FLAGS, PORT_TANGENT, FlowType, PortType,
  // Classes
  FlowPort, Vector3D, Quaternion: require('./lib/shared/Quaternion'),
  // ID & clearance
  initSession, getSessionId, nextId, getClearance,
  // File I/O
  readFileAsArrayBuffer, writeSaveToFile,
  // Helpers
  ref, findComp, makeCustomizationData, makeRecipeProp, makeFluidBox,
  makeEntity, makeComponent,
  // Component creators
  makePipeConnection, makePipeConnectionFactory,
  makePowerConnection, makePowerInfo,
  makeInventoryPotential, makeOutputInventory,
  // Spline
  evalHermite, projectOnSpline, quatFromBasis,
  splinePoint, wrapSplineData, makeSpline, makeSnappedPassthroughs,
  // Wiring
  wirePowerLine,
});

// Entity classes (loaded after exports are populated to break circular dep)
Object.assign(module.exports, {
  // Logistic
  ConveyorBelt: require('./lib/logistic/ConveyorBelt'),
  ConveyorLift: require('./lib/logistic/ConveyorLift'),
  ConveyorMerger: require('./lib/logistic/ConveyorMerger'),
  ConveyorPole: require('./lib/logistic/ConveyorPole'),
  ConveyorPoleSimple: require('./lib/logistic/ConveyorPoleSimple'),
  ConveyorSplitter: require('./lib/logistic/ConveyorSplitter'),
  Pipe: require('./lib/logistic/Pipe'),
  PipeHole: require('./lib/logistic/PipeHole'),
  PipeJunction: require('./lib/logistic/PipeJunction'),
  PipePump: require('./lib/logistic/PipePump'),
  PipeSupport: require('./lib/logistic/PipeSupport'),
  PipeSupportSimple: require('./lib/logistic/PipeSupportSimple'),
  PowerLine: require('./lib/logistic/PowerLine'),
  // Producers
  Assembler: require('./lib/producers/Assembler'),
  Blender: require('./lib/producers/Blender'),
  Constructor: require('./lib/producers/Constructor'),
  Converter: require('./lib/producers/Converter'),
  Foundry: require('./lib/producers/Foundry'),
  HadronCollider: require('./lib/producers/HadronCollider'),
  Manufacturer: require('./lib/producers/Manufacturer'),
  NukePlant: require('./lib/producers/NukePlant'),
  Refinery: require('./lib/producers/Refinery'),
  Packager: require('./lib/producers/Packager'),
  QuantumEncoder: require('./lib/producers/QuantumEncoder'),
  Smelter: require('./lib/producers/Smelter'),
  // Extractors
  FrackingExtractor: require('./lib/extractors/FrackingExtractor'),
  FrackingSmasher: require('./lib/extractors/FrackingSmasher'),
  Miner: require('./lib/extractors/Miner'),
  OilPump: require('./lib/extractors/OilPump'),
  WaterExtractor: require('./lib/extractors/WaterExtractor'),
  // Structural (lightweight buildables)
  Foundation: require('./lib/structural/Foundation'),
  // Railway
  RailroadSubsystem:   require('./lib/railway/RailroadSubsystem'),
  RailwayHelper:       require('./lib/railway/RailwayHelper'),
  RailroadTrack:       require('./lib/railway/RailroadTrack'),
  TrainStation:        require('./lib/railway/TrainStation'),
  BeltStation:         require('./lib/railway/BeltStation'),
  PipeStation:         require('./lib/railway/PipeStation'),
  Locomotive:          require('./lib/railway/Locomotive'),
  FreightWagon:        require('./lib/railway/FreightWagon'),
  Train:               require('./lib/railway/Train'),
  RailroadSignal:      require('./lib/railway/RailroadSignal'),
  RailroadEndStop:     require('./lib/railway/RailroadEndStop'),
});
