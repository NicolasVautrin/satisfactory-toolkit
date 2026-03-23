const fs = require('fs');
const path = require('path');
const express = require('express');
const { Parser } = require('@etothepii/satisfactory-file-parser');
const { readFileAsArrayBuffer, initSession } = require('../satisfactoryLib');
const Blueprint = require('../lib/Blueprint');

const STEAM_ID = '76561198036887614';
const GAME_SAVES = path.join(process.env.LOCALAPPDATA, 'FactoryGame/Saved/SaveGames', STEAM_ID);

// ── Load clearance data ────────────────────────────────────────────
const clearanceData = require('../data/clearanceData.json');

// ── Current save state ─────────────────────────────────────────────
let currentSaveName = null;
let allObjects = [];
let entities = [];
let entityData = null;

// ── Classify entities ──────────────────────────────────────────────
const CATEGORY_PATTERNS = [
  { cat: 0, name: 'Producers',   re: /Constructor|Smelter|Foundry|Assembler|Manufacturer|Refinery|Blender|Packager|HadronCollider|Converter|QuantumEncoder|NuclearPower/ },
  { cat: 1, name: 'Extractors',  re: /Miner|WaterPump|OilPump|Fracking/ },
  { cat: 2, name: 'Belts',       re: /Conveyor|Splitter|Merger/ },
  { cat: 3, name: 'Pipes',       re: /Pipeline|PipeHyper|Valve|JunctionCross|PipelinePump/ },
  { cat: 4, name: 'Power',       re: /PowerLine|PowerPole|PowerSwitch|PowerStorage|Generator|PowerTower/ },
  { cat: 5, name: 'Railway',     re: /Train|Railroad|Station|Locomotive|FreightWagon/ },
  { cat: 6, name: 'Structural',  re: /Foundation|Wall_|Ramp|Beam|Pillar|Roof|Stair|Walkway|Catwalk|Fence|Frame/ },
];

function classify(typePath) {
  const cls = typePath.split('.').pop();
  for (const { cat, re } of CATEGORY_PATTERNS) {
    if (re.test(cls)) return cat;
  }
  return 7; // Other
}

// ── Hermite spline sampling ────────────────────────────────────────
function sampleHermiteSpline(points, samplesPerSpan = 6) {
  const result = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i], p1 = points[i + 1];
    for (let s = 0; s <= samplesPerSpan; s++) {
      if (s === 0 && i > 0) continue; // avoid duplicate at join
      const t = s / samplesPerSpan;
      const t2 = t * t, t3 = t2 * t;
      const h00 = 2 * t3 - 3 * t2 + 1;
      const h10 = t3 - 2 * t2 + t;
      const h01 = -2 * t3 + 3 * t2;
      const h11 = t3 - t2;
      result.push({
        x: h00 * p0.x + h10 * p0.lx + h01 * p1.x + h11 * p1.ax,
        y: h00 * p0.y + h10 * p0.ly + h01 * p1.y + h11 * p1.ay,
        z: h00 * p0.z + h10 * p0.lz + h01 * p1.z + h11 * p1.az,
      });
    }
  }
  return result;
}

function extractSplineSegments(entity) {
  const splineData = entity.properties?.mSplineData;
  if (!splineData) return null;

  const values = splineData.values;
  if (!values || values.length < 2) return null;

  // Parse spline points
  const points = [];
  for (const pt of values) {
    const props = pt.value?.properties || pt.properties;
    if (!props) continue;
    const loc = props.Location?.value || props.Location;
    const arrive = props.ArriveTangent?.value || props.ArriveTangent;
    const leave = props.LeaveTangent?.value || props.LeaveTangent;
    if (!loc) continue;
    points.push({
      x: loc.x, y: loc.y, z: loc.z,
      ax: arrive?.x || 0, ay: arrive?.y || 0, az: arrive?.z || 0,
      lx: leave?.x || 0, ly: leave?.y || 0, lz: leave?.z || 0,
    });
  }

  if (points.length < 2) return null;

  // Sample the spline
  const sampled = sampleHermiteSpline(points, 3);

  // Transform to world space: spline points are in local space
  const t = entity.transform.translation;
  const r = entity.transform.rotation;
  // Quaternion rotation
  const worldPts = sampled.map(p => {
    const rx = r.x, ry = r.y, rz = r.z, rw = r.w;
    // q * v * q^-1 (optimized)
    const cx = ry * p.z - rz * p.y;
    const cy = rz * p.x - rx * p.z;
    const cz = rx * p.y - ry * p.x;
    const cx2 = ry * cz - rz * cy;
    const cy2 = rz * cx - rx * cz;
    const cz2 = rx * cy - ry * cx;
    return {
      x: p.x + 2 * (rw * cx + cx2) + t.x,
      y: p.y + 2 * (rw * cy + cy2) + t.y,
      z: p.z + 2 * (rw * cz + cz2) + t.z,
    };
  });

  // Convert to segments: [startPos, endPos, ...]
  const segments = [];
  for (let i = 0; i < worldPts.length - 1; i++) {
    segments.push(worldPts[i], worldPts[i + 1]);
  }
  return segments;
}

