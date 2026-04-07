/**
 * Entity editor — add, update, delete, connect, insert, clearance check.
 * Operates on the saveState managed by saveManager.js.
 */
const { getSaveState, addItem, deleteEntities, ensureSaveState } = require('./saveManager');
const { buildViewerEntityFromEditor, isPortConnected } = require('./viewerEntityFactory');
const splineLimits = require('../../data/splineLimits.json');

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

// ── Label helper ───────────────────────────────────────────────────
function applyLabel(entity, id, label, item) {
  if (!id) return;
  entity.properties.mLabel = {
    type: 'StrProperty', ueType: 'StrProperty', name: 'mLabel', value: id,
  };
  if (item) {
    item.lb = id;
    if (label) item.cssLb = true;
  }
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
        let topRot = properties?.topRot || { x: 0, y: 0, z: 0, w: 1 };
        if (properties?.topDir) {
          const Quaternion = require('../../lib/shared/Quaternion');
          topRot = Quaternion.fromLocalToWorldZ({ x: 1, y: 0 }, properties.topDir).toPlain();
        }
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

// ── Reconstruct an entity Builder from a save entity ────────────────
function getEntity(entityIndex) {
  const saveState = getSaveState();
  if (!saveState) throw new Error('No save loaded');
  const item = saveState.items[entityIndex];
  if (!item) throw new Error(`Entity not found at index ${entityIndex}`);
  if (item.type === 'lw') throw new Error(`Index ${entityIndex} is a lightweight buildable, not an entity`);
  const entity = item.entity;

  const Registry = require('../../lib/Registry');
  const registry = Registry.default();
  const cls = entity.typePath.split('.').pop();
  const Builder = registry.get(cls);
  if (!Builder?.fromSave) throw new Error(`No Builder with fromSave for ${cls}`);

  const builder = Builder.fromSave(entity, saveState.allObjects);

  const FlowPort = require('../../lib/shared/FlowPort');
  for (const port of Object.values(builder._ports)) {
    const connPath = port.component?.properties?.mConnectedComponent?.value?.pathName
      || port.component?.properties?.mConnectedComponents?.values?.[0]?.pathName;
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
        port._snappedBy.push({ pathName: snappedPath });
      }
    }
  }

  return builder;
}

// ── Attach two ports (wire + snap) ──────────────────────────────────
function attachPorts(sourceIndex, sourcePort, targetIndex, targetPort) {
  const saveState = getSaveState();
  if (!saveState) throw new Error('No save loaded');

  const srcEntity = getEntity(sourceIndex);
  const tgtEntity = getEntity(targetIndex);

  const ConveyorLift = require('../../lib/logistic/ConveyorLift');
  if (srcEntity instanceof ConveyorLift && tgtEntity instanceof ConveyorLift) {
    const srcPort = srcEntity.port(sourcePort);
    tgtEntity.attachLift(targetPort, srcPort);
  } else {
    srcEntity.connectPorts(sourcePort, tgtEntity, targetPort);
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

  const srcEntity = getEntity(sourceIndex);
  const tgtEntity = getEntity(targetIndex);

  const srcPort = srcEntity.port(sourcePort);
  const tgtPort = tgtEntity.port(targetPort);

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
    return isPortConnected(comp) ? 1 : 0;
  });
  saveState.viewerEntityRepository.entities[entityIndex].cn = cn;
}

// ── Spline validation (delegated to lib/shared) ──────────────────
const { validateSplineShape, validateSplineLength } = require('../../lib/shared/validateSpline');

