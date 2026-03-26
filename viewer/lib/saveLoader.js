const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { Parser } = require('@etothepii/satisfactory-file-parser');
const { buildSaveEntityData, buildCbpEntityData, buildSingleEntityItem } = require('./entityData');

// ── Two independent data slots ─────────────────────────────────────
let saveState = null;
let cbpState = null;

function getSaveState() { return saveState; }
function getCbpState() { return cbpState; }

// ── Classes to skip ────────────────────────────────────────────────
const SKIP_CLASSES = /FlowIndicator/;

// ── Load a save file (from upload buffer) ──────────────────────────
function loadSave(name, buf) {
  console.log(`Loading save "${name}" (${(buf.byteLength / 1024 / 1024).toFixed(1)} MB)...`);
  const save = Parser.ParseSave(name, buf);
  const allObjects = Object.values(save.levels).flatMap(l => l.objects);
  const allEntities = allObjects.filter(o => o.type === 'SaveEntity' && o.transform);

  const entities = allEntities.filter(o => {
    const cls = o.typePath.split('.').pop();
    return cls.startsWith('Build_') && !SKIP_CLASSES.test(cls);
  });
  console.log(`Loaded ${entities.length} buildable entities (${allEntities.length} total)`);

  // Lightweight buildables
  const lwSub = allObjects.find(o => o.typePath?.includes('LightweightBuildable'));
  const lwInstances = [];
  if (lwSub && lwSub.specialProperties?.buildables) {
    for (const b of lwSub.specialProperties.buildables) {
      const typePath = b.typeReference.pathName;
      const cls = typePath.split('.').pop();
      for (const inst of b.instances) {
        // Skip removed instances (game clears recipe+swatch but keeps the slot)
        if (!inst.usedRecipe?.pathName) continue;
        const item = { typePath, cls, transform: inst.transform, recipe: inst.usedRecipe.pathName };
        // Beams have variable length in instanceSpecificData
        if (inst.instanceSpecificData?.hasValidStruct) {
          const bl = inst.instanceSpecificData.properties?.BeamLength;
          if (bl) item.beamLength = bl.value;
        }
        lwInstances.push(item);
      }
    }
  }
  console.log(`Loaded ${lwInstances.length} lightweight buildables`);

  // Build component index for port connection detection
  const compByName = new Map();
  for (const obj of allObjects) {
    if (obj.type === 'SaveComponent') compByName.set(obj.instanceName, obj);
  }

  const entityData = buildSaveEntityData(entities, lwInstances, compByName);

  // Unified index: items[i] maps to entityData.entities[i]
  const items = [
    ...entities.map(e => ({ type: 'entity', entity: e })),
    ...lwInstances.map(lw => ({ type: 'lw', lw })),
  ];

  saveState = { name, save, allObjects, entities, lwInstances, items, entityData };
  console.log(`Prepared ${entityData.classNames.length} unique classNames`);
}

// ── Load a CBP file (from upload buffer) ───────────────────────────
function loadCbp(name, buf) {
  console.log(`Loading CBP "${name}" (${(buf.byteLength / 1024).toFixed(0)} KB compressed)...`);
  const raw = JSON.parse(zlib.inflateSync(Buffer.from(buf)).toString('utf-8'));
  console.log(`CBP: ${raw.data.length} entries, saveVersion=${raw.saveVersion}, buildVersion=${raw.buildVersion}`);

  const entityData = buildCbpEntityData(raw);
  cbpState = { name, raw, entityData };
  console.log(`CBP prepared: ${entityData.entities.length} buildable entities, ${entityData.classNames.length} classNames`);
}

