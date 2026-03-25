const http = require('http');
const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');
const { initSession } = require('../satisfactoryLib');
const Blueprint = require('../lib/Blueprint');
const { loadSave, loadCbp, loadBlueprint, getSaveState, getCbpState, getHeightmapData, injectBlueprint, editEntities } = require('./lib/saveLoader');
const { mergeCbpIntoSave } = require('./lib/merge');

// ── Express ────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── WebSocket ──────────────────────────────────────────────────────
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

function broadcast(msg) {
  const data = JSON.stringify(msg);
  console.log('[WS>>]', msg.type, data.substring(0, 300));
  for (const ws of wss.clients) {
    if (ws.readyState === 1) ws.send(data);
  }
}

let cameraState = null;

wss.on('connection', (ws) => {
  console.log('WebSocket client connected');
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.type === 'camera') {
        cameraState = { position: msg.position, yaw: msg.yaw, pitch: msg.pitch };
      }
    } catch (e) {}
  });
  ws.on('close', () => console.log('WebSocket client disconnected'));
});

// ── Load save from disk ──────────────────────────────────────────────
const fs = require('fs');
app.post('/api/load-file', (req, res) => {
  const { filePath } = req.body;
  if (!filePath) return res.status(400).json({ error: 'filePath required' });
  try {
    const buf = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const name = path.basename(filePath, ext);
    const arrayBuf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    if (ext === '.cbp' || ext === '.sbp') {
      ext === '.cbp' ? loadCbp(name, arrayBuf) : loadBlueprint(name, arrayBuf);
      res.json({ success: true, type: 'cbp', name });
    } else {
      loadSave(name, arrayBuf);
      res.json({ success: true, type: 'save', name });
    }
  } catch (err) {
    console.error('Load file error:', err);
    res.status(500).json({ error: err.message });
  }
});

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
  const item = saveState.items[idx];
  if (!item) return res.status(404).json({ error: 'Entity not found' });
  if (item.type === 'lw') {
    return res.json({ typePath: item.lw.typePath, cls: item.lw.cls, transform: item.lw.transform, lightweight: true });
  }
  const entity = item.entity;

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
    else if (v?.value !== undefined) props[k] = v.value;
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

    let cx = 0, cy = 0, cz = 0;
    const selected = [];
    const selectedLw = [];
    for (const idx of indices) {
      const item = saveState.items[idx];
      if (!item) continue;
      if (item.type === 'lw') {
        selectedLw.push(item.lw);
        cx += item.lw.transform.translation.x;
        cy += item.lw.transform.translation.y;
        cz += item.lw.transform.translation.z;
      } else {
        selected.push(item.entity);
        cx += item.entity.transform.translation.x;
        cy += item.entity.transform.translation.y;
        cz += item.entity.transform.translation.z;
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
  const { serializeSave } = require('./lib/saveLoader');
  const buf = serializeSave();
  const outputName = `${saveState.name}_edit`;
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${outputName}.sav"`);
  res.send(buf);
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

// ── Camera state ─────────────────────────────────────────────────────
app.get('/api/camera', (req, res) => {
  if (!cameraState) return res.status(404).json({ error: 'No camera data (open viewer first)' });
  res.json(cameraState);
});

// ── Edit entities (add/update/delete + connections) ─────────────────
app.post('/api/edit', (req, res) => {
  try {
    const batch = req.body;
    if (!batch?.entities?.length) {
      return res.status(400).json({ error: 'entities array required' });
    }

    // Resolve anchor: { fromCamera: distance } or { x, y, z }
    if (batch.anchor?.fromCamera !== undefined) {
      if (!cameraState) {
        return res.status(400).json({ error: 'No camera data — open viewer first' });
      }
      const dist = batch.anchor.fromCamera;
      const yawRad = cameraState.yaw * Math.PI / 180;
      const pitchRad = cameraState.pitch * Math.PI / 180;
      const cosPitch = Math.cos(pitchRad);
      batch.anchor = {
        x: cameraState.position.x + Math.cos(yawRad) * cosPitch * dist,
        y: cameraState.position.y + Math.sin(yawRad) * cosPitch * dist,
        z: cameraState.position.z + Math.sin(pitchRad) * dist,
      };
    }

    const result = editEntities(batch);

    // Broadcast added entities
    for (const ent of result.added) {
      broadcast({
        type: 'entityAdded',
        index: ent.index,
        item: ent.item,
        classUpdate: ent.classUpdate,
      });
    }

    // Broadcast updated entities
    for (const ent of result.updated) {
      broadcast({
        type: 'entityAdded',
        index: ent.index,
        item: ent.item,
        classUpdate: ent.classUpdate,
      });
    }

    // Broadcast deleted entities
    if (result.deleted.length > 0) {
      broadcast({ type: 'entitiesDeleted', indices: result.deleted });
    }

    // Broadcast connection updates
    for (const conn of result.connections) {
      if (conn.source && conn.target) {
        broadcast({
          type: 'connectionsUpdated',
          entities: [conn.source, conn.target],
        });
      }
    }

    res.json({
      success: true,
      added: result.added.map(e => ({ id: e.id, index: e.index, instanceName: e.instanceName })),
      updated: result.updated.map(e => ({ id: e.id, index: e.index })),
      deleted: result.deleted,
      connections: result.connections.length,
    });
  } catch (err) {
    console.error('Edit error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Move player (deferred — applied on save export) ─────────────────
app.post('/api/move-player', (req, res) => {
  try {
    const { position } = req.body;
    if (!position) return res.status(400).json({ error: 'position {x, y, z} required' });
    const { setPlayerPosition } = require('./lib/saveLoader');
    setPlayerPosition(position);
    console.log(`Player position set to (${position.x}, ${position.y}, ${position.z}) — will be applied on save export`);
    res.json({ success: true, position });
  } catch (err) {
    console.error('Move player error:', err);
    res.status(500).json({ error: err.message });
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
server.listen(PORT, () => {
  console.log(`Viewer: http://localhost:${PORT} (WebSocket enabled)`);
});