function dist3D(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

// ── Inject a spline entity into the save + viewer ────────────────────
function injectSplineEntity(builder) {
  const saveState = getSaveState();
  const mainLevelKey = Object.keys(saveState.save.levels).find(k =>
    saveState.save.levels[k].objects.some(o => o.rootObject === 'Persistent_Level')
  ) || Object.keys(saveState.save.levels)[0];
  const mainLevel = saveState.save.levels[mainLevelKey];
  const allObjs = builder.allObjects();
  mainLevel.objects.push(...allObjs);
  saveState.allObjects = Object.values(saveState.save.levels).flatMap(l => l.objects);
  saveState.entities.push(builder.entity);

  const compByName = new Map();
  for (const obj of allObjs) {
    if (obj.type === 'SaveComponent') compByName.set(obj.instanceName, obj);
  }
  const { item, classUpdate, isNewClass } = buildViewerEntityFromEditor(builder.entity, saveState.viewerEntityRepository, compByName);
  if (isNewClass) {
    saveState.viewerEntityRepository.classNames = classUpdate.classNames;
    saveState.viewerEntityRepository.clearance = classUpdate.clearance;
    saveState.viewerEntityRepository.portLayouts = classUpdate.portLayouts;
  }
  const index = addItem(builder.entity);
  saveState.viewerEntityRepository.entities.push(item);
  return { index, item, classUpdate: isNewClass ? classUpdate : null };
}

// ── Spline type registry ─────────────────────────────────────────────
const SPLINE_TYPES = {
  belt:  { require: () => require('../../lib/logistic/ConveyorBelt'), defaultTier: 6 },
  pipe:  { require: () => require('../../lib/logistic/Pipe'),         defaultTier: 2 },
  track: { require: () => require('../../lib/railway/RailroadTrack'), defaultTier: null },
};

// ── Create a spline entity between two endpoints ─────────────────────
// Each endpoint is either { idx, port } (existing port) or { pos, dir? } (free position, track only).
function createSplineBetween(type, srcEndpoint, tgtEndpoint, tier) {
  const splineType = SPLINE_TYPES[type];
  if (!splineType) throw new Error(`Unknown spline type "${type}"`);
  const SplineBuilder = splineType.require();

  // Resolve world positions (for length validation + initial straight creation)
  const wSrcPos = srcEndpoint.idx !== undefined
    ? getEntity(srcEndpoint.idx).port(srcEndpoint.port).worldPos()
    : srcEndpoint.pos;
  const wTgtPos = tgtEndpoint.idx !== undefined
    ? getEntity(tgtEndpoint.idx).port(tgtEndpoint.port).worldPos()
    : tgtEndpoint.pos;

  validateSplineLength(type, dist3D(wSrcPos, wTgtPos));

  // 1. Create straight spline (positions only, no dirs)
  const createTier = typeof tier === 'number' ? tier : splineType.defaultTier;
  const args = [
    { pos: { ...wSrcPos }, dir: null },
    { pos: { ...wTgtPos }, dir: null },
  ];
  if (createTier != null) args.push(createTier);
  const builder = SplineBuilder.create(...args);

  // 2. Snap ports — lets the builder negate dirs and rebuild spline with curves
  const portValues = Object.values(SplineBuilder.Ports);
  const startPortName = portValues[0], endPortName = portValues[portValues.length - 1];
  const startPort = builder.port(startPortName);
  const endPort = builder.port(endPortName);

  const FlowPort = require('../../lib/shared/FlowPort');
  if (srcEndpoint.idx !== undefined) {
    startPort.snapTo(getEntity(srcEndpoint.idx).port(srcEndpoint.port));
  } else if (srcEndpoint.dir || srcEndpoint.pos) {
    startPort.snapToPos(FlowPort.virtual(srcEndpoint.pos, srcEndpoint.dir));
  }
  if (tgtEndpoint.idx !== undefined) {
    endPort.snapTo(getEntity(tgtEndpoint.idx).port(tgtEndpoint.port));
  } else if (tgtEndpoint.dir || tgtEndpoint.pos) {
    endPort.snapToPos(FlowPort.virtual(tgtEndpoint.pos, tgtEndpoint.dir));
  }

  // 3. Inject into save AFTER snaps (spline is final)
  const { index: splineIndex, item, classUpdate } = injectSplineEntity(builder);

  // 4. Wire ports (logical connection only)
  if (srcEndpoint.idx !== undefined) {
    const srcEntity = getEntity(srcEndpoint.idx);
    builder.wirePorts(startPort, srcEntity.port(srcEndpoint.port));
    updateEntityConnections(srcEndpoint.idx);
  }
  if (tgtEndpoint.idx !== undefined) {
    const tgtEntity = getEntity(tgtEndpoint.idx);
    builder.wirePorts(endPort, tgtEntity.port(tgtEndpoint.port));
    updateEntityConnections(tgtEndpoint.idx);
  }
  updateEntityConnections(splineIndex);

  console.log(`Created ${type} index=${splineIndex}`);
  return { splineIndex, instanceName: builder.entity.instanceName, item, classUpdate };
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

// ── Update entity properties ────────────────────────────────────────
function updateEntity(index, def) {
  const saveState = getSaveState();
  if (!saveState) throw new Error('No save loaded');
  const item = saveState.items[index];
  if (!item || !item.entity) throw new Error(`No entity at index ${index}`);

  const entity = item.entity;

  if (def.position) throw new Error('Cannot reposition existing entity — only connections can reposition');
  if (def.rotation !== undefined) throw new Error('Cannot rotate existing entity — only connections can reposition');

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
      const result = updateEntity(def.index, def);
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
    applyLabel(result.entity, def.id, def.label, result.item);
    added.push({ id: def.id || null, index: result.entityIndex, instanceName: result.entity.instanceName, item: result.item, classUpdate: result.classUpdate });

  }
}

// ── Resolve endpoint: string "id:port" → {idx, port}, object {x,y,z} → {pos, dir?} ──
function resolveEndpoint(ep, label, conn, ctx) {
  if (typeof ep === 'object' && ep !== null && 'x' in ep) {
    if (!conn.track) throw new Error(`Positional endpoints only supported for track connections (${label})`);
    const rx = ep.x * ctx.cosB - ep.y * ctx.sinB;
    const ry = ep.x * ctx.sinB + ep.y * ctx.cosB;
    const pos = { x: ctx.anchor.x + rx, y: ctx.anchor.y + ry, z: ctx.anchor.z + (ep.z || 0) };
    let dir = null;
    if (ep.rotation !== undefined) {
      const totalYaw = (ep.rotation + (ctx.bpYawDeg || 0)) * Math.PI / 180;
      dir = { x: Math.cos(totalYaw), y: Math.sin(totalYaw), z: 0 };
    }
    return { pos, dir };
  }
  const [id, port] = ep.split(':');
  const idx = ctx.idMap[id];
  if (idx === undefined) throw new Error(`Unknown entity id "${id}" in connection ${label}`);
  return { idx, port };
}

// ── Connection sub-handlers ─────────────────────────────────────────

function processSignalConnection(conn, ctx) {
  const RailroadSignal = require('../../lib/railway/RailroadSignal');
  const [id, portName] = conn.on.split(':');
  const idx = ctx.idMap[id];
  if (idx === undefined) throw new Error(`Unknown entity id "${id}" in signal connection`);

  const trackBuilder = getEntity(idx);
  const port = trackBuilder.port(portName);

  const isPath = conn.type === 'path-signal';
  const signal = RailroadSignal.create(0, 0, 0, undefined, { type: isPath ? 'path' : 'block' });
  signal.attachToPort(port, conn.facing || 'outward');

  const { index, item, classUpdate } = injectSplineEntity(signal);
  if (conn.id) ctx.idMap[conn.id] = index;
  applyLabel(signal.entity, conn.id, conn.label, item);
  ctx.added.push({ id: conn.id || null, index, instanceName: signal.entity.instanceName, item, classUpdate });
  ctx.results.push({ type: conn.type, on: conn.on, signalIndex: index });
}

function processInsertionConnection(conn, ctx) {
  const entityIdx = ctx.idMap[conn.from];
  const splineIdx = ctx.idMap[conn.on];
  if (entityIdx === undefined) throw new Error(`Unknown entity id "${conn.from}" in insertion`);
  if (splineIdx === undefined) throw new Error(`Unknown entity id "${conn.on}" in insertion`);
  if (!conn.id) throw new Error('"id" is required on insertion connections');
  const pos = conn.position || ctx.saveState.items[entityIdx].entity.transform.translation;
  const result = insertOnSpline(entityIdx, splineIdx, pos, conn.reverse);
  ctx.idMap[conn.id] = result.newSplineIndex;
  applyLabel(ctx.saveState.items[result.newSplineIndex].entity, conn.id, conn.label, result.item);
  ctx.added.push({ id: conn.id, index: result.newSplineIndex, instanceName: result.instanceName, item: result.item, classUpdate: result.classUpdate });
  ctx.results.push({ from: conn.from, on: conn.on, [conn.id]: result.newSplineIndex });
}

function processSplineConnection(conn, ctx) {
  const splineType = conn.belt ? 'belt' : conn.pipe ? 'pipe' : 'track';
  if (!conn.id) throw new Error(`"id" is required on ${splineType} auto-connections`);
  const srcEndpoint = resolveEndpoint(conn.from, 'from', conn, ctx);
  const tgtEndpoint = resolveEndpoint(conn.to, 'to', conn, ctx);
  const tier = conn.belt || conn.pipe;
  const result = createSplineBetween(splineType, srcEndpoint, tgtEndpoint, tier);
  ctx.idMap[conn.id] = result.splineIndex;
  applyLabel(ctx.saveState.items[result.splineIndex].entity, conn.id, conn.label, result.item);
  ctx.added.push({ id: conn.id, index: result.splineIndex, instanceName: result.instanceName, item: result.item, classUpdate: result.classUpdate });
  ctx.results.push({ from: conn.from, to: conn.to, [splineType]: conn.id });
}

function processDirectConnection(conn, ctx) {
  const srcEndpoint = resolveEndpoint(conn.from, 'from', conn, ctx);
  const tgtEndpoint = resolveEndpoint(conn.to, 'to', conn, ctx);
  const fromIdx = srcEndpoint.idx, fromPort = srcEndpoint.port;
  const toIdx = tgtEndpoint.idx, toPort = tgtEndpoint.port;
  const result = attachPorts(fromIdx, fromPort, toIdx, toPort);
  for (const idx of [fromIdx, toIdx]) {
    const item = ctx.saveState.items[idx];
    if (!item || item.type !== 'entity') continue;
    const topZ = item.entity.properties?.mTopTransform?.value?.properties?.Translation?.value?.z;
    if (topZ != null) validateSplineLength('lift', Math.abs(topZ));
  }
  ctx.results.push({ from: conn.from, to: conn.to, ...result });
}

// ── Process connections (router) ────────────────────────────────────
function processConnections(connections, ctx) {
  for (const conn of connections) {
    if (conn.type === 'block-signal' || conn.type === 'path-signal') {
      processSignalConnection(conn, ctx);
    } else if (conn.on !== undefined) {
      processInsertionConnection(conn, ctx);
    } else if (conn.belt || conn.pipe || conn.track) {
      processSplineConnection(conn, ctx);
    } else {
      processDirectConnection(conn, ctx);
    }
  }
}

// ── Rebuild viewer items for entities repositioned by connections ────
function rebuildTouchedItems(connectionResults, added, updated) {
  const saveState = getSaveState();
  const touchedIndices = new Set();
  for (const r of connectionResults) {
    if (r.source) touchedIndices.add(r.source.index);
    if (r.target) touchedIndices.add(r.target.index);
  }
  for (const a of added) touchedIndices.add(a.index);
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

  // Resolve cn refs: raw pathNames → "label.Port" or "#index.Port"
  const entityByInst = new Map();
  for (let i = 0; i < saveState.items.length; i++) {
    const it = saveState.items[i];
    if (it?.entity) entityByInst.set(it.entity.instanceName, i);
  }
  const shortPort = (p) => p.replace('TrackConnection', 'TC').replace('PipelineConnection', 'PC').replace('ConveyorAny', 'CA');
  const resolveRef = (raw) => {
    if (!raw || raw === 0) return 0;
    return raw.split(',').map(pathName => {
      const parts = pathName.trim().split('.');
      const port = shortPort(parts.pop());
      const entityInst = parts.join('.');
      const idx = entityByInst.get(entityInst);
      if (idx === undefined) return `?.${port}`;
      const label = saveState.items[idx]?.entity?.properties?.mLabel?.value;
      return label ? `${label}.${port}` : `#${idx}.${port}`;
    }).join(', ');
  };
  for (const idx of touchedIndices) {
    const item = saveState.viewerEntityRepository.entities[idx];
    if (item?.cn) item.cn = item.cn.map(v => resolveRef(v));
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
      const anchor = batch.anchor || { x: 0, y: 0, z: 0 };
      const bpYawDeg = batch.rotation || 0;
      const bpYawRad = bpYawDeg * Math.PI / 180;
      const ctx = {
        idMap,
        added,
        results: connectionResults,
        anchor,
        cosB: Math.cos(bpYawRad),
        sinB: Math.sin(bpYawRad),
        bpYawDeg,
        saveState: getSaveState(),
      };
      processConnections(batch.connections, ctx);
    } catch (err) {
      const indicesToDelete = added.map(r => r.index);
      deleteEntities(indicesToDelete);
      console.log(`Edit rollback: deleted ${indicesToDelete.length} entities after error: ${err.message}`);
      throw err;
    }
  }


  if (connectionResults.length > 0) {
    rebuildTouchedItems(connectionResults, added, updated);
  }

  validateClearance(added, updated);

  console.log(`Edit: +${added.length} ~${updated.length} -${deleted.length}, ${connectionResults.length} connections`);
  return { added, updated, deleted, connections: connectionResults };
}

module.exports = { editEntities, addEntity, getEntity, attachPorts, wirePorts, insertOnSpline };