// ── Load a blueprint .sbp file (from upload buffer) ────────────────
function loadBlueprint(name, rawBuf) {
  // Ensure we have an ArrayBuffer (upload passes one from req.body.buffer.slice)
  const sbpAB = rawBuf instanceof ArrayBuffer ? rawBuf
    : rawBuf.buffer.slice(rawBuf.byteOffset, rawBuf.byteOffset + rawBuf.byteLength);
  console.log(`Loading blueprint "${name}" (${(sbpAB.byteLength / 1024).toFixed(0)} KB)...`);

  // Generate a dummy .sbpcfg by writing a minimal blueprint and extracting the cfg
  const dummyBp = {
    name,
    compressionInfo: {
      chunkHeaderVersion: 572662306,
      packageFileTag: 2653586369,
      maxUncompressedChunkContentSize: 131072,
      compressionAlgorithm: 3,
    },
    header: {
      headerVersion: 2, saveVersion: 46, buildVersion: 378208,
      itemCosts: [], recipeReferences: [],
    },
    config: {
      configVersion: 3, description: name,
      color: { r: 0.2, g: 0.4, b: 0.6, a: 1 },
      iconID: 782,
      referencedIconLibrary: '/Game/FactoryGame/-Shared/Blueprint/IconLibrary',
      iconLibraryType: 'IconLibrary',
    },
    objects: [],
  };
  const dummyResult = Parser.WriteBlueprintFiles(dummyBp, () => {}, () => {});
  const cfgAB = dummyResult.configFileBinary;

  const parsed = Parser.ParseBlueprintFiles(name, sbpAB, cfgAB);

  const entities = parsed.objects.filter(o => o.type === 'SaveEntity' && o.transform);
  console.log(`Blueprint: ${entities.length} entities (${parsed.objects.length} total objects)`);

  // Build entityData using the same format as save entities
  const { buildSaveEntityData } = require('./entityData');

  // Build component index for port connection detection
  const compByName = new Map();
  for (const obj of parsed.objects) {
    if (obj.type === 'SaveComponent') compByName.set(obj.instanceName, obj);
  }

  const buildable = entities.filter(o => {
    const cls = o.typePath.split('.').pop();
    return cls.startsWith('Build_');
  });

  const entityData = buildSaveEntityData(buildable, [], compByName);
  cbpState = { name, entityData, blueprintObjects: parsed.objects };
  console.log(`Blueprint prepared: ${entityData.entities.length} buildable entities, ${entityData.classNames.length} classNames`);
}

// ── Load heightmap ─────────────────────────────────────────────────
const HEIGHTMAP_PATH = path.join(__dirname, '..', '..', 'data', 'heightmap.json');
let heightmapData = null;
if (fs.existsSync(HEIGHTMAP_PATH)) {
  heightmapData = JSON.parse(fs.readFileSync(HEIGHTMAP_PATH, 'utf-8'));
  console.log(`Heightmap: ${heightmapData.gridSize}x${heightmapData.gridSize}`);
} else {
  console.warn('No heightmap found. Run: node tools/generateHeightmap.js');
}

function getHeightmapData() { return heightmapData; }

// ── Delete entities from save in memory ────────────────────────────
function deleteEntities(indices) {
  if (!saveState) throw new Error('No save loaded');

  const toDelete = new Set(indices);

  // Collect instanceNames of regular entities to delete (for component cleanup)
  const namesToDelete = new Set();
  const entitiesToRemove = new Set();
  const lwToRemove = new Set();

  for (const idx of toDelete) {
    const item = saveState.items[idx];
    if (!item) continue;
    if (item.type === 'entity') {
      namesToDelete.add(item.entity.instanceName);
      entitiesToRemove.add(item.entity);
    } else {
      lwToRemove.add(item.lw);
    }
  }

  // Remove entities from save levels
  if (namesToDelete.size > 0) {
    for (const level of Object.values(saveState.save.levels)) {
      level.objects = level.objects.filter(o => {
        if (o.type === 'SaveEntity' && namesToDelete.has(o.instanceName)) return false;
        if (o.type === 'SaveComponent' && namesToDelete.has(o.parentEntityName)) return false;
        return true;
      });
    }
  }

  // Remove from saveState arrays
  saveState.entities = saveState.entities.filter(e => !entitiesToRemove.has(e));
  saveState.lwInstances = saveState.lwInstances.filter(lw => !lwToRemove.has(lw));
  saveState.items = saveState.items.filter((_, i) => !toDelete.has(i));

  // Update allObjects
  saveState.allObjects = Object.values(saveState.save.levels).flatMap(l => l.objects);

  // Rebuild entityData
  const compByName = new Map();
  for (const obj of saveState.allObjects) {
    if (obj.type === 'SaveComponent') compByName.set(obj.instanceName, obj);
  }
  saveState.entityData = buildSaveEntityData(saveState.entities, saveState.lwInstances, compByName);

  console.log(`Deleted ${toDelete.size} (${entitiesToRemove.size} entities + ${lwToRemove.size} lightweight)`);
  return { deleted: toDelete.size };
}

