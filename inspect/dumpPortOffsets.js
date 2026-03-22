/**
 * dumpPortOffsets.js — Extract local-space port offsets for producer buildings
 * by analyzing connected belts/pipes in a save file.
 *
 * Approach:
 * 1. Parse the save, collect all objects
 * 2. Build a lookup: componentInstanceName -> { entity, endIndex }
 *    for every ConveyorBelt and Pipeline connection component
 * 3. For each producer building type, find one instance
 * 4. For each of its FGFactoryConnectionComponent / FGPipeConnectionFactory components:
 *    a. Check if that component is referenced in the belt/pipe lookup
 *    b. Get the belt/pipe spline endpoint world position
 *    c. Compute localOffset = inverseRotate(Q, worldPortPos - buildingPos)
 * 5. Output PORT_OFFSETS and PORT_DIRS for each building type
 */

const path = require('path');
const { Parser } = require('@etothepii/satisfactory-file-parser');
const { readFileAsArrayBuffer, Vector3D } = require('../satisfactoryLib');

// --- Quaternion math ---
function rotateByQuat(v, q) {
  // q * v * q^-1 using expanded formula
  const cx = q.y * v.z - q.z * v.y;
  const cy = q.z * v.x - q.x * v.z;
  const cz = q.x * v.y - q.y * v.x;
  const cx2 = q.y * cz - q.z * cy;
  const cy2 = q.z * cx - q.x * cz;
  const cz2 = q.x * cy - q.y * cx;
  return new Vector3D(
    v.x + 2 * (q.w * cx + cx2),
    v.y + 2 * (q.w * cy + cy2),
    v.z + 2 * (q.w * cz + cz2)
  );
}

function inverseRotateQuat(v, q) {
  // conjugate quaternion: negate xyz, keep w
  const qc = { x: -q.x, y: -q.y, z: -q.z, w: q.w };
  return rotateByQuat(v, qc);
}

// --- Building type definitions ---
const BUILDING_TYPES = {
  SmelterMk1: '/Game/FactoryGame/Buildable/Factory/SmelterMk1/Build_SmelterMk1.Build_SmelterMk1_C',
  ConstructorMk1: '/Game/FactoryGame/Buildable/Factory/ConstructorMk1/Build_ConstructorMk1.Build_ConstructorMk1_C',
  AssemblerMk1: '/Game/FactoryGame/Buildable/Factory/AssemblerMk1/Build_AssemblerMk1.Build_AssemblerMk1_C',
  FoundryMk1: '/Game/FactoryGame/Buildable/Factory/FoundryMk1/Build_FoundryMk1.Build_FoundryMk1_C',
  OilRefinery: '/Game/FactoryGame/Buildable/Factory/OilRefinery/Build_OilRefinery.Build_OilRefinery_C',
  Packager: '/Game/FactoryGame/Buildable/Factory/Packager/Build_Packager.Build_Packager_C',
  Blender: '/Game/FactoryGame/Buildable/Factory/Blender/Build_Blender.Build_Blender_C',
  HadronCollider: '/Game/FactoryGame/Buildable/Factory/HadronCollider/Build_HadronCollider.Build_HadronCollider_C',
  QuantumEncoder: '/Game/FactoryGame/Buildable/Factory/QuantumEncoder/Build_QuantumEncoder.Build_QuantumEncoder_C',
  Converter: '/Game/FactoryGame/Buildable/Factory/Converter/Build_Converter.Build_Converter_C',
  // Railway
  BeltStation: '/Game/FactoryGame/Buildable/Factory/Train/Station/Build_TrainDockingStation.Build_TrainDockingStation_C',
  PipeStation: '/Game/FactoryGame/Buildable/Factory/Train/Station/Build_TrainDockingStationLiquid.Build_TrainDockingStationLiquid_C',
};

// Connection component type paths we care about
const CONN_TYPES = {
  conveyor: '/Script/FactoryGame.FGFactoryConnectionComponent',
  pipeFactory: '/Script/FactoryGame.FGPipeConnectionFactory',
};