// ── Build entity data for the client ───────────────────────────────
function buildEntityData(entities, lwInstances) {
  const classNames = [];
  const classNameIndex = {};
  const classNameClearance = {};

  const items = [];

  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    const cls = e.typePath.split('.').pop();

    // Deduplicate classNames
    if (classNameIndex[cls] === undefined) {
      classNameIndex[cls] = classNames.length;
      classNames.push(cls);

      // Attach clearance for this className
      const cl = clearanceData[cls];
      if (cl) {
        classNameClearance[classNameIndex[cls]] = cl.boxes.map(b => ({
          min: b.min, max: b.max,
          rt: b.relativeTransform?.translation || null,
        }));
      }
    }

    const t = e.transform.translation;
    const r = e.transform.rotation;

    const item = {
      c: classNameIndex[cls],
      tx: t.x, ty: t.y, tz: t.z,
      rx: r.x, ry: r.y, rz: r.z, rw: r.w,
      cat: classify(e.typePath),
    };

    // Extract lift as vertical spline (bottom → top)
    if (cls.startsWith('Build_ConveyorLift')) {
      const topTrans = e.properties?.mTopTransform?.value?.properties?.Translation?.value;
      if (topTrans) {
        const t = e.transform.translation;
        const r = e.transform.rotation;
        // Rotate topTranslation by entity quaternion to get world offset
        const vx = topTrans.x, vy = topTrans.y, vz = topTrans.z;
        const rx = r.x, ry = r.y, rz = r.z, rw = r.w;
        const cx = ry * vz - rz * vy;
        const cy = rz * vx - rx * vz;
        const cz = rx * vy - ry * vx;
        const cx2 = ry * cz - rz * cy;
        const cy2 = rz * cx - rx * cz;
        const cz2 = rx * cy - ry * cx;
        const topX = t.x + vx + 2 * (rw * cx + cx2);
        const topY = t.y + vy + 2 * (rw * cy + cy2);
        const topZ = t.z + vz + 2 * (rw * cz + cz2);
        item.sp = [
          [Math.round(t.x * 10) / 10, Math.round(t.y * 10) / 10, Math.round(t.z * 10) / 10],
          [Math.round(topX * 10) / 10, Math.round(topY * 10) / 10, Math.round(topZ * 10) / 10],
        ];
      }
    }

    // Extract spline points for belts, pipes, rails
    const splineSegs = extractSplineSegments(e);
    if (splineSegs) {
      // Send sampled world-space points as [[x,y,z], ...]
      // extractSplineSegments returns pairs [start, end, start, end, ...] — deduplicate to just points
      const pts = [];
      for (let s = 0; s < splineSegs.length; s += 2) {
        if (s === 0) pts.push(splineSegs[s]);
        pts.push(splineSegs[s + 1]);
      }
      item.sp = pts.map(p => [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, Math.round(p.z * 10) / 10]);
    }

    items.push(item);
  }

  // Add lightweight buildables (foundations, walls, ramps, etc.)
  for (const lw of lwInstances) {
    if (classNameIndex[lw.cls] === undefined) {
      classNameIndex[lw.cls] = classNames.length;
      classNames.push(lw.cls);

      const cl = clearanceData[lw.cls];
      if (cl) {
        classNameClearance[classNameIndex[lw.cls]] = cl.boxes.map(b => ({
          min: b.min, max: b.max,
          rt: b.relativeTransform?.translation || null,
        }));
      }
    }

    const t = lw.transform.translation;
    const r = lw.transform.rotation;
    items.push({
      c: classNameIndex[lw.cls],
      tx: t.x, ty: t.y, tz: t.z,
      rx: r.x, ry: r.y, rz: r.z, rw: r.w,
      cat: classify(lw.typePath),
    });
  }

  return { classNames, clearance: classNameClearance, entities: items };
}