// ── Inject blueprint into save with placement transform ─────────────
function injectBlueprint(placementTransform) {
  if (!saveState) throw new Error('No save loaded');
  if (!cbpState?.blueprintObjects) throw new Error('No blueprint loaded');

  const { initSession } = require('../../satisfactoryLib');
  const sessionId = initSession();
  console.log(`Inject blueprint session: ${sessionId}`);

  const { tx, ty, tz, yaw } = placementTransform;
  const cosY = Math.cos(yaw * Math.PI / 180);
  const sinY = Math.sin(yaw * Math.PI / 180);
  const halfYaw = (yaw * Math.PI / 180) / 2;
  const yqz = Math.sin(halfYaw);
  const yqw = Math.cos(halfYaw);

  const refEntity = saveState.entities[0];
  const saveCustomVersion = refEntity?.saveCustomVersion || 52;

  // Find main level
  const mainLevelKey = Object.keys(saveState.save.levels).find(k => {
    return saveState.save.levels[k].objects.some(o => o.rootObject === 'Persistent_Level');
  }) || Object.keys(saveState.save.levels)[0];
  const mainLevel = saveState.save.levels[mainLevelKey];

  // Build pathName remapping
  const pathRemap = {};
  let counter = 0;

  for (const obj of cbpState.blueprintObjects) {
    if (obj.type !== 'SaveEntity' && obj.type !== 'SaveComponent') continue;
    const cls = obj.typePath?.split('.').pop() || 'Obj';
    const newId = `${sessionId}_${String(++counter).padStart(4, '0')}`;
    const baseName = `${cls}_${newId}`;
    if (obj.type === 'SaveEntity') {
      pathRemap[obj.instanceName] = `Persistent_Level:PersistentLevel.${baseName}`;
    }
  }
  // Remap components
  for (const obj of cbpState.blueprintObjects) {
    if (obj.type !== 'SaveComponent') continue;
    const parentNew = pathRemap[obj.parentEntityName];
    if (parentNew) {
      const compSuffix = obj.instanceName.split('.').pop();
      pathRemap[obj.instanceName] = `${parentNew}.${compSuffix}`;
    }
  }

  // Remap pathNames recursively in properties
  function remapPathNames(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(remapPathNames);
    const result = { ...obj };
    if (typeof result.pathName === 'string' && pathRemap[result.pathName]) {
      result.pathName = pathRemap[result.pathName];
    }
    for (const key of Object.keys(result)) {
      if (typeof result[key] === 'object' && result[key] !== null) {
        result[key] = remapPathNames(result[key]);
      }
    }
    return result;
  }

  const newObjects = [];

  for (const obj of cbpState.blueprintObjects) {
    const newName = pathRemap[obj.instanceName];
    if (!newName) continue;

    const clone = JSON.parse(JSON.stringify(obj));
    clone.instanceName = newName;
    clone.rootObject = 'Persistent_Level';
    clone.saveCustomVersion = saveCustomVersion;
    clone.shouldMigrateObjectRefsToPersistent = false;

    if (clone.type === 'SaveEntity') {
      // Apply placement transform to entity position
      if (clone.transform) {
        const lt = clone.transform.translation;
        const rx = lt.x * cosY - lt.y * sinY;
        const ry = lt.x * sinY + lt.y * cosY;
        clone.transform.translation = { x: rx + tx, y: ry + ty, z: lt.z + tz };

        // Compose yaw rotation with entity rotation
        const er = clone.transform.rotation;
        clone.transform.rotation = {
          x: yqw * er.x + yqz * er.y,
          y: yqw * er.y - yqz * er.x,
          z: yqw * er.z + yqz * er.w,
          w: yqw * er.w - yqz * er.z,
        };
      }

      clone.parentObject = { levelName: 'Persistent_Level', pathName: 'Persistent_Level:PersistentLevel.BuildableSubsystem' };
      clone.components = (clone.components || []).map(c => ({
        levelName: 'Persistent_Level',
        pathName: pathRemap[c.pathName] || c.pathName,
      }));
    }

    if (clone.type === 'SaveComponent') {
      clone.parentEntityName = pathRemap[obj.parentEntityName] || obj.parentEntityName;
    }

    // Remap pathNames in properties
    if (clone.properties) {
      clone.properties = remapPathNames(clone.properties);
    }

    newObjects.push(clone);
  }

  mainLevel.objects.push(...newObjects);
  console.log(`Injected ${newObjects.length} objects from blueprint into ${mainLevelKey}`);

  // Rebuild allObjects, entities, entityData
  saveState.allObjects = Object.values(saveState.save.levels).flatMap(l => l.objects);
  const SKIP_CLASSES = /FlowIndicator/;
  saveState.entities = saveState.allObjects.filter(o => {
    if (o.type !== 'SaveEntity' || !o.transform) return false;
    const cls = o.typePath.split('.').pop();
    return cls.startsWith('Build_') && !SKIP_CLASSES.test(cls);
  });

  const compByName = new Map();
  for (const obj of saveState.allObjects) {
    if (obj.type === 'SaveComponent') compByName.set(obj.instanceName, obj);
  }
  saveState.entityData = buildSaveEntityData(saveState.entities, saveState.lwInstances, compByName);
  saveState.items = [
    ...saveState.entities.map(e => ({ type: 'entity', entity: e })),
    ...saveState.lwInstances.map(lw => ({ type: 'lw', lw })),
  ];

  const entityCount = newObjects.filter(o => o.type === 'SaveEntity').length;
  console.log(`Inject complete: ${entityCount} entities, save updated`);
  return { injected: entityCount, entityData: saveState.entityData };
}

