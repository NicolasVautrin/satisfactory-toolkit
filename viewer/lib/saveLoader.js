const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { Parser } = require('@etothepii/satisfactory-file-parser');
const { buildSaveEntityData, buildCbpEntityData } = require('./entityData');

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
  saveState = { name, save, saveBuf: buf, allObjects, entities, lwInstances, entityData };
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

  const lwStartIdx = saveState.entities.length;
  const entityIndicesToDelete = new Set();
  const lwIndicesToDelete = new Set();

  for (const idx of indices) {
    if (idx >= lwStartIdx) {
      lwIndicesToDelete.add(idx - lwStartIdx);
    } else {
      entityIndicesToDelete.add(idx);
    }
  }

  // Collect instanceNames of entities to delete (for component cleanup)
  const namesToDelete = new Set();
  for (const idx of entityIndicesToDelete) {
    const e = saveState.entities[idx];
    if (e) namesToDelete.add(e.instanceName);
  }

  // Remove entities from save levels
  for (const level of Object.values(saveState.save.levels)) {
    level.objects = level.objects.filter(o => {
      if (o.type === 'SaveEntity' && namesToDelete.has(o.instanceName)) return false;
      if (o.type === 'SaveComponent' && namesToDelete.has(o.parentEntityName)) return false;
      return true;
    });
  }

  // Remove from saveState.entities
  saveState.entities = saveState.entities.filter((_, i) => !entityIndicesToDelete.has(i));

  // Remove lightweight instances
  if (lwIndicesToDelete.size > 0) {
    saveState.lwInstances = saveState.lwInstances.filter((_, i) => !lwIndicesToDelete.has(i));
    // TODO: also remove from the actual LW subsystem in save — for now only viewer-side
  }

  // Update allObjects
  saveState.allObjects = Object.values(saveState.save.levels).flatMap(l => l.objects);

  // Rebuild entityData
  const compByName = new Map();
  for (const obj of saveState.allObjects) {
    if (obj.type === 'SaveComponent') compByName.set(obj.instanceName, obj);
  }
  saveState.entityData = buildSaveEntityData(saveState.entities, saveState.lwInstances, compByName);

  // Update saveBuf so Download Save reflects deletions
  const { Parser } = require('@etothepii/satisfactory-file-parser');
  let headerBuf;
  const bodyChunks = [];
  Parser.WriteSave(saveState.save,
    h => { headerBuf = h; },
    c => { bodyChunks.push(c); }
  );
  saveState.saveBuf = Buffer.concat([headerBuf, ...bodyChunks]);

  const totalDeleted = entityIndicesToDelete.size + lwIndicesToDelete.size;
  console.log(`Deleted ${totalDeleted} entities (${entityIndicesToDelete.size} normal + ${lwIndicesToDelete.size} lightweight)`);
  return { deleted: totalDeleted, entityData: saveState.entityData };
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

  // Rebuild allObjects, entities, entityData, saveBuf
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

  // Update saveBuf
  let headerBuf;
  const bodyChunks = [];
  Parser.WriteSave(saveState.save,
    h => { headerBuf = h; },
    c => { bodyChunks.push(c); }
  );
  saveState.saveBuf = Buffer.concat([headerBuf, ...bodyChunks]);

  const entityCount = newObjects.filter(o => o.type === 'SaveEntity').length;
  console.log(`Inject complete: ${entityCount} entities, save updated`);
  return { injected: entityCount, entityData: saveState.entityData };
}

module.exports = { loadSave, loadCbp, loadBlueprint, getSaveState, getCbpState, getHeightmapData, deleteEntities, injectBlueprint };
