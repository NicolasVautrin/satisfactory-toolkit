/**
 * Entity editor — add, update, delete, connect, insert, clearance check.
 * Operates on the saveState managed by saveManager.js.
 */
const { getSaveState, addItem, deleteEntities, ensureSaveState } = require('./saveManager');
const { buildViewerEntityFromEditor } = require('./viewerEntityFactory');

// ── Yaw helpers ─────────────────────────────────────────────────────
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

// ── Add a single entity to save in memory ───────────────────────────
function addEntity(typePath, position, rotation, properties) {
  const saveState = getSaveState();
  if (!saveState) throw new Error('No save loaded');

  const { initSession, makeEntity, nextId, getSessionId } = require('../../satisfactoryLib');
  const Registry = require('../../lib/Registry');
  const registry = Registry.default();

  const sessionId = getSessionId() || initSession();
  const cls = typePath.split('.').pop();
  const id = nextId();
  const inst = `Persistent_Level:PersistentLevel.${cls}_${sessionId}_${String(id).padStart(4, '0')}`;

  const rot = rotation || { x: 0, y: 0, z: 0, w: 1 };

  const mainLevelKey = Object.keys(saveState.save.levels).find(k =>
    saveState.save.levels[k].objects.some(o => o.rootObject === 'Persistent_Level')
  ) || Object.keys(saveState.save.levels)[0];
  const mainLevel = saveState.save.levels[mainLevelKey];

  const Builder = registry.get(cls);
  let entity;
  const newObjects = [];

  if (Builder?.create) {
    try {
      let result;
      if (cls.startsWith('Build_ConveyorLift')) {
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

  mainLevel.objects.push(...newObjects);
  saveState.allObjects = Object.values(saveState.save.levels).flatMap(l => l.objects);
  saveState.entities.push(entity);

  const compByName = new Map();
  for (const obj of newObjects) {
    if (obj.type === 'SaveComponent') compByName.set(obj.instanceName, obj);
  }
  const { item, classUpdate, isNewClass } = buildViewerEntityFromEditor(entity, saveState.viewerEntityRepository, compByName);
  if (isNewClass) {
    saveState.viewerEntityRepository.classNames = classUpdate.classNames;
    saveState.viewerEntityRepository.clearance = classUpdate.clearance;
    saveState.viewerEntityRepository.portLayouts = classUpdate.portLayouts;
  }
  const entityIndex = addItem(entity);
  saveState.viewerEntityRepository.entities.push(item);

  console.log(`Added entity ${cls} at (${position.x}, ${position.y}, ${position.z}) index=${entityIndex}`);
  return { entityIndex, item, classUpdate: isNewClass ? classUpdate : null, entity };
}

// ── Reconstruct a machine Builder from a save entity ────────────────
function getEntity(entityIndex) {
  const saveState = getSaveState();
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

  const builder = Builder.fromSave(entity, saveState.allObjects);

  const FlowPort = require('../../lib/shared/FlowPort');
  for (const port of Object.values(builder._ports)) {
    const connPath = port.component?.properties?.mConnectedComponent?.value?.pathName;
    if (connPath) {
      const connComp = saveState.allObjects.find(o => o.instanceName === connPath);
      if (connComp) {
        const stub = new FlowPort(connComp, null, null);
        stub.pathName = connPath;
        port._wiredTo = stub;
      }
    }
    if (port._snapPropName) {
      const snappedPath = port.component?.properties?.[port._snapPropName]?.value?.pathName;
      if (snappedPath) {
        port._snappedTo = { pathName: snappedPath };
      }
    }
  }

  return builder;
}

// ── Attach two ports (wire + snap) ──────────────────────────────────
function attachPorts(sourceIndex, sourcePort, targetIndex, targetPort) {
  const saveState = getSaveState();
  if (!saveState) throw new Error('No save loaded');

  const srcMachine = getEntity(sourceIndex);
  const tgtMachine = getEntity(targetIndex);

  const srcPort = srcMachine.port(sourcePort);
  const tgtPort = tgtMachine.port(targetPort);

  const ConveyorLift = require('../../lib/logistic/ConveyorLift');
  if (srcMachine instanceof ConveyorLift && tgtMachine instanceof ConveyorLift) {
    tgtMachine.attachLift(targetPort, srcPort);
  } else {
    srcPort.attach(tgtPort);
  }

  updateEntityConnections(sourceIndex);
  updateEntityConnections(targetIndex);

  console.log(`Attached ${sourceIndex}:${sourcePort} → ${targetIndex}:${targetPort}`);
  return {
    source: { index: sourceIndex, connections: saveState.viewerEntityRepository.entities[sourceIndex].cn },
    target: { index: targetIndex, connections: saveState.viewerEntityRepository.entities[targetIndex].cn },
  };
}

// ── Wire two ports (logical connection only, no snap) ───────────────
function wirePorts(sourceIndex, sourcePort, targetIndex, targetPort) {
  const saveState = getSaveState();
  if (!saveState) throw new Error('No save loaded');

  const srcMachine = getEntity(sourceIndex);
  const tgtMachine = getEntity(targetIndex);

  const srcPort = srcMachine.port(sourcePort);
  const tgtPort = tgtMachine.port(targetPort);

  srcPort.wire(tgtPort);

  updateEntityConnections(sourceIndex);
  updateEntityConnections(targetIndex);

  console.log(`Wired ${sourceIndex}:${sourcePort} → ${targetIndex}:${targetPort}`);
  return {
    source: { index: sourceIndex, connections: saveState.viewerEntityRepository.entities[sourceIndex].cn },
    target: { index: targetIndex, connections: saveState.viewerEntityRepository.entities[targetIndex].cn },
  };
}

// ── Refresh connection state for one entity in viewerEntityRepository ───────────
function updateEntityConnections(entityIndex) {
  const saveState = getSaveState();
  const Registry = require('../../lib/Registry');
  const registry = Registry.default();
  const item = saveState.items[entityIndex];
  if (!item || item.type !== 'entity') return;
  const entity = item.entity;
  const cls = entity.typePath.split('.').pop();
  const Builder = registry.get(cls);

  let portNames;
  if (Builder?.PORT_LAYOUT) {
    portNames = Object.keys(Builder.PORT_LAYOUT).filter(k => Builder.PORT_LAYOUT[k].type !== 'power');
  } else {
    const viewerItem = saveState.viewerEntityRepository.entities[entityIndex];
    if (viewerItem?.ports) {
      portNames = viewerItem.ports.map(p => p.n);
    }
  }
  if (!portNames) return;

  const cn = portNames.map(name => {
    const compSuffix = name;
    const compPath = `${entity.instanceName}.${compSuffix}`;
    const comp = saveState.allObjects.find(o => o.instanceName === compPath);
    return comp?.properties?.mConnectedComponent?.value?.pathName ? 1 : 0;
  });
  saveState.viewerEntityRepository.entities[entityIndex].cn = cn;
}

// ── Create a belt between two ports ──────────────────────────────────
function createBeltBetween(fromIdx, fromPort, toIdx, toPort, tier) {
  const saveState = getSaveState();
  const ConveyorBelt = require('../../lib/logistic/ConveyorBelt');
  const srcMachine = getEntity(fromIdx);
  const tgtMachine = getEntity(toIdx);
  const srcPort = srcMachine.port(fromPort);
  const tgtPort = tgtMachine.port(toPort);

  const wSrcPos = srcPort.worldPos(), wSrcDir = srcPort.worldDir();
  const wTgtPos = tgtPort.worldPos(), wTgtDir = tgtPort.worldDir();
  const belt = ConveyorBelt.create(
    { pos: { ...wSrcPos }, dir: wSrcDir ? { ...wSrcDir } : null },
    { pos: { ...wTgtPos }, dir: wTgtDir ? { ...wTgtDir } : null },
    typeof tier === 'number' ? tier : 6,
  );

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
  const { item, classUpdate, isNewClass } = buildViewerEntityFromEditor(belt.entity, saveState.viewerEntityRepository, compByName);
  if (isNewClass) {
    saveState.viewerEntityRepository.classNames = classUpdate.classNames;
    saveState.viewerEntityRepository.clearance = classUpdate.clearance;
    saveState.viewerEntityRepository.portLayouts = classUpdate.portLayouts;
  }
  const beltIndex = addItem(belt.entity);
  saveState.viewerEntityRepository.entities.push(item);

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

// ── Create a pipe between two ports ─────────────────────────────────
function createPipeBetween(fromIdx, fromPort, toIdx, toPort, tier) {
  const saveState = getSaveState();
  const Pipe = require('../../lib/logistic/Pipe');
  const srcMachine = getEntity(fromIdx);
  const tgtMachine = getEntity(toIdx);
  const srcPort = srcMachine.port(fromPort);
  const tgtPort = tgtMachine.port(toPort);

  const wSrcPos = srcPort.worldPos(), wSrcDir = srcPort.worldDir();
  const wTgtPos = tgtPort.worldPos(), wTgtDir = tgtPort.worldDir();
  const pipe = Pipe.create(
    { pos: { ...wSrcPos }, dir: wSrcDir ? { ...wSrcDir } : null },
    { pos: { ...wTgtPos }, dir: wTgtDir ? { ...wTgtDir } : null },
    typeof tier === 'number' ? tier : 2,
  );

  const mainLevelKey = Object.keys(saveState.save.levels).find(k =>
    saveState.save.levels[k].objects.some(o => o.rootObject === 'Persistent_Level')
  ) || Object.keys(saveState.save.levels)[0];
  const mainLevel = saveState.save.levels[mainLevelKey];
  const allObjs = pipe.allObjects();
  mainLevel.objects.push(...allObjs);
  saveState.allObjects = Object.values(saveState.save.levels).flatMap(l => l.objects);
  saveState.entities.push(pipe.entity);

  const compByName = new Map();
  for (const obj of allObjs) {
    if (obj.type === 'SaveComponent') compByName.set(obj.instanceName, obj);
  }
  const { item, classUpdate, isNewClass } = buildViewerEntityFromEditor(pipe.entity, saveState.viewerEntityRepository, compByName);
  if (isNewClass) {
    saveState.viewerEntityRepository.classNames = classUpdate.classNames;
    saveState.viewerEntityRepository.clearance = classUpdate.clearance;
    saveState.viewerEntityRepository.portLayouts = classUpdate.portLayouts;
  }
  const pipeIndex = addItem(pipe.entity);
  saveState.viewerEntityRepository.entities.push(item);

  const pipeConn0 = pipe.port('PipelineConnection0');
  const pipeConn1 = pipe.port('PipelineConnection1');
  pipeConn0.attach(srcPort);
  pipeConn1.attach(tgtPort);

  updateEntityConnections(fromIdx);
  updateEntityConnections(toIdx);
  updateEntityConnections(pipeIndex);

  const beltId = `_pipe_${fromIdx}_${toIdx}`;
  console.log(`Created pipe ${beltId} index=${pipeIndex} between ${fromIdx}:${fromPort} → ${toIdx}:${toPort}`);
  return { beltId, beltIndex: pipeIndex, instanceName: pipe.entity.instanceName, item, classUpdate: isNewClass ? classUpdate : null };
}

// ── Insert entity onto a spline (belt/pipe), cutting it in two ──────
function insertOnSpline(entityIndex, splineIndex, position, reverse) {
  const saveState = getSaveState();
  const splineItem = saveState.items[splineIndex];
  if (!splineItem || splineItem.type !== 'entity') throw new Error(`No spline entity at index ${splineIndex}`);

  const entityItem = saveState.items[entityIndex];
  if (!entityItem || entityItem.type !== 'entity') throw new Error(`No entity at index ${entityIndex}`);

  const splineBuilder = getEntity(splineIndex);
  const entityBuilder = getEntity(entityIndex);

  let newSpline;
  if (entityBuilder.attachBelt && splineBuilder.constructor.IS_SPLINE && splineBuilder._ports?.ConveyorAny0) {
    newSpline = entityBuilder.attachBelt(splineBuilder, position);
  } else if (entityBuilder.attachPipe && splineBuilder.constructor.IS_SPLINE && splineBuilder._ports?.PipelineConnection0) {
    newSpline = entityBuilder.attachPipe(splineBuilder, position, reverse);
  } else {
    throw new Error(`Cannot insert ${entityBuilder.constructor.name} on ${splineBuilder.constructor.name}`);
  }

  const mainLevelKey = Object.keys(saveState.save.levels).find(k =>
    saveState.save.levels[k].objects.some(o => o.rootObject === 'Persistent_Level')
  ) || Object.keys(saveState.save.levels)[0];
  const mainLevel = saveState.save.levels[mainLevelKey];
  const allObjs = newSpline.allObjects();
  mainLevel.objects.push(...allObjs);
  saveState.allObjects = Object.values(saveState.save.levels).flatMap(l => l.objects);
  saveState.entities.push(newSpline.entity);

  const compByName = new Map();
  for (const obj of allObjs) {
    if (obj.type === 'SaveComponent') compByName.set(obj.instanceName, obj);
  }

  // Rebuild viewer items for the insertion entity and the new spline
  const { item: insertItem, classUpdate: insertCU, isNewClass: insertNew } = buildViewerEntityFromEditor(entityItem.entity, saveState.viewerEntityRepository, compByName);
  if (insertNew) {
    saveState.viewerEntityRepository.classNames = insertCU.classNames;
    saveState.viewerEntityRepository.clearance = insertCU.clearance;
    saveState.viewerEntityRepository.portLayouts = insertCU.portLayouts;
  }
  saveState.viewerEntityRepository.entities[entityIndex] = insertItem;

  const { item: splineViewItem, classUpdate: splineCU, isNewClass: splineNew } = buildViewerEntityFromEditor(newSpline.entity, saveState.viewerEntityRepository, compByName);
  if (splineNew) {
    saveState.viewerEntityRepository.classNames = splineCU.classNames;
    saveState.viewerEntityRepository.clearance = splineCU.clearance;
    saveState.viewerEntityRepository.portLayouts = splineCU.portLayouts;
  }
  const newSplineIndex = addItem(newSpline.entity);
  saveState.viewerEntityRepository.entities.push(splineViewItem);

  // Rebuild the original spline's viewer item
  const origCompByName = new Map();
  for (const obj of saveState.allObjects) {
    if (obj.type === 'SaveComponent' && obj.parentEntityName === splineItem.entity.instanceName) {
      origCompByName.set(obj.instanceName, obj);
    }
  }
  const { item: origItem } = buildViewerEntityFromEditor(splineItem.entity, saveState.viewerEntityRepository, origCompByName);
  saveState.viewerEntityRepository.entities[splineIndex] = origItem;

  const newSplineId = `_spline_${newSplineIndex}`;
  console.log(`Inserted ${entityBuilder.constructor.name} on spline index=${splineIndex}, new spline index=${newSplineIndex}`);
  return { newSplineId, newSplineIndex, instanceName: newSpline.entity.instanceName, item: splineViewItem, classUpdate: splineNew ? splineCU : null };
}

// ── Soft delete: null out the slot, remove from save levels ─────────
function softDeleteEntity(index) {
  const saveState = getSaveState();
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

  saveState.items[index] = null;
  saveState.viewerEntityRepository.entities[index] = null;
  saveState.allObjects = Object.values(saveState.save.levels).flatMap(l => l.objects);
}

// ── Update entity position/rotation/properties ──────────────────────
function updateEntity(index, def, anchor, bpYawDeg, cosB, sinB, bpQuat) {
  const saveState = getSaveState();
  if (!saveState) throw new Error('No save loaded');
  const item = saveState.items[index];
  if (!item || !item.entity) throw new Error(`No entity at index ${index}`);

  const entity = item.entity;

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

  if (def.rotation !== undefined) {
    entity.transform.rotation = def.rotation
      ? composeYawQuats(bpQuat, yawToQuat(def.rotation))
      : bpQuat;
  }

  if (def.properties) {
    Object.assign(entity.properties, def.properties);
  }

  const compByName = new Map();
  for (const obj of saveState.allObjects) {
    if (obj.type === 'SaveComponent' && obj.parentEntityName === entity.instanceName) {
      compByName.set(obj.instanceName, obj);
    }
  }
  const { item: viewerItem, classUpdate, isNewClass } = buildViewerEntityFromEditor(entity, saveState.viewerEntityRepository, compByName);
  if (isNewClass) {
    saveState.viewerEntityRepository.classNames = classUpdate.classNames;
    saveState.viewerEntityRepository.clearance = classUpdate.clearance;
    saveState.viewerEntityRepository.portLayouts = classUpdate.portLayouts;
  }
  saveState.viewerEntityRepository.entities[index] = viewerItem;

  return { item: viewerItem, classUpdate: isNewClass ? classUpdate : null };
}

// ── Process entity definitions (add/update/delete) ──────────────────
function processEntityDefs(batch, idMap, added, updated, deleted) {
  const { resolveTypePath } = require('./typeAliases');
  const anchor = batch.anchor || { x: 0, y: 0, z: 0 };
  const bpYawDeg = batch.rotation || 0;
  const bpYawRad = bpYawDeg * Math.PI / 180;
  const cosB = Math.cos(bpYawRad);
  const sinB = Math.sin(bpYawRad);
  const bpQuat = yawToQuat(bpYawDeg);

  for (const def of batch.entities) {
    if (def.deleted) {
      softDeleteEntity(def.index);
      deleted.push(def.index);
      continue;
    }

    if (def.index !== undefined) {
      const result = updateEntity(def.index, def, anchor, bpYawDeg, cosB, sinB, bpQuat);
      if (def.id) idMap[def.id] = def.index;
      updated.push({ id: def.id || null, index: def.index, item: result.item, classUpdate: result.classUpdate });
      continue;
    }

    const typePath = resolveTypePath(def.type);
    const rel = def.position || { x: 0, y: 0, z: 0 };
    const rx = rel.x * cosB - rel.y * sinB;
    const ry = rel.x * sinB + rel.y * cosB;
    const position = { x: anchor.x + rx, y: anchor.y + ry, z: anchor.z + (rel.z || 0) };
    const entYawDeg = def.rotation || 0;
    const rotation = entYawDeg ? composeYawQuats(bpQuat, yawToQuat(entYawDeg)) : bpQuat;

    const result = addEntity(typePath, position, rotation, def.properties);
    if (def.id) idMap[def.id] = result.entityIndex;
    added.push({ id: def.id || null, index: result.entityIndex, instanceName: result.entity.instanceName, item: result.item, classUpdate: result.classUpdate });

    // Defer topDir for lifts — must be applied after connections reposition the lift
    if (def.properties?.topDir && typePath.includes('ConveyorLift')) {
      if (!batch._pendingTopDirs) batch._pendingTopDirs = [];
      batch._pendingTopDirs.push({ index: result.entityIndex, topDir: def.properties.topDir });
    }
  }
}

// ── Process connections (direct, belt, pipe, insertion) ──────────────
function processConnections(connections, idMap, added) {
  const saveState = getSaveState();
  const results = [];
  for (const conn of connections) {
    if (conn.on !== undefined) {
      const entityIdx = idMap[conn.from];
      const splineIdx = idMap[conn.on];
      if (entityIdx === undefined) throw new Error(`Unknown entity id "${conn.from}" in insertion`);
      if (splineIdx === undefined) throw new Error(`Unknown entity id "${conn.on}" in insertion`);
      const pos = conn.position || saveState.items[entityIdx].entity.transform.translation;
      const result = insertOnSpline(entityIdx, splineIdx, pos, conn.reverse);
      idMap[result.newSplineId] = result.newSplineIndex;
      added.push({ id: result.newSplineId, index: result.newSplineIndex, instanceName: result.instanceName, item: result.item, classUpdate: result.classUpdate });
      results.push({ from: conn.from, on: conn.on, newSpline: result.newSplineId });
      continue;
    }

    const [fromId, fromPort] = conn.from.split(':');
    const [toId, toPort] = conn.to.split(':');
    const fromIdx = idMap[fromId];
    const toIdx = idMap[toId];
    if (fromIdx === undefined) throw new Error(`Unknown entity id "${fromId}" in connection`);
    if (toIdx === undefined) throw new Error(`Unknown entity id "${toId}" in connection`);

    if (conn.belt) {
      const result = createBeltBetween(fromIdx, fromPort, toIdx, toPort, conn.belt);
      idMap[result.beltId] = result.beltIndex;
      added.push({ id: result.beltId, index: result.beltIndex, instanceName: result.instanceName, item: result.item, classUpdate: result.classUpdate });
      results.push({ from: conn.from, to: conn.to, belt: result.beltId });
    } else if (conn.pipe) {
      const result = createPipeBetween(fromIdx, fromPort, toIdx, toPort, conn.pipe);
      idMap[result.beltId] = result.beltIndex;
      added.push({ id: result.beltId, index: result.beltIndex, instanceName: result.instanceName, item: result.item, classUpdate: result.classUpdate });
      results.push({ from: conn.from, to: conn.to, pipe: result.beltId });
    } else {
      const result = attachPorts(fromIdx, fromPort, toIdx, toPort);
      results.push({ from: conn.from, to: conn.to, ...result });
    }
  }
  return results;
}

// ── Rebuild viewer items for entities repositioned by connections ────
function rebuildTouchedItems(connectionResults, added, updated) {
  const saveState = getSaveState();
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
    const { item: newItem, classUpdate, isNewClass } = buildViewerEntityFromEditor(itm.entity, saveState.viewerEntityRepository, compByName);
    if (isNewClass) {
      saveState.viewerEntityRepository.classNames = classUpdate.classNames;
      saveState.viewerEntityRepository.clearance = classUpdate.clearance;
      saveState.viewerEntityRepository.portLayouts = classUpdate.portLayouts;
    }
    saveState.viewerEntityRepository.entities[idx] = newItem;
    const addedEntry = added.find(a => a.index === idx);
    if (addedEntry) { addedEntry.item = newItem; addedEntry.classUpdate = isNewClass ? classUpdate : addedEntry.classUpdate; }
    const updatedEntry = updated.find(u => u.index === idx);
    if (updatedEntry) { updatedEntry.item = newItem; updatedEntry.classUpdate = isNewClass ? classUpdate : updatedEntry.classUpdate; }
  }
}

// ── Validate clearance overlaps ─────────────────────────────────────
function validateClearance(added, updated) {
  const saveState = getSaveState();
  const { checkClearance, formatCollisions } = require('../../lib/shared/Clearance');
  const Registry = require('../../lib/Registry');
  const registry = Registry.default();

  const batchEntities = [];
  for (const entry of [...added, ...updated]) {
    const item = saveState.items[entry.index];
    if (!item || item.type !== 'entity') continue;
    const cls = item.entity.typePath.split('.').pop();
    const Builder = registry.get(cls);
    if (Builder?.IS_SPLINE) continue;
    batchEntities.push({ id: entry.id || `index ${entry.index}`, entity: item.entity });
  }

  if (batchEntities.length === 0) return;

  const excludeIndices = new Set();
  for (const entry of [...added, ...updated]) excludeIndices.add(entry.index);

  const collisions = checkClearance(batchEntities, saveState, excludeIndices);
  if (collisions.length > 0) {
    const indicesToDelete = added.map(r => r.index);
    deleteEntities(indicesToDelete);
    console.log(`Edit rollback: deleted ${indicesToDelete.length} entities after clearance error`);
    throw new Error(formatCollisions(collisions));
  }
}

// ── Main edit orchestrator ──────────────────────────────────────────
function editEntities(batch) {
  ensureSaveState();

  const idMap = {};
  const added = [];
  const updated = [];
  const deleted = [];

  processEntityDefs(batch, idMap, added, updated, deleted);

  let connectionResults = [];
  if (batch.connections) {
    try {
      connectionResults = processConnections(batch.connections, idMap, added);
    } catch (err) {
      const indicesToDelete = added.map(r => r.index);
      deleteEntities(indicesToDelete);
      console.log(`Edit rollback: deleted ${indicesToDelete.length} entities after error: ${err.message}`);
      throw err;
    }
  }

  // Apply deferred topDir for lifts (after connections repositioned them)
  // topDir is the arm direction in entity-local space
  if (batch._pendingTopDirs) {
    const ConveyorLift = require('../../lib/logistic/ConveyorLift');
    for (const { index, topDir } of batch._pendingTopDirs) {
      const lift = getEntity(index);
      if (lift instanceof ConveyorLift) {
        lift.setTopDir(topDir);
      }
    }
  }

  if (connectionResults.length > 0) {
    rebuildTouchedItems(connectionResults, added, updated);
  }

  if (!batch.skipClearance) {
    validateClearance(added, updated);
  }

  console.log(`Edit: +${added.length} ~${updated.length} -${deleted.length}, ${connectionResults.length} connections`);
  return { added, updated, deleted, connections: connectionResults };
}

module.exports = { editEntities, addEntity, getEntity, attachPorts, wirePorts, insertOnSpline };