// ── Add a single entity to save in memory ───────────────────────────
function addEntity(typePath, position, rotation, properties) {
  if (!saveState) throw new Error('No save loaded');

  const { initSession, makeEntity, nextId, getSessionId } = require('../../satisfactoryLib');
  const Registry = require('../../lib/Registry');
  const registry = Registry.default();

  // Only init session once — initSession resets the counter
  const sessionId = getSessionId() || initSession();
  const cls = typePath.split('.').pop();
  const id = nextId();
  const inst = `Persistent_Level:PersistentLevel.${cls}_${sessionId}_${String(id).padStart(4, '0')}`;

  const rot = rotation || { x: 0, y: 0, z: 0, w: 1 };

  // Find main level
  const mainLevelKey = Object.keys(saveState.save.levels).find(k =>
    saveState.save.levels[k].objects.some(o => o.rootObject === 'Persistent_Level')
  ) || Object.keys(saveState.save.levels)[0];
  const mainLevel = saveState.save.levels[mainLevelKey];

  // Try to use the Registry Builder to create a proper entity with components
  const Builder = registry.get(cls);
  let entity;
  const newObjects = [];

  if (Builder?.create) {
    try {
      let result;
      if (cls.startsWith('Build_ConveyorLift')) {
        // ConveyorLift.create(bottomPos, height, bottomRot, topRot, tier)
        const height = properties?.height || 400;
        const topRot = properties?.topRot || { x: 0, y: 0, z: 0, w: 1 };
        const tierMatch = cls.match(/Mk(\d)/);
        const tier = tierMatch ? parseInt(tierMatch[1]) : 6;
        result = Builder.create(position, height, rot, topRot, tier);
      } else {
        result = Builder.create(position.x, position.y, position.z, rot);
      }
      entity = result.entity;
      const allObjs = result.allObjects();
      newObjects.push(...allObjs);
    } catch (e) {
      console.warn(`Builder.create failed for ${cls}, falling back to generic:`, e.message);
    }
  }

  if (!entity) {
    // Generic entity creation
    entity = makeEntity(typePath, inst);
    entity.transform = {
      translation: { x: position.x, y: position.y, z: position.z },
      rotation: rot,
      scale3d: { x: 1, y: 1, z: 1 },
    };
    if (properties) {
      entity.properties = JSON.parse(JSON.stringify(properties));
    }
    entity.components = [];
    newObjects.push(entity);
  }

  // Inject into save
  mainLevel.objects.push(...newObjects);

  // Update saveState
  saveState.allObjects = Object.values(saveState.save.levels).flatMap(l => l.objects);
  saveState.entities.push(entity);

  // Build component index for the new entity
  const compByName = new Map();
  for (const obj of newObjects) {
    if (obj.type === 'SaveComponent') compByName.set(obj.instanceName, obj);
  }

  // Build viewer item for this single entity
  const { item, classUpdate, isNewClass } = buildSingleEntityItem(
    entity, saveState.entityData, compByName
  );

  // Update entityData in place
  if (isNewClass) {
    saveState.entityData.classNames = classUpdate.classNames;
    saveState.entityData.clearance = classUpdate.clearance;
    saveState.entityData.portLayouts = classUpdate.portLayouts;
  }
  // Append to unified items array and entityData
  saveState.items.push({ type: 'entity', entity });
  const entityIndex = saveState.items.length - 1;
  saveState.entityData.entities.push(item);

  console.log(`Added entity ${cls} at (${position.x}, ${position.y}, ${position.z}) index=${entityIndex}`);

  return { entityIndex, item, classUpdate: isNewClass ? classUpdate : null, entity };
}