// ── Load a save file ───────────────────────────────────────────────
function loadSave(saveName) {
  const savePath = path.join(GAME_SAVES, `${saveName}.sav`);
  console.log(`Loading ${savePath}...`);
  const buf = readFileAsArrayBuffer(savePath);
  const save = Parser.ParseSave(saveName, buf);
  allObjects = Object.values(save.levels).flatMap(l => l.objects);
  const allEntities = allObjects.filter(o => o.type === 'SaveEntity' && o.transform);

  // Only keep player-built entities (Build_*)
  entities = allEntities.filter(o => {
    const cls = o.typePath.split('.').pop();
    return cls.startsWith('Build_');
  });
  console.log(`Loaded ${entities.length} buildable entities (${allEntities.length} total)`);

  // Load lightweight buildables
  const lwSub = allObjects.find(o => o.typePath?.includes('LightweightBuildable'));
  const lwInstances = [];
  if (lwSub && lwSub.specialProperties?.buildables) {
    for (const b of lwSub.specialProperties.buildables) {
      const typePath = b.typeReference.pathName;
      const cls = typePath.split('.').pop();
      for (const inst of b.instances) {
        lwInstances.push({ typePath, cls, transform: inst.transform });
      }
    }
  }
  console.log(`Loaded ${lwInstances.length} lightweight buildables`);

  entityData = buildEntityData(entities, lwInstances);
  currentSaveName = saveName;
  console.log(`Prepared ${entityData.classNames.length} unique classNames`);
}

// ── Pre-load save from CLI arg if provided ─────────────────────────
const cliSaveName = process.argv[2];
if (cliSaveName) {
  loadSave(cliSaveName);
}

// ── Express ────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/saves', (req, res) => {
  try {
    const files = fs.readdirSync(GAME_SAVES)
      .filter(f => f.endsWith('.sav'))
      .map(f => {
        const stat = fs.statSync(path.join(GAME_SAVES, f));
        return { name: f.replace('.sav', ''), size: stat.size, mtime: stat.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
    res.json({ saves: files, current: currentSaveName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/load', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  try {
    loadSave(name);
    res.json({ success: true, entities: entityData.entities.length, classNames: entityData.classNames.length });
  } catch (err) {
    console.error('Load error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/entities', (req, res) => {
  if (!entityData) return res.status(404).json({ error: 'No save loaded' });
  res.json(entityData);
});

app.post('/api/export', (req, res) => {
  try {
    const { indices, name } = req.body;
    if (!indices?.length || !name) {
      return res.status(400).json({ error: 'indices and name required' });
    }

    initSession();

    // Compute centroid of selected entities
    let cx = 0, cy = 0, cz = 0;
    const selected = [];
    for (const idx of indices) {
      const e = entities[idx];
      if (!e) continue;
      selected.push(e);
      cx += e.transform.translation.x;
      cy += e.transform.translation.y;
      cz += e.transform.translation.z;
    }
    cx /= selected.length;
    cy /= selected.length;
    cz /= selected.length;

    // Create blueprint at centroid
    const bp = Blueprint.create(name, cx, cy, cz);
    bp._objects = selected.map(e => bp._cloneObject(e));

    // Also grab associated components
    const selectedNames = new Set(selected.map(e => e.instanceName));
    const components = allObjects.filter(o =>
      o.type === 'SaveComponent' && selectedNames.has(o.parentEntityName)
    );
    for (const comp of components) {
      bp._objects.push(bp._cloneObject(comp));
    }

    const bpDir = path.join(GAME_SAVES, '..', 'blueprints', '08072023');
    const sbpPath = path.join(bpDir, `${name}.sbp`);
    const cfgPath = path.join(bpDir, `${name}.sbpcfg`);

    bp.toFile(sbpPath, cfgPath, { description: name });

    res.json({ success: true, sbpPath, cfgPath, count: selected.length });
  } catch (err) {
    console.error('Export error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/shutdown', (req, res) => {
  res.json({ success: true });
  console.log('Shutdown requested');
  process.exit(0);
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Viewer: http://localhost:${PORT}`);
});
