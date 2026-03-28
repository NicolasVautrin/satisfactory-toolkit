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
// Serve meshes with LOD fallback: if lod2/X.glb missing, try lod1/X.glb, then lod0/X.glb
// Works for both /meshes/lod2/X.glb (buildings) and /meshes/scenery/lod2/X.glb (scenery)
app.use('/meshes', (req, res, next) => {
  // Match: /lod2/file.glb or /scenery/lod2/file.glb
  const match = req.path.match(/^(\/(?:scenery\/)?)(lod(\d+))\/(.+\.glb)$/);
  if (!match) return next();
  const prefix = match[1]; // "/" or "/scenery/"
  const requestedLod = parseInt(match[3], 10);
  const file = match[4];
  for (let lod = requestedLod; lod >= 0; lod--) {
    const filePath = path.join(__dirname, '..', 'data', 'meshes', prefix, `lod${lod}`, file);
    if (fs.existsSync(filePath)) return res.sendFile(filePath);
  }
  next();
}, express.static(path.join(__dirname, '..', 'data', 'meshes')));

// ── Mesh catalog endpoints ─────────────────────────────────────────
const MESHES_DIR = path.join(__dirname, '..', 'data', 'meshes');

app.get('/api/mesh-lods', (req, res) => {
  if (!fs.existsSync(MESHES_DIR)) return res.json({ lods: [] });
  const lods = fs.readdirSync(MESHES_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name.startsWith('lod'))
    .map(d => d.name)
    .sort();
  res.json({ lods });
});

app.get('/api/mesh-catalog', (req, res) => {
  const lod = req.query.lod || 'lod1';
  const lodNum = parseInt(lod.replace('lod', ''), 10);
  // Union of all meshes available at requested LOD or below (fallback)
  const meshSet = new Set();
  for (let l = lodNum; l >= 0; l--) {
    const lodDir = path.join(MESHES_DIR, `lod${l}`);
    if (!fs.existsSync(lodDir)) continue;
    for (const f of fs.readdirSync(lodDir)) {
      if (f.endsWith('.glb')) meshSet.add(f.replace('.glb', ''));
    }
  }
  res.json({ lod, meshes: [...meshSet].sort() });
});

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
      broadcast({ type: 'saveLoaded', name });
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

app.get('/api/scenery', (req, res) => {
  const placementsPath = path.join(MESHES_DIR, 'scenery_placements.json');
  const streamingPath = path.join(MESHES_DIR, 'scenery_streaming.json');
  const data = fs.existsSync(placementsPath) ? JSON.parse(fs.readFileSync(placementsPath, 'utf8')) : { staticMeshes: [], bpActors: [] };
  const streaming = fs.existsSync(streamingPath) ? JSON.parse(fs.readFileSync(streamingPath, 'utf8')) : [];
  const lod = req.query.lod || 'lod0';
  const lodNum = parseInt(lod.replace('lod', ''), 10);
  // Union of scenery meshes at requested LOD or below (fallback)
  const meshSet = new Set();
  for (let l = lodNum; l >= 0; l--) {
    const lodDir = path.join(MESHES_DIR, 'scenery', `lod${l}`);
    if (!fs.existsSync(lodDir)) continue;
    for (const f of fs.readdirSync(lodDir)) {
      if (f.endsWith('.glb')) meshSet.add(f.replace('.glb', ''));
    }
  }
  const availableMeshes = [...meshSet];
  const texDir = path.join(MESHES_DIR, 'scenery', 'textures');
  const availableTextures = fs.existsSync(texDir)
    ? fs.readdirSync(texDir).filter(f => f.endsWith('.png')).map(f => f.replace('.png', ''))
    : [];
  res.json({ ...data, streaming, availableMeshes, availableTextures });
});

app.get('/api/terrain-tiles', (req, res) => {
  const terrainDir = path.join(MESHES_DIR, 'terrain');
  const glbDir = path.join(terrainDir, 'glb');
  if (!fs.existsSync(glbDir)) return res.json({ tiles: [] });

  // Use metadata.json if available (has world coordinates)
  const metaPath = path.join(terrainDir, 'metadata.json');
  if (fs.existsSync(metaPath)) {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    const tiles = meta
      .filter(m => fs.existsSync(path.join(glbDir, m.tile + '.glb')))
      .map(m => ({ glb: 'glb/' + m.tile + '.glb', img: 'img/' + m.tile + '.png',
        x: m.x, y: m.y,
        worldMinX: m.worldMinX, worldMinY: m.worldMinY,
        worldMaxX: m.worldMaxX, worldMaxY: m.worldMaxY }));
    return res.json({ tiles });
  }

  // Fallback: list GLB files in glb/
  const tiles = fs.readdirSync(glbDir)
    .filter(f => f.endsWith('.glb'))
    .map(f => {
      const m = f.match(/^comp_(-?\d+)_(-?\d+)\.glb$/);
      return m ? { glb: 'glb/' + f, img: 'img/' + f.replace('.glb', '.png'), x: parseInt(m[1]), y: parseInt(m[2]) } : null;
    })
    .filter(Boolean);
  res.json({ tiles });
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

    // Build unified connections list (deduplicated by entity index)
    const connMap = new Map();
    for (const conn of result.connections) {
      for (const ent of [conn.source, conn.target]) {
        if (ent) connMap.set(ent.index, ent);
      }
    }

    broadcast({
      type: 'editResult',
      added: result.added.map(e => ({ index: e.index, item: e.item, classUpdate: e.classUpdate })),
      updated: result.updated.map(e => ({ index: e.index, item: e.item, classUpdate: e.classUpdate })),
      deleted: result.deleted,
      connections: [...connMap.values()],
    });

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