// ── Reconstruct a machine Builder from a save entity ────────────────
function getMachine(entityIndex) {
  if (!saveState) throw new Error('No save loaded');
  const item = saveState.items[entityIndex];
  if (!item) throw new Error(`Entity not found at index ${entityIndex}`);
  if (item.type === 'lw') throw new Error(`Index ${entityIndex} is a lightweight buildable, not a machine`);
  const entity = item.entity;

  const Registry = require('../../lib/Registry');
  const registry = Registry.default();
  const cls = entity.typePath.split('.').pop();
  const Builder = registry.get(cls);
  if (!Builder?.fromSave) throw new Error(`No Builder with fromSave for ${cls}`);

  return Builder.fromSave(entity, saveState.allObjects);
}

// ── Attach two ports (wire + snap) ──────────────────────────────────
function attachPorts(sourceIndex, sourcePort, targetIndex, targetPort) {
  if (!saveState) throw new Error('No save loaded');

  const srcMachine = getMachine(sourceIndex);
  const tgtMachine = getMachine(targetIndex);

  const srcPort = srcMachine.port(sourcePort);
  const tgtPort = tgtMachine.port(targetPort);

  // Lift↔Lift: use dedicated attachLift (cardinal snap + positioning + wire)
  const ConveyorLift = require('../../lib/logistic/ConveyorLift');
  if (srcMachine instanceof ConveyorLift && tgtMachine instanceof ConveyorLift) {
    // from=srcMachine (mobile), to=tgtMachine (fixed, adapts topTransform)
    tgtMachine.attachLift(targetPort, srcPort);
  } else {
    tgtPort.attach(srcPort);
  }

  // Update connection state in entityData for both entities
  updateEntityConnections(sourceIndex);
  updateEntityConnections(targetIndex);

  console.log(`Attached ${sourceIndex}:${sourcePort} → ${targetIndex}:${targetPort}`);
  return {
    source: { index: sourceIndex, connections: saveState.entityData.entities[sourceIndex].cn },
    target: { index: targetIndex, connections: saveState.entityData.entities[targetIndex].cn },
  };
}

// ── Wire two ports (logical connection only, no snap) ───────────────
function wirePorts(sourceIndex, sourcePort, targetIndex, targetPort) {
  if (!saveState) throw new Error('No save loaded');

  const srcMachine = getMachine(sourceIndex);
  const tgtMachine = getMachine(targetIndex);

  const srcPort = srcMachine.port(sourcePort);
  const tgtPort = tgtMachine.port(targetPort);

  srcPort.wire(tgtPort);

  updateEntityConnections(sourceIndex);
  updateEntityConnections(targetIndex);

  console.log(`Wired ${sourceIndex}:${sourcePort} → ${targetIndex}:${targetPort}`);
  return {
    source: { index: sourceIndex, connections: saveState.entityData.entities[sourceIndex].cn },
    target: { index: targetIndex, connections: saveState.entityData.entities[targetIndex].cn },
  };
}

// ── Refresh connection state for one entity in entityData ───────────
function updateEntityConnections(entityIndex) {
  const Registry = require('../../lib/Registry');
  const registry = Registry.default();
  const item = saveState.items[entityIndex];
  if (!item || item.type !== 'entity') return;
  const entity = item.entity;
  const cls = entity.typePath.split('.').pop();
  const Builder = registry.get(cls);

  // Get port names: from PORT_LAYOUT (static) or from entity ports (dynamic, e.g. ConveyorLift)
  let portNames;
  if (Builder?.PORT_LAYOUT) {
    portNames = Object.keys(Builder.PORT_LAYOUT).filter(k => Builder.PORT_LAYOUT[k].type !== 'power');
  } else {
    // Dynamic ports: check viewer item for port names
    const viewerItem = saveState.entityData.entities[entityIndex];
    if (viewerItem?.ports) {
      portNames = viewerItem.ports.map(p => p.n);
    } else {
      return;
    }
  }
  if (portNames.length === 0) return;

  const viewerItem = saveState.entityData.entities[entityIndex];
  const cn = [];
  for (let i = 0; i < portNames.length; i++) {
    const compPath = entity.instanceName + '.' + portNames[i];
    const comp = saveState.allObjects.find(o => o.instanceName === compPath);
    const connPath = comp?.properties?.mConnectedComponent?.value?.pathName;
    cn.push(connPath ? 1 : 0);

    // Infer flow for dynamic ports (ConveyorLift)
    if (connPath && viewerItem?.ports && viewerItem.ports[i]?.flow === -1) {
      const connPortName = connPath.split('.').pop();
      const connIsOutput = /^Output|ConveyorAny1$/.test(connPortName);
      const connIsInput = /^Input|ConveyorAny0$/.test(connPortName);
      if (connIsOutput) {
        viewerItem.ports[i].flow = 0;        // input
        if (viewerItem.ports[1 - i]) viewerItem.ports[1 - i].flow = 1;  // output
      } else if (connIsInput) {
        viewerItem.ports[i].flow = 1;        // output
        if (viewerItem.ports[1 - i]) viewerItem.ports[1 - i].flow = 0;  // input
      }
    }
  }
  viewerItem.cn = cn;
}