// --- Main ---
async function main() {
  const savePath = path.join(process.env.LOCALAPPDATA, 'FactoryGame', 'Saved', 'SaveGames', '76561198036887614', 'TEST.sav');
  console.log('Reading save:', savePath);

  const buf = readFileAsArrayBuffer(savePath);
  const save = Parser.ParseSave('TEST', buf);
  console.log('Save parsed successfully');

  const allObjects = Object.values(save.levels).flatMap(l => l.objects);
  console.log(`Total objects: ${allObjects.length}`);

  // Step 1: Index all objects by instanceName
  const objByName = new Map();
  for (const obj of allObjects) {
    objByName.set(obj.instanceName, obj);
  }

  // Step 2: Build a map of componentInstanceName -> { beltOrPipeEntity, endIndex }
  // For belts: ConveyorAny0.mConnectedComponent -> port, ConveyorAny1.mConnectedComponent -> port
  // For pipes: FGPipeConnectionComponent (Connection0/Connection1) -> port
  //
  // But actually, we should go the other way:
  // For each building connection component, find what's connected to it via mConnectedComponent
  // Then from that connected component, find the parent belt/pipe entity and its spline.

  // Step 3: For each building type, find instances and dump port info
  for (const [name, typePath] of Object.entries(BUILDING_TYPES)) {
    // Find all instances of this building type
    const instances = allObjects.filter(o => o.typePath === typePath && o.transform);
    if (instances.length === 0) {
      console.log(`\n=== ${name} === NOT FOUND in save`);
      continue;
    }

    console.log(`\n=== ${name} === (${instances.length} instances)`);

    // Try each instance until we find one with connections
    let bestResult = null;
    let bestConnCount = 0;

    for (const entity of instances) {
      if (!entity.components || entity.components.length === 0) continue;

      const { translation, rotation } = entity.transform;
      const portOffsets = {};
      const portDirs = {};
      let connCount = 0;

      // Find connection components among this entity's children
      for (const compRef of entity.components) {
        const compName = compRef.pathName;
        const comp = objByName.get(compName);
        if (!comp) continue;

        // Only process conveyor and pipe connection components
        if (comp.typePath !== CONN_TYPES.conveyor && comp.typePath !== CONN_TYPES.pipeFactory) continue;

        const shortName = compName.split('.').pop();

        // Check if this component has mConnectedComponent
        const connProp = comp.properties?.mConnectedComponent;
        if (!connProp || !connProp.value?.pathName) continue;

        const connectedCompName = connProp.value.pathName;
        const connectedComp = objByName.get(connectedCompName);
        if (!connectedComp) continue;

        // Find the parent belt/pipe entity of the connected component
        const parentName = connectedComp.parentEntityName || connectedCompName.split('.').slice(0, -1).join('.');
        let parentEntity = objByName.get(parentName);
        if (!parentEntity) {
          // Try parsing from the component's parentEntity property
          if (connectedComp.parentEntity?.pathName) {
            parentEntity = objByName.get(connectedComp.parentEntity.pathName);
          }
        }

        if (!parentEntity || !parentEntity.properties) continue;

        // Determine which end of the belt/pipe connects to our building
        const connectedShortName = connectedCompName.split('.').pop();

        // Get spline data from the parent entity
        const splineData = parentEntity.properties.mSplineData;
        if (!splineData || !splineData.values || splineData.values.length < 2) continue;

        const parentTranslation = parentEntity.transform?.translation;
        if (!parentTranslation) continue;

        // Determine which spline endpoint to use
        // Connection0/ConveyorAny0 -> spline start (index 0)
        // Connection1/ConveyorAny1 -> spline end (last index)
        let splinePoint;
        if (connectedShortName.includes('0') || connectedShortName === 'Connection0' || connectedShortName === 'ConveyorAny0') {
          splinePoint = splineData.values[0];
        } else {
          splinePoint = splineData.values[splineData.values.length - 1];
        }

        const splineProps = splinePoint.value.properties;
        const localSplinePos = splineProps.Location.value;

        // World position of the port = parent entity position + spline local position
        const worldPortPos = new Vector3D(parentTranslation).add(localSplinePos);

        // Compute local offset = inverseRotate(Q, worldPortPos - buildingPos)
        const worldDelta = new Vector3D(worldPortPos).sub(translation);
        const localOffset = inverseRotateQuat(worldDelta, rotation);

        // Compute direction from spline tangent
        // The LeaveTangent at start or ArriveTangent at end gives direction
        let tangent;
        if (connectedShortName.includes('0') || connectedShortName === 'Connection0' || connectedShortName === 'ConveyorAny0') {
          tangent = splineProps.LeaveTangent.value;
        } else {
          tangent = splineProps.ArriveTangent.value;
        }

        // The tangent is in world space (spline tangents are world-aligned)
        // Direction at the port: the belt/pipe goes AWAY from the building at this point
        // For the START of a belt connecting to a building output: tangent points away
        // For the END of a belt connecting to a building input: tangent points toward building
        // The port direction is the direction pointing AWAY from the building

        // Convert tangent to local space
        // Port direction convention: the direction the port FACES (away from building)
        // - For a building INPUT port: direction points outward (toward incoming belt)
        // - For a building OUTPUT port: direction points outward (toward outgoing belt)
        //
        // At spline start (ConveyorAny0/Connection0): LeaveTangent points away from start
        //   -> if belt starts at building, belt goes away, so port faces same direction as tangent
        // At spline end (ConveyorAny1/Connection1): ArriveTangent points toward end (toward building)
        //   -> port faces opposite to arrival tangent (port faces outward, tangent goes inward)
        const tangentNorm = new Vector3D(tangent).norm();
        let worldDir;

        if (connectedShortName.includes('0') || connectedShortName === 'Connection0' || connectedShortName === 'ConveyorAny0') {
          // Start of belt/pipe connects to building port
          // LeaveTangent at start points AWAY from building -> negate for port direction facing outward
          // Actually: the belt leaves the building, so the tangent at the belt start points
          // away from the building. The port direction should also point away from building = same direction.
          // But wait - for INPUT ports, the belt END connects to the building, not the start.
          // Let's think about it differently:
          // The connected component is ConveyorAny0 = the start of the belt.
          // The start of the belt is at the building's port.
          // The LeaveTangent at start shows which way the belt goes from the port.
          // Port direction = the direction the port faces = OUTWARD from building.
          // If this is an OUTPUT: belt leaves the building, tangent = outward direction = port dir
          // If this is an INPUT: belt arrives at building, start is the far end...
          // Actually ConveyorAny0 is always the start endpoint of the belt.
          // If building output connects to ConveyorAny0: belt starts at building, goes away
          //   -> tangent at start = away from building = port direction ✓
          // If building input connects to ConveyorAny0: this shouldn't happen normally
          //   (belts go from ConveyorAny0 to ConveyorAny1)
          worldDir = tangentNorm; // tangent at belt start = direction away from building
        } else {
          // End of belt/pipe connects to building port (ConveyorAny1/Connection1)
          // ArriveTangent at end points in direction of travel = toward the building
          // Port direction = outward = opposite of arrival = -tangent
          worldDir = new Vector3D(tangentNorm).scale(-1);
        }

        let localDir = inverseRotateQuat(worldDir, rotation);
        localDir = new Vector3D(localDir).norm();

        portOffsets[shortName] = {
          x: Math.round(localOffset.x),
          y: Math.round(localOffset.y),
          z: Math.round(localOffset.z),
        };
        portDirs[shortName] = {
          x: Math.round(localDir.x * 100) / 100,
          y: Math.round(localDir.y * 100) / 100,
          z: Math.round(localDir.z * 100) / 100,
        };
        connCount++;
      }

      if (connCount > bestConnCount) {
        bestConnCount = connCount;
        bestResult = { portOffsets, portDirs, entity };
      }
    }

    if (!bestResult || bestConnCount === 0) {
      console.log(`  No connected ports found! (buildings exist but no belts/pipes connected)`);

      // Dump component names for debugging
      const entity = instances[0];
      if (entity.components) {
        console.log(`  Components of first instance:`);
        for (const compRef of entity.components) {
          const comp = objByName.get(compRef.pathName);
          const shortName = compRef.pathName.split('.').pop();
          const connType = comp?.typePath?.split('.').pop() || '?';
          const hasConn = comp?.properties?.mConnectedComponent ? 'CONNECTED' : 'disconnected';
          if (connType === 'FGFactoryConnectionComponent' || connType === 'FGPipeConnectionFactory' || connType === 'FGPipeConnectionComponent') {
            console.log(`    ${shortName} [${connType}] ${hasConn}`);
          }
        }
      }
      continue;
    }

    // Output results
    const { portOffsets, portDirs, entity } = bestResult;
    console.log(`  Instance: ${entity.instanceName}`);
    console.log(`  Position: (${entity.transform.translation.x}, ${entity.transform.translation.y}, ${entity.transform.translation.z})`);
    const r = entity.transform.rotation;
    console.log(`  Rotation: (x=${r.x}, y=${r.y}, z=${r.z}, w=${r.w})`);
    console.log(`  Connected ports: ${bestConnCount}`);

    console.log(`\n  PORT_OFFSETS = {`);
    // Sort keys: Input first, then Output, then Pipe
    const sortedKeys = Object.keys(portOffsets).sort((a, b) => {
      const order = k => k.startsWith('Input') ? 0 : k.startsWith('Output') ? 1 : 2;
      return order(a) - order(b) || a.localeCompare(b);
    });
    for (const key of sortedKeys) {
      const o = portOffsets[key];
      console.log(`    ${key}: { x: ${o.x}, y: ${o.y}, z: ${o.z} },`);
    }
    console.log(`  };`);

    console.log(`  PORT_DIRS = {`);
    for (const key of sortedKeys) {
      const d = portDirs[key];
      console.log(`    ${key}: { x: ${d.x}, y: ${d.y}, z: ${d.z} },`);
    }
    console.log(`  };`);
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  console.error(err.stack);
  process.exit(1);
});