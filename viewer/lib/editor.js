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

// ── Spline length validation ───────────────────────────────────────
function dist3D(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

function validateSplineLength(type, length) {
  const limits = splineLimits[type];
  if (!limits) return;
  if (length < limits.min)
    throw new Error(`${type} too short: ${Math.round(length)} UU (min ${limits.min})`);
  if (length > limits.max)
    throw new Error(`${type} too long: ${Math.round(length)} UU (max ${limits.max})`);
}

// ── Spline curvature / slope validation ───────────────────────────
const GUARD_DIST = 100; // 2 × PORT_TANGENT

function validateSplineShape(type, entity, wSrcDir, wDstDir) {
  const Builder = require('../../lib/shared/Builder');
  const { sampleHermiteSpline } = require('../../lib/shared/hermite');
  const Vector3D = require('../../lib/shared/Vector3D');

  const pts = Builder._parseSplinePoints(entity);
  if (!pts || pts.length < 2) return;

  // U-turn check using world-space port directions passed by caller.
  // Belt/pipe: wSrcDir points into the spline (toward dest), wDstDir points away (opposing span)
  // Track: both tangents point in the direction of travel (co-directional with span)
  if (wSrcDir && wDstDir) {
    const p0 = pts[0], pN = pts[pts.length - 1];
    const span = new Vector3D(pN.x - p0.x, pN.y - p0.y, 0);
    const spanXY = span.length;
    if (spanXY > 1e-6) {
      const sn = { x: span.x / spanXY, y: span.y / spanXY };
      const cosSrc = wSrcDir.x * sn.x + wSrcDir.y * sn.y;
      const cosDst = wDstDir.x * sn.x + wDstDir.y * sn.y;
      if (type === 'track') {
        // Track tangents should roughly align with span (both co-directional)
        if (cosSrc < -0.5 || cosDst < -0.5) {
          throw new Error(`${type} would require U-turn`);
        }
      } else {
        // Belt/pipe: source into span (cosSrc > 0), dest opposes span (cosDst < 0)
        if (cosSrc < -0.5 || cosDst > 0.5) {
          throw new Error(`${type} would require U-turn`);
        }
      }
    }
  }

  const limits = splineLimits[type];
  if (!limits || (!limits.minRadiusXY && !limits.maxSlopeDeg)) return;

  const sampled = sampleHermiteSpline(pts, 100);
  const t = entity.transform.translation;
  const r = entity.transform.rotation;
  const world = sampled.map(p => new Vector3D(p).rotate(r).add(new Vector3D(t)));

  // Skip guard sections (GUARD_DIST from each end) for curvature/slope checks
  let guardSamples = 0;
  let cumLen = 0;
  for (let i = 1; i < world.length; i++) {
    cumLen += world[i].sub(world[i - 1]).length;
    if (cumLen >= GUARD_DIST) { guardSamples = i; break; }
  }
  let totalLen = cumLen;
  for (let i = guardSamples + 1; i < world.length; i++) totalLen += world[i].sub(world[i - 1]).length;
  let endGuardStart = world.length - 1;
  cumLen = 0;
  for (let i = world.length - 1; i > 0; i--) {
    cumLen += world[i].sub(world[i - 1]).length;
    if (cumLen >= GUARD_DIST) { endGuardStart = i; break; }
  }
  const iStart = guardSamples;
  const iEnd = endGuardStart;

  // Min curvature radius in XY plane (excluding guards)
  if (limits.minRadiusXY) {
    let minR = Infinity;
    for (let i = Math.max(1, iStart); i < Math.min(world.length - 1, iEnd); i++) {
      const v1x = world[i].x - world[i - 1].x, v1y = world[i].y - world[i - 1].y;
      const v2x = world[i + 1].x - world[i].x, v2y = world[i + 1].y - world[i].y;
      const l1 = Math.sqrt(v1x * v1x + v1y * v1y);
      const l2 = Math.sqrt(v2x * v2x + v2y * v2y);
      if (l1 < 1e-6 || l2 < 1e-6) continue;
      const dot = (v1x * v2x + v1y * v2y) / (l1 * l2);
      const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
      if (angle > 1e-10) {
        const rv = (l1 + l2) / 2 / angle;
        if (rv < minR) minR = rv;
      }
    }
    if (minR < limits.minRadiusXY) {
      throw new Error(`${type} curvature too tight: radius ${Math.round(minR)} UU (min ${limits.minRadiusXY})`);
    }
  }

  // Max slope (excluding guards)
  if (limits.maxSlopeDeg) {
    const maxTan = Math.tan(limits.maxSlopeDeg * Math.PI / 180);
    for (let i = Math.max(1, iStart); i <= iEnd; i++) {
      const dx = world[i].x - world[i - 1].x, dy = world[i].y - world[i - 1].y;
      const dz = world[i].z - world[i - 1].z;
      const hDist = Math.sqrt(dx * dx + dy * dy);
      if (hDist > 1e-6 && Math.abs(dz) / hDist > maxTan) {
        const slopeDeg = Math.atan(Math.abs(dz) / hDist) * 180 / Math.PI;
        throw new Error(`${type} slope too steep: ${slopeDeg.toFixed(1)}° (max ${limits.maxSlopeDeg}°)`);
      }
    }
  }
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
  const Builder = splineType.require();

  // Resolve world positions and directions
  let wSrcPos, wSrcDir, wTgtPos, wTgtDir;
  if (srcEndpoint.idx !== undefined) {
    const srcEntity = getEntity(srcEndpoint.idx);
    const srcPort = srcEntity.port(srcEndpoint.port);
    wSrcPos = srcPort.worldPos(); wSrcDir = srcPort.worldDir();
  } else {
    wSrcPos = srcEndpoint.pos; wSrcDir = srcEndpoint.dir || null;
  }
  if (tgtEndpoint.idx !== undefined) {
    const tgtEntity = getEntity(tgtEndpoint.idx);
    const tgtPort = tgtEntity.port(tgtEndpoint.port);
    wTgtPos = tgtPort.worldPos(); wTgtDir = tgtPort.worldDir();
  } else {
    wTgtPos = tgtEndpoint.pos; wTgtDir = tgtEndpoint.dir || null;
  }

  validateSplineLength(type, dist3D(wSrcPos, wTgtPos));
  const createTier = typeof tier === 'number' ? tier : splineType.defaultTier;
  const args = [
    { pos: { ...wSrcPos }, dir: wSrcDir ? { ...wSrcDir } : null },
    { pos: { ...wTgtPos }, dir: wTgtDir ? { ...wTgtDir } : null },
  ];
  if (createTier != null) args.push(createTier);
  const builder = Builder.create(...args);
  validateSplineShape(type, builder.entity, wSrcDir, wTgtDir);

  const { index: splineIndex, item, classUpdate } = injectSplineEntity(builder);

  // Connect ports where endpoints reference existing entities
  // Start port = first Ports value, end port = last Ports value
  const portValues = Object.values(Builder.Ports);
  const startPort = portValues[0], endPort = portValues[portValues.length - 1];
  if (srcEndpoint.idx !== undefined) {
    const srcEntity = getEntity(srcEndpoint.idx);
    builder.connectPorts(startPort, srcEntity, srcEndpoint.port);
    updateEntityConnections(srcEndpoint.idx);
  }
  if (tgtEndpoint.idx !== undefined) {
    const tgtEntity = getEntity(tgtEndpoint.idx);
    builder.connectPorts(endPort, tgtEntity, tgtEndpoint.port);
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
    added.push({ id: def.id || null, index: result.entityIndex, instanceName: result.entity.instanceName, item: result.item, classUpdate: result.classUpdate });

  }
}

// ── Process connections (direct, belt, pipe, insertion) ──────────────
function processConnections(connections, idMap, added, anchor, bpYawDeg) {
  const saveState = getSaveState();
  const bpYawRad = (bpYawDeg || 0) * Math.PI / 180;
  const cosB = Math.cos(bpYawRad), sinB = Math.sin(bpYawRad);
  const results = [];
  for (const conn of connections) {
    if (conn.on !== undefined) {
      const entityIdx = idMap[conn.from];
      const splineIdx = idMap[conn.on];
      if (entityIdx === undefined) throw new Error(`Unknown entity id "${conn.from}" in insertion`);
      if (splineIdx === undefined) throw new Error(`Unknown entity id "${conn.on}" in insertion`);
      if (!conn.id) throw new Error('"id" is required on insertion connections');
      const pos = conn.position || saveState.items[entityIdx].entity.transform.translation;
      const result = insertOnSpline(entityIdx, splineIdx, pos, conn.reverse);
      idMap[conn.id] = result.newSplineIndex;
      added.push({ id: conn.id, index: result.newSplineIndex, instanceName: result.instanceName, item: result.item, classUpdate: result.classUpdate });
      results.push({ from: conn.from, on: conn.on, [conn.id]: result.newSplineIndex });
      continue;
    }

    // Resolve endpoint: string "id:port" → {idx, port}, object {x,y,z} → {pos} (track only)
    function resolveEndpoint(ep, label) {
      if (typeof ep === 'object' && ep !== null && 'x' in ep) {
        if (!conn.track) throw new Error(`Positional endpoints only supported for track connections (${label})`);
        // Transform relative position by anchor + batch rotation
        const rx = ep.x * cosB - ep.y * sinB;
        const ry = ep.x * sinB + ep.y * cosB;
        const pos = { x: anchor.x + rx, y: anchor.y + ry, z: anchor.z + (ep.z || 0) };
        let dir = null;
        if (ep.rotation !== undefined) {
          const totalYaw = (ep.rotation + (bpYawDeg || 0)) * Math.PI / 180;
          dir = { x: -Math.cos(totalYaw), y: -Math.sin(totalYaw), z: 0 };
        }
        return { pos, dir };
      }
      const [id, port] = ep.split(':');
      const idx = idMap[id];
      if (idx === undefined) throw new Error(`Unknown entity id "${id}" in connection ${label}`);
      return { idx, port };
    }
    const srcEndpoint = resolveEndpoint(conn.from, 'from');
    const tgtEndpoint = resolveEndpoint(conn.to, 'to');

    const splineType = conn.belt ? 'belt' : conn.pipe ? 'pipe' : conn.track ? 'track' : null;
    if (splineType) {
      if (!conn.id) throw new Error(`"id" is required on ${splineType} auto-connections`);
      const tier = conn.belt || conn.pipe;
      const result = createSplineBetween(splineType, srcEndpoint, tgtEndpoint, tier);
      idMap[conn.id] = result.splineIndex;
      added.push({ id: conn.id, index: result.splineIndex, instanceName: result.instanceName, item: result.item, classUpdate: result.classUpdate });
      results.push({ from: conn.from, to: conn.to, [splineType]: conn.id });
    } else {
      const fromIdx = srcEndpoint.idx, fromPort = srcEndpoint.port;
      const toIdx = tgtEndpoint.idx, toPort = tgtEndpoint.port;
      const result = attachPorts(fromIdx, fromPort, toIdx, toPort);
      // Validate lift height after snap
      for (const idx of [fromIdx, toIdx]) {
        const item = saveState.items[idx];
        if (!item || item.type !== 'entity') continue;
        const topZ = item.entity.properties?.mTopTransform?.value?.properties?.Translation?.value?.z;
        if (topZ != null) validateSplineLength('lift', Math.abs(topZ));
      }
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
      const anchor = batch.anchor || { x: 0, y: 0, z: 0 };
      const bpYawDeg = batch.rotation || 0;
      connectionResults = processConnections(batch.connections, idMap, added, anchor, bpYawDeg);
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