// ── Create a belt between two ports ──────────────────────────────────
function createBeltBetween(fromIdx, fromPort, toIdx, toPort, tier) {
  const ConveyorBelt = require('../../lib/logistic/ConveyorBelt');
  const srcMachine = getMachine(fromIdx);
  const tgtMachine = getMachine(toIdx);
  const srcPort = srcMachine.port(fromPort);
  const tgtPort = tgtMachine.port(toPort);

  const belt = ConveyorBelt.create(
    { pos: { ...srcPort.pos }, dir: srcPort.dir ? { ...srcPort.dir } : null },
    { pos: { ...tgtPort.pos }, dir: tgtPort.dir ? { ...tgtPort.dir } : null },
    typeof tier === 'number' ? tier : 6,
  );

  // Inject belt into save
  const mainLevelKey = Object.keys(saveState.save.levels).find(k =>
    saveState.save.levels[k].objects.some(o => o.rootObject === 'Persistent_Level')
  ) || Object.keys(saveState.save.levels)[0];
  const mainLevel = saveState.save.levels[mainLevelKey];
  const allObjs = belt.allObjects();
  mainLevel.objects.push(...allObjs);
  saveState.allObjects = Object.values(saveState.save.levels).flatMap(l => l.objects);
  saveState.entities.push(belt.entity);

  const compByName = new Map();
  for (const obj of allObjs) {
    if (obj.type === 'SaveComponent') compByName.set(obj.instanceName, obj);
  }
  const { item, classUpdate, isNewClass } = buildSingleEntityItem(belt.entity, saveState.entityData, compByName);
  if (isNewClass) {
    saveState.entityData.classNames = classUpdate.classNames;
    saveState.entityData.clearance = classUpdate.clearance;
    saveState.entityData.portLayouts = classUpdate.portLayouts;
  }
  saveState.items.push({ type: 'entity', entity: belt.entity });
  const beltIndex = saveState.items.length - 1;
  saveState.entityData.entities.push(item);

  // Wire: source → belt input, belt output → target
  const beltInput = belt.port(ConveyorBelt.Ports.INPUT);
  const beltOutput = belt.port(ConveyorBelt.Ports.OUTPUT);
  beltInput.attach(srcPort);
  beltOutput.attach(tgtPort);

  updateEntityConnections(fromIdx);
  updateEntityConnections(toIdx);
  updateEntityConnections(beltIndex);

  const beltId = `_belt_${fromIdx}_${toIdx}`;
  console.log(`Created belt ${beltId} index=${beltIndex} between ${fromIdx}:${fromPort} → ${toIdx}:${toPort}`);
  return { beltId, beltIndex, instanceName: belt.entity.instanceName, item, classUpdate: isNewClass ? classUpdate : null };
}

