/**
 * Save state management — load, store, query, export saves and blueprints.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { Parser } = require('@etothepii/satisfactory-file-parser');
const { buildViewerEntitiesFromSave, buildViewerEntitiesFromCbp, buildViewerEntityFromEditor } = require('./viewerEntityFactory');

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
  const Foundation = require('../../lib/structural/Foundation');
  const lwSub = Foundation.getSubsystem(allObjects);
  const lwInstances = [];
  if (lwSub?.properties?.mBuildableClassToInstanceArray?.values) {
    for (const entry of lwSub.properties.mBuildableClassToInstanceArray.values) {
      const typePath = entry.value?.properties?.mBuildableClass?.value?.pathName;
      if (!typePath) continue;
      const cls = typePath.split('.').pop();
      const instances = entry.value?.properties?.mInstances?.values;
      if (!instances) continue;
      for (const inst of instances) {
        lwInstances.push({ ...inst, typePath, cls });
      }
    }
  }
  console.log(`Lightweight buildables: ${lwInstances.length}`);

  const compByName = new Map();
  for (const obj of allObjects) {
    if (obj.type === 'SaveComponent') compByName.set(obj.instanceName, obj);
  }
  const viewerEntityRepository = buildViewerEntitiesFromSave(entities, lwInstances, compByName);

  saveState = {
    name,
    save,
    items: [
      ...entities.map(e => ({ type: 'entity', entity: e })),
      ...lwInstances.map(lw => ({ type: 'lw', lw })),
    ],
    entities,
    lwInstances,
    allObjects,
    viewerEntityRepository,
  };
}

// ── Load a CBP file (from upload buffer) ───────────────────────────
function loadCbp(name, buf) {
  console.log(`Loading CBP "${name}" (${(buf.byteLength / 1024).toFixed(0)} KB compressed)...`);
  const raw = JSON.parse(zlib.inflateSync(Buffer.from(buf)).toString('utf-8'));
  console.log(`CBP: ${raw.data.length} entries, saveVersion=${raw.saveVersion}, buildVersion=${raw.buildVersion}`);

  const viewerEntityRepository = buildViewerEntitiesFromCbp(raw);
  cbpState = { name, raw, viewerEntityRepository };
  console.log(`CBP prepared: ${viewerEntityRepository.entities.length} buildable entities, ${viewerEntityRepository.classNames.length} classNames`);
}

// ── Load a blueprint .sbp file (from upload buffer) ────────────────
function loadBlueprint(name, rawBuf) {
  const sbpAB = rawBuf instanceof ArrayBuffer ? rawBuf
    : rawBuf.buffer.slice(rawBuf.byteOffset, rawBuf.byteOffset + rawBuf.byteLength);
  console.log(`Loading blueprint "${name}" (${(sbpAB.byteLength / 1024).toFixed(0)} KB)...`);

  const dummyBp = {
    name,
    compressionInfo: {
      chunkHeaderVersion: 572662306, packageFileTag: 2653586369,
      maxUncompressedChunkContentSize: 131072, compressionAlgorithm: 3,
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

  const compByName = new Map();
  for (const obj of parsed.objects) {
    if (obj.type === 'SaveComponent') compByName.set(obj.instanceName, obj);
  }
  const buildable = entities.filter(o => o.typePath.split('.').pop().startsWith('Build_'));
  const viewerEntityRepository = buildViewerEntitiesFromSave(buildable, [], compByName);
  cbpState = { name, viewerEntityRepository, blueprintObjects: parsed.objects };
  console.log(`Blueprint prepared: ${viewerEntityRepository.entities.length} buildable entities, ${viewerEntityRepository.classNames.length} classNames`);
}

// ── Delete entities from save in memory ────────────────────────────
function deleteEntities(indices) {
  if (!saveState) throw new Error('No save loaded');

  const toDelete = new Set(indices);
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

  if (namesToDelete.size > 0) {
    for (const level of Object.values(saveState.save.levels)) {
      level.objects = level.objects.filter(o => {
        if (o.type === 'SaveEntity' && namesToDelete.has(o.instanceName)) return false;
        if (o.type === 'SaveComponent' && namesToDelete.has(o.parentEntityName)) return false;
        return true;
      });
    }
  }

  saveState.entities = saveState.entities.filter(e => !entitiesToRemove.has(e));
  saveState.lwInstances = saveState.lwInstances.filter(lw => !lwToRemove.has(lw));
  saveState.items = saveState.items.filter((_, i) => !toDelete.has(i));
  saveState.allObjects = Object.values(saveState.save.levels).flatMap(l => l.objects);

  const compByName = new Map();
  for (const obj of saveState.allObjects) {
    if (obj.type === 'SaveComponent') compByName.set(obj.instanceName, obj);
  }
  saveState.viewerEntityRepository = buildViewerEntitiesFromSave(saveState.entities, saveState.lwInstances, compByName);

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

  const mainLevelKey = Object.keys(saveState.save.levels).find(k => {
    return saveState.save.levels[k].objects.some(o => o.rootObject === 'Persistent_Level');
  }) || Object.keys(saveState.save.levels)[0];
  const mainLevel = saveState.save.levels[mainLevelKey];

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
  for (const obj of cbpState.blueprintObjects) {
    if (obj.type !== 'SaveComponent') continue;
    const parentNew = pathRemap[obj.parentEntityName];
    if (parentNew) {
      const compSuffix = obj.instanceName.split('.').pop();
      pathRemap[obj.instanceName] = `${parentNew}.${compSuffix}`;
    }
  }

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
      if (clone.transform) {
        const lt = clone.transform.translation;
        const rx = lt.x * cosY - lt.y * sinY;
        const ry = lt.x * sinY + lt.y * cosY;
        clone.transform.translation = { x: rx + tx, y: ry + ty, z: lt.z + tz };

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

    if (clone.properties) {
      clone.properties = remapPathNames(clone.properties);
    }

    newObjects.push(clone);
  }

  mainLevel.objects.push(...newObjects);
  console.log(`Injected ${newObjects.length} objects from blueprint into ${mainLevelKey}`);

  saveState.allObjects = Object.values(saveState.save.levels).flatMap(l => l.objects);
  saveState.entities = saveState.allObjects.filter(o => {
    if (o.type !== 'SaveEntity' || !o.transform) return false;
    const cls = o.typePath.split('.').pop();
    return cls.startsWith('Build_') && !SKIP_CLASSES.test(cls);
  });

  const compByName = new Map();
  for (const obj of saveState.allObjects) {
    if (obj.type === 'SaveComponent') compByName.set(obj.instanceName, obj);
  }
  saveState.viewerEntityRepository = buildViewerEntitiesFromSave(saveState.entities, saveState.lwInstances, compByName);
  saveState.items = [
    ...saveState.entities.map(e => ({ type: 'entity', entity: e })),
    ...saveState.lwInstances.map(lw => ({ type: 'lw', lw })),
  ];

  const entityCount = newObjects.filter(o => o.type === 'SaveEntity').length;
  console.log(`Inject complete: ${entityCount} entities, save updated`);
  return { injected: entityCount, viewerEntityRepository: saveState.viewerEntityRepository };
}

// ── Ensure a minimal saveState exists (for edit without save) ──────
function ensureSaveState() {
  if (saveState) return;
  const { initSession } = require('../../satisfactoryLib');
  initSession();
  const level = { objects: [], collectables: [] };
  saveState = {
    name: '(no save)',
    save: { levels: { Persistent_Level: level } },
    items: [],
    entities: [],
    lwInstances: [],
    allObjects: [],
    mainLevel: level,
    viewerEntityRepository: { classNames: [], clearance: {}, entities: [], portLayouts: {} },
  };
  console.log('Initialized empty saveState for editing without save');
}

// ── Get player position ───────────────────────────────────────────
function getPlayerPosition() {
  if (!saveState) throw new Error('No save loaded');
  const charObj = saveState.allObjects.find(o => o.typePath?.includes('Char_Player_C') && o.transform);
  if (!charObj) throw new Error('Player character not found in save');
  return charObj.transform.translation;
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

module.exports = {
  loadSave, loadCbp, loadBlueprint,
  getSaveState, getCbpState,
  deleteEntities, ensureSaveState,
  injectBlueprint, getPlayerPosition, setPlayerPosition, serializeSave,
};
