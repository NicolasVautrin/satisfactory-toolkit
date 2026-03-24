const path = require('path');
const express = require('express');
const { initSession } = require('../satisfactoryLib');
const Blueprint = require('../lib/Blueprint');
const { loadSave, loadCbp, loadBlueprint, getSaveState, getCbpState, getHeightmapData, deleteEntities, injectBlueprint } = require('./lib/saveLoader');
const { mergeCbpIntoSave } = require('./lib/merge');

// ── Express ────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Upload save/CBP ────────────────────────────────────────────────
app.post('/api/upload', express.raw({ type: 'application/octet-stream', limit: '500mb' }), (req, res) => {
  const fileName = req.headers['x-save-name'] || 'uploaded';
  const ext = path.extname(fileName).toLowerCase();
  const name = path.basename(fileName, ext);

  try {
    const buf = req.body.buffer.slice(req.body.byteOffset, req.body.byteOffset + req.body.byteLength);

    if (ext === '.cbp') {
      loadCbp(name, buf);
      res.json({ type: 'cbp', cbp: getCbpState().entityData });
    } else if (ext === '.sbp') {
      loadBlueprint(name, buf);
      res.json({ type: 'cbp', cbp: getCbpState().entityData });
    } else {
      loadSave(name, buf);
      res.json({ type: 'save', save: getSaveState().entityData });
    }
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Get current entity data (for refresh) ──────────────────────────
app.get('/api/entities', (req, res) => {
  const result = {};
  const saveState = getSaveState();
  const cbpState = getCbpState();
  if (saveState) { result.save = saveState.entityData; result.saveName = saveState.name; }
  if (cbpState) { result.cbp = cbpState.entityData; result.cbpName = cbpState.name; }
  if (!saveState && !cbpState) return res.status(400).json({ error: 'No data loaded' });
  res.json(result);
});

// ── Inspect entity ─────────────────────────────────────────────────
app.get('/api/inspect/:index', (req, res) => {
  const saveState = getSaveState();
  if (!saveState) return res.status(400).json({ error: 'No save loaded' });
  const idx = parseInt(req.params.index);
  const entity = saveState.entities[idx];
  if (!entity) return res.status(404).json({ error: 'Entity not found' });

  const comps = (entity.components || []).map(ref => {
    const comp = saveState.allObjects.find(o => o.instanceName === ref.pathName);
    if (!comp) return { pathName: ref.pathName, missing: true };
    const props = {};
    for (const [k, v] of Object.entries(comp.properties || {})) {
      if (v?.value?.pathName) props[k] = v.value.pathName;
      else if (v?.value !== undefined) props[k] = v.value;
    }
    return { name: ref.pathName.split('.').pop(), properties: props };
  });

  const props = {};
  for (const [k, v] of Object.entries(entity.properties || {})) {
    if (v?.value?.pathName) props[k] = v.value.pathName;
    else if (v?.value !== undefined) {
      const s = JSON.stringify(v.value);
      props[k] = s.length > 200 ? s.substring(0, 200) + '...' : v.value;
    }
  }

  res.json({
    instanceName: entity.instanceName,
    typePath: entity.typePath,
    parentObjectName: entity.parentObjectName,
    properties: props,
    components: comps,
  });
});

// ── Terrain ────────────────────────────────────────────────────────
app.get('/api/terrain', (req, res) => {
  const heightmapData = getHeightmapData();
  if (!heightmapData) return res.status(404).json({ error: 'No heightmap. Run: node tools/generateHeightmap.js' });
  res.json(heightmapData);
});

// ── Export blueprint ───────────────────────────────────────────────
app.post('/api/export', (req, res) => {
  try {
    const saveState = getSaveState();
    if (!saveState) return res.status(400).json({ error: 'No save loaded' });
    const { indices, name } = req.body;
    if (!indices?.length || !name) {
      return res.status(400).json({ error: 'indices and name required' });
    }

    initSession();

    const lwStartIdx = saveState.entities.length;
    let cx = 0, cy = 0, cz = 0;
    const selected = [];
    const selectedLw = [];
    for (const idx of indices) {
      if (idx >= lwStartIdx) {
        const lw = saveState.lwInstances[idx - lwStartIdx];
        if (!lw) continue;
        selectedLw.push(lw);
        cx += lw.transform.translation.x;
        cy += lw.transform.translation.y;
        cz += lw.transform.translation.z;
      } else {
        const e = saveState.entities[idx];
        if (!e) continue;
        selected.push(e);
        cx += e.transform.translation.x;
        cy += e.transform.translation.y;
        cz += e.transform.translation.z;
      }
    }
    const totalCount = selected.length + selectedLw.length;
    if (totalCount === 0) {
      return res.status(400).json({ error: 'No entities selected' });
    }
    cx /= totalCount;
    cy /= totalCount;
    cz /= totalCount;

    // Extract yaw from first entity to align blueprint with grid
    const refEntity = selected[0] || null;
    let bpRotation = { x: 0, y: 0, z: 0, w: 1 };
    if (refEntity) {
      const r = refEntity.transform.rotation;
      // Extract yaw (Z rotation) from quaternion: yaw = atan2(2(wz+xy), 1-2(yy+zz))
      const yaw = Math.atan2(2 * (r.w * r.z + r.x * r.y), 1 - 2 * (r.y * r.y + r.z * r.z));
      // Rebuild quaternion with only yaw component
      bpRotation = { x: 0, y: 0, z: Math.sin(yaw / 2), w: Math.cos(yaw / 2) };
    }

    const bp = Blueprint.create(name, cx, cy, cz, bpRotation);
    bp._objects = selected.map(e => bp._cloneObject(e));

    const selectedNames = new Set(selected.map(e => e.instanceName));
    const components = saveState.allObjects.filter(o =>
      o.type === 'SaveComponent' && selectedNames.has(o.parentEntityName)
    );
    for (const comp of components) {
      bp._objects.push(bp._cloneObject(comp));
    }

    // Convert lightweight buildables to SaveEntity for blueprint
    for (const lw of selectedLw) {
      const cls = lw.cls;
      const props = {};
      if (lw.beamLength) {
        props.mLength = { type: 'FloatProperty', ueType: 'FloatProperty', name: 'mLength', value: lw.beamLength };
      }
      if (lw.recipe) {
        props.mBuiltWithRecipe = {
          type: 'ObjectProperty', ueType: 'ObjectProperty', name: 'mBuiltWithRecipe',
          value: { levelName: '', pathName: lw.recipe },
        };
      }

      const entity = {
        typePath: lw.typePath,
        rootObject: 'Persistent_Level',
        instanceName: `Persistent_Level:PersistentLevel.${cls}_export_${bp._objects.length}`,
        properties: props,
        specialProperties: { type: 'EmptySpecialProperties' },
        trailingData: [],
        saveCustomVersion: 0,
        shouldMigrateObjectRefsToPersistent: false,
        parentEntityName: '',
        type: 'SaveEntity',
        needTransform: true,
        wasPlacedInLevel: false,
        parentObject: { levelName: 'Persistent_Level', pathName: 'Persistent_Level:PersistentLevel.BuildableSubsystem' },
        transform: lw.transform,
        components: [],
      };
      bp._objects.push(bp._cloneObject(entity));
    }

    console.log(`Export: ${selected.length} entities + ${selectedLw.length} lightweight (${bp._objects.length} total objects)`);
    const { sbpBuf, cfgBuf } = bp.toBuffers({ name, description: name });

    res.json({
      success: true,
      count: selected.length,
      lwCount: selectedLw.length,
      sbp: sbpBuf.toString('base64'),
      sbpcfg: cfgBuf.toString('base64'),
    });
  } catch (err) {
    console.error('Export error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Delete entities ─────────────────────────────────────────────────
app.post('/api/delete', (req, res) => {
  try {
    const { indices } = req.body;
    if (!indices?.length) return res.status(400).json({ error: 'indices required' });
    const result = deleteEntities(indices);
    res.json({ success: true, deleted: result.deleted, save: result.entityData });
  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Inject blueprint into save ──────────────────────────────────────
app.post('/api/inject-blueprint', (req, res) => {
  try {
    const { transform } = req.body;
    if (!transform) return res.status(400).json({ error: 'transform required' });
    const result = injectBlueprint(transform);
    res.json({ success: true, injected: result.injected, save: result.entityData });
  } catch (err) {
    console.error('Inject error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Download modified save ──────────────────────────────────────────
app.get('/api/download-save', (req, res) => {
  const saveState = getSaveState();
  if (!saveState) return res.status(400).json({ error: 'No save loaded' });
  const outputName = `${saveState.name}_edit`;
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${outputName}.sav"`);
  res.send(Buffer.from(saveState.saveBuf));
});

// ── Merge CBP into save ────────────────────────────────────────────
app.post('/api/merge', (req, res) => {
  try {
    const result = mergeCbpIntoSave();
    const { outputName, outputBuf, entityCount, totalCount } = result;
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${outputName}.sav"`);
    res.setHeader('X-Entity-Count', entityCount);
    res.setHeader('X-Total-Count', totalCount);
    res.send(Buffer.from(outputBuf));
  } catch (err) {
    console.error('Merge error:', err.stack || err);
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

// ── Shutdown ───────────────────────────────────────────────────────
app.post('/api/shutdown', (req, res) => {
  res.json({ success: true });
  console.log('Shutdown requested');
  process.exit(0);
});

// ── Start ──────────────────────────────────────────────────────────
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Viewer: http://localhost:${PORT}`);
});