// ── Edit entities (add/update/delete) with connections ───────────────
function editEntities(batch) {
  if (!saveState) throw new Error('No save loaded');
  const { resolveTypePath } = require('./typeAliases');

  const anchor = batch.anchor || { x: 0, y: 0, z: 0 };
  const bpYawDeg = batch.rotation || 0;
  const bpYawRad = bpYawDeg * Math.PI / 180;
  const cosB = Math.cos(bpYawRad);
  const sinB = Math.sin(bpYawRad);

  // Yaw → quaternion helper (rotation around Z axis)
  function yawToQuat(deg) {
    const half = (deg * Math.PI / 180) / 2;
    return { x: 0, y: 0, z: Math.sin(half), w: Math.cos(half) };
  }

  // Compose two Z-only quaternions
  function composeYawQuats(q1, q2) {
    return {
      x: q1.w * q2.x + q1.z * q2.y,
      y: q1.w * q2.y - q1.z * q2.x,
      z: q1.w * q2.z + q1.z * q2.w,
      w: q1.w * q2.w - q1.z * q2.z,
    };
  }

  const bpQuat = yawToQuat(bpYawDeg);
  const idMap = {}; // local id → entity index
  const added = [];
  const updated = [];
  const deleted = [];

  for (const def of batch.entities) {
    // ── Delete ──
    if (def.deleted) {
      softDeleteEntity(def.index);
      deleted.push(def.index);
      continue;
    }

    // ── Update ──
    if (def.index !== undefined) {
      const result = updateEntity(def.index, def, anchor, bpYawDeg, cosB, sinB, bpQuat);
      if (def.id) idMap[def.id] = def.index;
      updated.push({
        id: def.id || null,
        index: def.index,
        item: result.item,
        classUpdate: result.classUpdate,
      });
      continue;
    }

    // ── Add ──
    const typePath = resolveTypePath(def.type);
    const rel = def.position || { x: 0, y: 0, z: 0 };

    // Rotate relative position by blueprint yaw
    const rx = rel.x * cosB - rel.y * sinB;
    const ry = rel.x * sinB + rel.y * cosB;
    const position = {
      x: anchor.x + rx,
      y: anchor.y + ry,
      z: anchor.z + (rel.z || 0),
    };

    // Compose blueprint rotation + entity rotation
    const entYawDeg = def.rotation || 0;
    const rotation = entYawDeg
      ? composeYawQuats(bpQuat, yawToQuat(entYawDeg))
      : bpQuat;

    const result = addEntity(typePath, position, rotation, def.properties);
    if (def.id) {
      idMap[def.id] = result.entityIndex;
    }
    added.push({
      id: def.id || null,
      index: result.entityIndex,
      instanceName: result.entity.instanceName,
      item: result.item,
      classUpdate: result.classUpdate,
    });
  }

  // Process connections — rollback added entities on failure
  const connectionResults = [];
  if (batch.connections) {
    try {
      for (const conn of batch.connections) {
        const [fromId, fromPort] = conn.from.split(':');
        const [toId, toPort] = conn.to.split(':');
        const fromIdx = idMap[fromId];
        const toIdx = idMap[toId];
        if (fromIdx === undefined) throw new Error(`Unknown entity id "${fromId}" in connection`);
        if (toIdx === undefined) throw new Error(`Unknown entity id "${toId}" in connection`);

        if (conn.belt) {
          // Auto-create a belt between the two ports
          const result = createBeltBetween(fromIdx, fromPort, toIdx, toPort, conn.belt);
          idMap[result.beltId] = result.beltIndex;
          added.push({ id: result.beltId, index: result.beltIndex, instanceName: result.instanceName, item: result.item, classUpdate: result.classUpdate });
          connectionResults.push({ from: conn.from, to: conn.to, belt: result.beltId });
        } else {
          const result = attachPorts(fromIdx, fromPort, toIdx, toPort);
          connectionResults.push({ from: conn.from, to: conn.to, ...result });
        }
      }
    } catch (err) {
      // Rollback: delete added entities
      const indicesToDelete = added.map(r => r.index);
      deleteEntities(indicesToDelete);
      console.log(`Edit rollback: deleted ${indicesToDelete.length} entities after error: ${err.message}`);
      throw err;
    }
  }

  // Rebuild viewer items for entities that may have been repositioned by connections
  if (connectionResults.length > 0) {
    const touchedIndices = new Set();
    for (const r of connectionResults) {
      if (r.source) touchedIndices.add(r.source.index);
      if (r.target) touchedIndices.add(r.target.index);
    }
    for (const idx of touchedIndices) {
      const itm = saveState.items[idx];
      if (!itm || itm.type !== 'entity') continue;
      const compByName = new Map();
      for (const obj of saveState.allObjects) {
        if (obj.type === 'SaveComponent' && obj.parentEntityName === itm.entity.instanceName) {
          compByName.set(obj.instanceName, obj);
        }
      }
      const { item: newItem, classUpdate, isNewClass } = buildSingleEntityItem(itm.entity, saveState.entityData, compByName);
      if (isNewClass) {
        saveState.entityData.classNames = classUpdate.classNames;
        saveState.entityData.clearance = classUpdate.clearance;
        saveState.entityData.portLayouts = classUpdate.portLayouts;
      }
      saveState.entityData.entities[idx] = newItem;
      // Update the item in added/updated results
      const addedEntry = added.find(a => a.index === idx);
      if (addedEntry) { addedEntry.item = newItem; addedEntry.classUpdate = isNewClass ? classUpdate : addedEntry.classUpdate; }
      const updatedEntry = updated.find(u => u.index === idx);
      if (updatedEntry) { updatedEntry.item = newItem; updatedEntry.classUpdate = isNewClass ? classUpdate : updatedEntry.classUpdate; }
    }
  }

  console.log(`Edit: +${added.length} ~${updated.length} -${deleted.length}, ${connectionResults.length} connections`);
  return { added, updated, deleted, connections: connectionResults };
}

// ── Soft delete: null out the slot, remove from save levels ─────────
function softDeleteEntity(index) {
  if (!saveState) throw new Error('No save loaded');
  const item = saveState.items[index];
  if (!item) throw new Error(`No entity at index ${index}`);

  if (item.type === 'entity') {
    const name = item.entity.instanceName;
    for (const level of Object.values(saveState.save.levels)) {
      level.objects = level.objects.filter(o => {
        if (o.type === 'SaveEntity' && o.instanceName === name) return false;
        if (o.type === 'SaveComponent' && o.parentEntityName === name) return false;
        return true;
      });
    }
  }
  // TODO: handle lightweight delete if needed

  // Null out slots — indices stay stable
  saveState.items[index] = null;
  saveState.entityData.entities[index] = null;

  saveState.allObjects = Object.values(saveState.save.levels).flatMap(l => l.objects);
}

// ── Update entity position/rotation/properties ──────────────────────
function updateEntity(index, def, anchor, bpYawDeg, cosB, sinB, bpQuat) {
  if (!saveState) throw new Error('No save loaded');
  const item = saveState.items[index];
  if (!item || !item.entity) throw new Error(`No entity at index ${index}`);

  const entity = item.entity;

  // Update position if provided
  if (def.position) {
    const rel = def.position;
    const rx = rel.x * cosB - rel.y * sinB;
    const ry = rel.x * sinB + rel.y * cosB;
    entity.transform.translation = {
      x: anchor.x + rx,
      y: anchor.y + ry,
      z: anchor.z + (rel.z || 0),
    };
  }

  // Update rotation if provided
  if (def.rotation !== undefined) {
    function yawToQuat(deg) {
      const half = (deg * Math.PI / 180) / 2;
      return { x: 0, y: 0, z: Math.sin(half), w: Math.cos(half) };
    }
    function composeYawQuats(q1, q2) {
      return {
        x: q1.w * q2.x + q1.z * q2.y,
        y: q1.w * q2.y - q1.z * q2.x,
        z: q1.w * q2.z + q1.z * q2.w,
        w: q1.w * q2.w - q1.z * q2.z,
      };
    }
    entity.transform.rotation = def.rotation
      ? composeYawQuats(bpQuat, yawToQuat(def.rotation))
      : bpQuat;
  }

  // Update properties if provided
  if (def.properties) {
    Object.assign(entity.properties, def.properties);
  }

  // Rebuild viewer item
  const compByName = new Map();
  for (const obj of saveState.allObjects) {
    if (obj.type === 'SaveComponent' && obj.parentEntityName === entity.instanceName) {
      compByName.set(obj.instanceName, obj);
    }
  }
  const { item: viewerItem, classUpdate, isNewClass } = buildSingleEntityItem(entity, saveState.entityData, compByName);
  if (isNewClass) {
    saveState.entityData.classNames = classUpdate.classNames;
    saveState.entityData.clearance = classUpdate.clearance;
    saveState.entityData.portLayouts = classUpdate.portLayouts;
  }
  saveState.entityData.entities[index] = viewerItem;

  return { item: viewerItem, classUpdate: isNewClass ? classUpdate : null };
}

// ── Move player position ───────────────────────────────────────────
function setPlayerPosition(position) {
  if (!saveState) throw new Error('No save loaded');
  const charObj = saveState.allObjects.find(o => o.typePath?.includes('Char_Player_C') && o.transform);
  if (!charObj) throw new Error('Player character not found in save');
  charObj.transform.translation = { x: position.x, y: position.y, z: position.z };
  console.log(`Player moved to (${position.x}, ${position.y}, ${position.z})`);
}

// ── Serialize save to buffer (for export) ──────────────────────────
function serializeSave() {
  if (!saveState) throw new Error('No save loaded');
  let headerBuf;
  const bodyChunks = [];
  Parser.WriteSave(saveState.save, h => { headerBuf = h; }, c => { bodyChunks.push(c); });
  return Buffer.concat([headerBuf, ...bodyChunks]);
}

module.exports = { loadSave, loadCbp, loadBlueprint, getSaveState, getCbpState, getHeightmapData, deleteEntities, injectBlueprint, addEntity, attachPorts, wirePorts, editEntities, setPlayerPosition, serializeSave };
