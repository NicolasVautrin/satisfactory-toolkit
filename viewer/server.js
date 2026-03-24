const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const express = require('express');
const { Parser } = require('@etothepii/satisfactory-file-parser');
const { initSession } = require('../satisfactoryLib');
const Blueprint = require('../lib/Blueprint');

// ── Load clearance data ────────────────────────────────────────────
const clearanceData = require('../data/clearanceData.json');

// ── Two independent data slots ─────────────────────────────────────
let saveState = null;  // { name, save, allObjects, entities, entityData }
let cbpState = null;   // { name, raw, entityData }

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

// ── Quaternion rotate helper ───────────────────────────────────────
function quatRotate(r, vx, vy, vz) {
  const cx = r.y * vz - r.z * vy;
  const cy = r.z * vx - r.x * vz;
  const cz = r.x * vy - r.y * vx;
  const cx2 = r.y * cz - r.z * cy;
  const cy2 = r.z * cx - r.x * cz;
  const cz2 = r.x * cy - r.y * cx;
  return {
    x: vx + 2 * (r.w * cx + cx2),
    y: vy + 2 * (r.w * cy + cy2),
    z: vz + 2 * (r.w * cz + cz2),
  };
}

// ── Extract spline from save entity (parser format) ────────────────
function extractSplineSegments(entity) {
  const splineData = entity.properties?.mSplineData;
  if (!splineData) return null;

  const values = splineData.values;
  if (!values || values.length < 2) return null;

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
  return splineToWorldSegments(points, entity.transform);
}

// ── Extract spline from CBP entity (SCIM format) ──────────────────
function extractCbpSplineSegments(propsArray, transform) {
  const splineProp = propsArray.find(p => p.name === 'mSplineData');
  if (!splineProp) return null;

  const values = splineProp.value?.values;
  if (!values || values.length < 2) return null;

  const points = [];
  for (const ptArray of values) {
    // ptArray is [{name:"Location",...}, {name:"ArriveTangent",...}, {name:"LeaveTangent",...}]
    const locProp = ptArray.find(p => p.name === 'Location');
    const arriveProp = ptArray.find(p => p.name === 'ArriveTangent');
    const leaveProp = ptArray.find(p => p.name === 'LeaveTangent');
    const loc = locProp?.value?.values;
    const arrive = arriveProp?.value?.values;
    const leave = leaveProp?.value?.values;
    if (!loc) continue;
    points.push({
      x: loc.x, y: loc.y, z: loc.z,
      ax: arrive?.x || 0, ay: arrive?.y || 0, az: arrive?.z || 0,
      lx: leave?.x || 0, ly: leave?.y || 0, lz: leave?.z || 0,
    });
  }

  if (points.length < 2) return null;
  return splineToWorldSegments(points, transform);
}

// ── Shared: sample spline + transform to world space ───────────────
function splineToWorldSegments(points, transform) {
  const sampled = sampleHermiteSpline(points, 3);
  const t = transform.translation;
  const r = transform.rotation;

  const worldPts = sampled.map(p => {
    const rotated = quatRotate(r, p.x, p.y, p.z);
    return { x: rotated.x + t.x, y: rotated.y + t.y, z: rotated.z + t.z };
  });

  const segments = [];
  for (let i = 0; i < worldPts.length - 1; i++) {
    segments.push(worldPts[i], worldPts[i + 1]);
  }
  return segments;
}

// ── Deduplicate spline segments → point array ──────────────────────
function segmentsToPoints(segments) {
  const pts = [];
  for (let s = 0; s < segments.length; s += 2) {
    if (s === 0) pts.push(segments[s]);
    pts.push(segments[s + 1]);
  }
  return pts.map(p => [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, Math.round(p.z * 10) / 10]);
}

// ── Register className + clearance ─────────────────────────────────
function registerClass(cls, classNames, classNameIndex, classNameClearance) {
  if (classNameIndex[cls] !== undefined) return;
  classNameIndex[cls] = classNames.length;
  classNames.push(cls);
  const cl = clearanceData[cls];
  if (cl) {
    classNameClearance[classNameIndex[cls]] = cl.boxes.map(b => ({
      min: b.min, max: b.max,
      rt: b.relativeTransform?.translation || null,
    }));
  }
}

// ── Build entity data for save (parser format) ─────────────────────
function buildSaveEntityData(entities, lwInstances) {
  const classNames = [];
  const classNameIndex = {};
  const classNameClearance = {};
  const items = [];

  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    const cls = e.typePath.split('.').pop();
    registerClass(cls, classNames, classNameIndex, classNameClearance);

    const t = e.transform.translation;
    const r = e.transform.rotation;
    const item = {
      c: classNameIndex[cls],
      tx: t.x, ty: t.y, tz: t.z,
      rx: r.x, ry: r.y, rz: r.z, rw: r.w,
      cat: classify(e.typePath),
    };

    // ConveyorLift → vertical spline
    if (cls.startsWith('Build_ConveyorLift')) {
      const topTrans = e.properties?.mTopTransform?.value?.properties?.Translation?.value;
      if (topTrans) {
        const rotated = quatRotate(r, topTrans.x, topTrans.y, topTrans.z);
        item.sp = [
          [Math.round(t.x * 10) / 10, Math.round(t.y * 10) / 10, Math.round(t.z * 10) / 10],
          [Math.round((t.x + rotated.x) * 10) / 10, Math.round((t.y + rotated.y) * 10) / 10, Math.round((t.z + rotated.z) * 10) / 10],
        ];
      }
    }

    // Splines (belts, pipes, rails)
    const splineSegs = extractSplineSegments(e);
    if (splineSegs) {
      item.sp = segmentsToPoints(splineSegs);
    }

    items.push(item);
  }

  // Lightweight buildables
  for (const lw of lwInstances) {
    registerClass(lw.cls, classNames, classNameIndex, classNameClearance);
    const t = lw.transform.translation;
    const r = lw.transform.rotation;
    const item = {
      c: classNameIndex[lw.cls],
      tx: t.x, ty: t.y, tz: t.z,
      rx: r.x, ry: r.y, rz: r.z, rw: r.w,
      cat: classify(lw.typePath),
    };
    // Beams: per-instance clearance box along local X
    if (lw.beamLength) {
      item.box = { min: { x: -lw.beamLength, y: -50, z: -50 }, max: { x: 0, y: 50, z: 50 } };
    }
    items.push(item);
  }

  return { classNames, clearance: classNameClearance, entities: items };
}

// ── Build entity data for CBP (SCIM format) ────────────────────────
function buildCbpEntityData(cbpRaw) {
  const classNames = [];
  const classNameIndex = {};
  const classNameClearance = {};
  const items = [];

  for (const entry of cbpRaw.data) {
    const p = entry.parent;
    if (!p || !p.className) continue;
    const cls = p.className.split('.').pop();

    // Skip non-buildable metadata objects
    if (!cls.startsWith('Build_')) continue;

    registerClass(cls, classNames, classNameIndex, classNameClearance);

    const tr = p.transform;
    const t = { x: tr.translation[0], y: tr.translation[1], z: tr.translation[2] };
    const r = { x: tr.rotation[0], y: tr.rotation[1], z: tr.rotation[2], w: tr.rotation[3] };

    const item = {
      c: classNameIndex[cls],
      tx: t.x, ty: t.y, tz: t.z,
      rx: r.x, ry: r.y, rz: r.z, rw: r.w,
      cat: classify(p.className),
    };

    // Extract splines from CBP properties array
    if (p.properties && Array.isArray(p.properties)) {
      const splineSegs = extractCbpSplineSegments(p.properties, { translation: t, rotation: r });
      if (splineSegs) {
        item.sp = segmentsToPoints(splineSegs);
      }
    }

    items.push(item);
  }

  return { classNames, clearance: classNameClearance, entities: items };
}

// ── Load a save file (from upload buffer) ──────────────────────────
function loadSave(name, buf) {
  console.log(`Loading save "${name}" (${(buf.byteLength / 1024 / 1024).toFixed(1)} MB)...`);
  const save = Parser.ParseSave(name, buf);
  const allObjects = Object.values(save.levels).flatMap(l => l.objects);
  const allEntities = allObjects.filter(o => o.type === 'SaveEntity' && o.transform);

  const entities = allEntities.filter(o => {
    const cls = o.typePath.split('.').pop();
    return cls.startsWith('Build_');
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

  const entityData = buildSaveEntityData(entities, lwInstances);
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

// ── Load heightmap ─────────────────────────────────────────────────
const HEIGHTMAP_PATH = path.join(__dirname, '..', 'data', 'heightmap.json');
let heightmapData = null;
if (fs.existsSync(HEIGHTMAP_PATH)) {
  heightmapData = JSON.parse(fs.readFileSync(HEIGHTMAP_PATH, 'utf-8'));
  console.log(`Heightmap: ${heightmapData.gridSize}x${heightmapData.gridSize}`);
} else {
  console.warn('No heightmap found. Run: node tools/generateHeightmap.js');
}

// ── Express ────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/upload', express.raw({ type: 'application/octet-stream', limit: '500mb' }), (req, res) => {
  const fileName = req.headers['x-save-name'] || 'uploaded';
  const ext = path.extname(fileName).toLowerCase();
  const name = path.basename(fileName, ext);

  try {
    const buf = req.body.buffer.slice(req.body.byteOffset, req.body.byteOffset + req.body.byteLength);

    if (ext === '.cbp') {
      loadCbp(name, buf);
      res.json({ type: 'cbp', cbp: cbpState.entityData });
    } else {
      // Default: treat as .sav
      loadSave(name, buf);
      res.json({ type: 'save', save: saveState.entityData });
    }
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/terrain', (req, res) => {
  if (!heightmapData) return res.status(404).json({ error: 'No heightmap. Run: node tools/generateHeightmap.js' });
  res.json(heightmapData);
});

app.post('/api/export', (req, res) => {
  try {
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

    const bp = Blueprint.create(name, cx, cy, cz);
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

      // Beams need mLength
      if (lw.beamLength) {
        props.mLength = { type: 'FloatProperty', ueType: 'FloatProperty', name: 'mLength', value: lw.beamLength };
      }

      // Recipe from the lightweight instance
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
    // Generate blueprint buffers without writing to disk
    const { sbpBuf, cfgBuf } = bp.toBuffers({ name, description: name });

    // Send both files as JSON with base64-encoded buffers
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

// ── Merge CBP into save ────────────────────────────────────────────
// CBP v1.0 uses short type names, normalize to *Property format
const TYPE_ALIASES = {
  Struct: 'StructProperty', Array: 'ArrayProperty', Object: 'ObjectProperty',
  Float: 'FloatProperty', Int: 'IntProperty', Bool: 'BoolProperty',
  Byte: 'ByteProperty', Str: 'StrProperty', Text: 'TextProperty',
  SoftObject: 'SoftObjectProperty', Enum: 'EnumProperty', Name: 'NameProperty',
};

function inferCbpType(prop) {
  if (prop.type) return TYPE_ALIASES[prop.type] || prop.type;
  const v = prop.value;
  if (v === undefined || v === null) return undefined;
  // Infer from value structure
  if (typeof v === 'object' && v.pathName !== undefined) return 'ObjectProperty';
  if (typeof v === 'object' && v.values !== undefined) return 'StructProperty';
  if (typeof v === 'number' && Number.isInteger(v)) return 'IntProperty';
  if (typeof v === 'number') return 'FloatProperty';
  if (typeof v === 'boolean') return 'BoolProperty';
  if (typeof v === 'string') return 'StrProperty';
  if (typeof v === 'object' && v.type !== undefined) return 'StructProperty';
  return undefined;
}

function convertCbpProperty(cbpProp) {
  // Convert a single CBP property (SCIM format) to parser format
  const { name, value } = cbpProp;
  const type = inferCbpType(cbpProp);

  if (type === 'StructProperty') {
    if (value?.type === 'Vector' && value.values) {
      return {
        type: 'StructProperty', ueType: 'StructProperty', name,
        value: { x: value.values.x, y: value.values.y, z: value.values.z },
        subtype: 'Vector',
      };
    }
    if (value?.type === 'Rotator' && value.values) {
      return {
        type: 'StructProperty', ueType: 'StructProperty', name,
        value: { pitch: value.values.pitch, yaw: value.values.yaw, roll: value.values.roll },
        subtype: 'Rotator',
      };
    }
    if (value?.type === 'FactoryCustomizationData') {
      // Convert values array to properties object
      const props = {};
      for (const sub of (value.values || [])) {
        props[sub.name] = convertCbpProperty(sub);
      }
      return {
        type: 'StructProperty', ueType: 'StructProperty', name,
        value: { type: 'FactoryCustomizationData', properties: props },
        subtype: 'FactoryCustomizationData',
      };
    }
    if (value?.type === 'SplinePointData') {
      // Handled as part of ArrayProperty mSplineData
      return cbpProp;
    }
    // Struct with values as plain object (LinearColor, Box, Quat, etc.)
    if (value?.values && !Array.isArray(value.values) && typeof value.values === 'object') {
      return {
        type: 'StructProperty', ueType: 'StructProperty', name,
        value: { ...value.values },
        subtype: value.type,
      };
    }
    // Generic struct: convert values array to properties
    if (Array.isArray(value?.values)) {
      const props = {};
      for (const sub of value.values) {
        props[sub.name] = convertCbpProperty(sub);
      }
      return {
        type: 'StructProperty', ueType: 'StructProperty', name,
        value: { type: value.type, properties: props },
        subtype: value.type,
      };
    }
    return { ...cbpProp, type: 'StructProperty', ueType: 'StructProperty' };
  }

  if (type === 'ObjectProperty') {
    return {
      type: 'ObjectProperty', ueType: 'ObjectProperty', name,
      value: { levelName: value?.levelName || '', pathName: value?.pathName || '' },
    };
  }

  if (type === 'ArrayProperty') {
    const valueType = TYPE_ALIASES[value?.type] || value?.type;
    if (valueType === 'ObjectProperty') {
      return {
        type: 'ObjectArrayProperty', ueType: 'ArrayProperty', name,
        subtype: 'ObjectProperty',
        values: (value.values || []).map(v => ({
          levelName: v?.levelName || '', pathName: v?.pathName || '',
        })),
      };
    }
    if (valueType === 'StructProperty') {
      const structSubType = cbpProp.structureSubType || 'Generic';
      const converted = (value.values || []).map(ptArray => {
        if (Array.isArray(ptArray)) {
          const props = {};
          for (const sub of ptArray) {
            props[sub.name] = convertCbpProperty(sub);
          }
          return {
            type: 'StructProperty', ueType: 'StructProperty', name: '',
            subtype: structSubType,
            value: { type: structSubType, properties: props },
          };
        }
        return ptArray;
      });
      const result = {
        type: 'StructArrayProperty', ueType: 'ArrayProperty', name,
        subtype: 'StructProperty',
        values: converted,
      };
      if (cbpProp.structureSubType) {
        result.structValueFields = { allStructType: cbpProp.structureSubType };
      }
      return result;
    }
    // Primitive arrays (Int, Float, Byte, Bool, Str, Enum, SoftObject)
    if (valueType && value?.values) {
      // Map short subtype to parser's expected array type name
      const arrayTypeMap = {
        IntProperty: 'Int32ArrayProperty',
        Int64Property: 'Int64ArrayProperty',
        FloatProperty: 'FloatArrayProperty',
        DoubleProperty: 'DoubleArrayProperty',
        ByteProperty: 'ByteArrayProperty',
        BoolProperty: 'BoolArrayProperty',
        StrProperty: 'StrArrayProperty',
        EnumProperty: 'EnumArrayProperty',
        SoftObjectProperty: 'SoftObjectArrayProperty',
        TextProperty: 'TextArrayProperty',
      };
      const arrayType = arrayTypeMap[valueType] || 'ArrayProperty';
      return {
        type: arrayType, ueType: 'ArrayProperty', name,
        subtype: valueType,
        values: value.values,
      };
    }
    return { ...cbpProp, type: 'ArrayProperty', ueType: 'ArrayProperty' };
  }

  if (type === 'FloatProperty') {
    return { type: 'FloatProperty', ueType: 'FloatProperty', name, value };
  }
  if (type === 'IntProperty') {
    return { type: 'IntProperty', ueType: 'IntProperty', name, value };
  }
  if (type === 'BoolProperty') {
    return { type: 'BoolProperty', ueType: 'BoolProperty', name, value };
  }
  if (type === 'ByteProperty') {
    // CBP uses {enumName, value}, parser uses {type, value}
    const byteVal = (value && typeof value === 'object')
      ? { type: value.enumName || value.type || 'None', value: value.value }
      : { type: 'None', value: value || 0 };
    return { type: 'ByteProperty', ueType: 'ByteProperty', name, value: byteVal };
  }
  if (type === 'StrProperty') {
    return { type: 'StrProperty', ueType: 'StrProperty', name, value };
  }
  if (type === 'TextProperty') {
    // Parser expects { type, ueType, name, value: { flags, historyType, ... } }
    // CBP has flags/historyType/value at the prop level
    const textValue = {};
    if (cbpProp.flags !== undefined) textValue.flags = cbpProp.flags;
    else textValue.flags = 0;
    if (cbpProp.historyType !== undefined) textValue.historyType = cbpProp.historyType;
    else textValue.historyType = 255;
    // Copy all text-specific fields
    if (cbpProp.hasCultureInvariantString !== undefined) textValue.hasCultureInvariantString = !!cbpProp.hasCultureInvariantString;
    if (cbpProp.value !== undefined && typeof cbpProp.value === 'string') textValue.value = cbpProp.value;
    if (cbpProp.namespace !== undefined) textValue.namespace = cbpProp.namespace;
    if (cbpProp.key !== undefined) textValue.key = cbpProp.key;
    if (cbpProp.sourceFmt !== undefined) textValue.sourceFmt = cbpProp.sourceFmt;
    if (cbpProp.arguments !== undefined) textValue.arguments = cbpProp.arguments;
    if (cbpProp.sourceText !== undefined) textValue.sourceText = cbpProp.sourceText;
    if (cbpProp.transformType !== undefined) textValue.transformType = cbpProp.transformType;
    if (cbpProp.tableId !== undefined) textValue.tableId = cbpProp.tableId;
    if (cbpProp.textKey !== undefined) textValue.textKey = cbpProp.textKey;
    return { type: 'TextProperty', ueType: 'TextProperty', name, value: textValue };
  }
  if (type === 'SoftObjectProperty') {
    // Parser expects { pathName, instanceName, unk }
    // CBP has { pathName, subPathString }
    const softVal = {
      pathName: value?.pathName || '',
      instanceName: value?.subPathString || value?.instanceName || '',
      unk: value?.unk || 0,
    };
    return { type: 'SoftObjectProperty', ueType: 'SoftObjectProperty', name, value: softVal };
  }
  if (type === 'EnumProperty') {
    return { type: 'EnumProperty', ueType: 'EnumProperty', name, value };
  }

  // Fallback: ensure ueType is set
  return { ...cbpProp, type: type, ueType: type };
}

function convertCbpProperties(propsArray) {
  const result = {};
  for (const prop of propsArray) {
    result[prop.name] = convertCbpProperty(prop);
  }
  return result;
}

// Deep-ensure all property-like objects have ueType set
function deepEnsureUeType(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) { obj.forEach(deepEnsureUeType); return obj; }

  // If it looks like a property (has name + type), ensure ueType
  if (obj.name !== undefined && obj.type && !obj.ueType) {
    const normalized = TYPE_ALIASES[obj.type] || obj.type;
    obj.type = normalized;
    obj.ueType = normalized;
  }
  // Ensure StructProperty has subtype
  if ((obj.type === 'StructProperty' || obj.ueType === 'StructProperty') && !obj.subtype) {
    obj.subtype = obj.value?.type || 'Generic';
  }
  // Ensure ObjectProperty has proper value format {levelName, pathName}
  if ((obj.type === 'ObjectProperty' || obj.ueType === 'ObjectProperty') && obj.value) {
    if (obj.value.levelName === undefined) obj.value.levelName = '';
    if (obj.value.pathName === undefined) obj.value.pathName = obj.value.pathName || '';
  }
  // Ensure ByteProperty value has proper format {type, value}
  if ((obj.type === 'ByteProperty' || obj.ueType === 'ByteProperty') && obj.value) {
    if (obj.value.type === undefined && obj.value.enumName !== undefined) {
      obj.value.type = obj.value.enumName;
      delete obj.value.enumName;
    }
    if (obj.value.type === undefined) obj.value.type = 'None';
  }

  for (const k of Object.keys(obj)) {
    if (typeof obj[k] === 'object' && obj[k] !== null) {
      deepEnsureUeType(obj[k]);
    }
  }
  return obj;
}

function mergeCbpIntoSave() {
  if (!saveState || !cbpState) throw new Error('Both save and CBP must be loaded');

  const sessionId = initSession();
  console.log(`Merge session: ${sessionId}`);

  const cbpRaw = cbpState.raw;
  // Re-parse save from stored buffer to get a fresh copy
  const save = Parser.ParseSave(saveState.name, saveState.saveBuf);

  // Find the main level (Persistent_Level or first level)
  const mainLevelKey = Object.keys(save.levels).find(k => {
    const objs = save.levels[k].objects;
    return objs.some(o => o.rootObject === 'Persistent_Level');
  }) || Object.keys(save.levels)[0];
  const mainLevel = save.levels[mainLevelKey];

  // Get reference entity for saveCustomVersion
  const refEntity = saveState.entities[0];
  const saveCustomVersion = refEntity?.saveCustomVersion || 52;

  // Build pathName remapping: old cbp pathNames → new unique pathNames
  const pathRemap = {};
  let counter = 0;

  // First pass: generate new pathNames for all entities
  for (const entry of cbpRaw.data) {
    const p = entry.parent;
    if (!p || !p.className) continue;
    const cls = p.className.split('.').pop();
    if (!cls.startsWith('Build_')) continue;

    const newId = `${sessionId}_${String(++counter).padStart(4, '0')}`;
    const newInstanceName = `Persistent_Level:PersistentLevel.${cls}_${newId}`;
    pathRemap[p.pathName] = newInstanceName;

    // Also remap children (components)
    if (p.children) {
      for (const child of p.children) {
        const compSuffix = child.pathName.split('.').pop(); // e.g. TrackConnection0
        pathRemap[child.pathName] = `${newInstanceName}.${compSuffix}`;
      }
    }
    if (entry.children) {
      for (const child of entry.children) {
        const compSuffix = child.pathName.split('.').pop();
        if (!pathRemap[child.pathName]) {
          pathRemap[child.pathName] = `${newInstanceName}.${compSuffix}`;
        }
      }
    }
  }

  // Also remap hiddenConnections pathNames
  for (const [oldPath] of Object.entries(cbpRaw.hiddenConnections || {})) {
    if (!pathRemap[oldPath]) {
      // hiddenConnections are subsystem components — generate new path
      const suffix = oldPath.split('.').pop();
      const newId = `${sessionId}_${String(++counter).padStart(4, '0')}`;
      pathRemap[oldPath] = `Persistent_Level:PersistentLevel.RailroadSubsystem.${suffix}_${newId}`;
    }
  }

  console.log(`PathName remap: ${Object.keys(pathRemap).length} entries`);

  // Helper: remap pathNames in a value recursively
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

  // Second pass: create SaveEntity + SaveComponent objects
  const newObjects = [];

  for (const entry of cbpRaw.data) {
    const p = entry.parent;
    if (!p || !p.className) continue;
    const cls = p.className.split('.').pop();
    if (!cls.startsWith('Build_')) continue;

    const newInstanceName = pathRemap[p.pathName];
    const tr = p.transform;

    // Build components references
    const components = [];
    const children = entry.children || [];
    for (const child of children) {
      const newChildPath = pathRemap[child.pathName];
      if (newChildPath) {
        components.push({ levelName: 'Persistent_Level', pathName: newChildPath });
      }
    }
    // Also from parent.children if different
    if (p.children) {
      for (const child of p.children) {
        const newChildPath = pathRemap[child.pathName];
        if (newChildPath && !components.find(c => c.pathName === newChildPath)) {
          components.push({ levelName: 'Persistent_Level', pathName: newChildPath });
        }
      }
    }

    // Convert properties
    const properties = p.properties ? remapPathNames(convertCbpProperties(p.properties)) : {};

    // Create SaveEntity
    const entity = {
      typePath: p.className,
      rootObject: 'Persistent_Level',
      instanceName: newInstanceName,
      flags: 8,
      properties,
      specialProperties: { type: 'EmptySpecialProperties' },
      trailingData: [],
      saveCustomVersion,
      shouldMigrateObjectRefsToPersistent: false,
      parentEntityName: '',
      type: 'SaveEntity',
      needTransform: true,
      wasPlacedInLevel: false,
      parentObject: { levelName: 'Persistent_Level', pathName: 'Persistent_Level:PersistentLevel.BuildableSubsystem' },
      transform: {
        rotation: { x: tr.rotation[0], y: tr.rotation[1], z: tr.rotation[2], w: tr.rotation[3] },
        translation: { x: tr.translation[0], y: tr.translation[1], z: tr.translation[2] },
        scale3d: { x: 1, y: 1, z: 1 },
      },
      components,
    };

    newObjects.push(entity);

    // Create SaveComponents for children
    for (const child of children) {
      const newChildPath = pathRemap[child.pathName];
      if (!newChildPath) continue;

      // Only convert essential component properties (connections, wires)
      // Skip complex properties (inventories, etc.) that the game will recreate
      const essentialProps = (child.properties || []).filter(p =>
        p.name === 'mConnectedComponents' || p.name === 'mWires' ||
        p.name === 'mHiddenConnections' || p.name === 'mConnectedTo' ||
        p.name === 'mRailroadTrackConnection' || p.name === 'mComponentDirection' ||
        p.name === 'mSwitchPosition' || p.name === 'mTargetConsumption'
      );
      const compProps = essentialProps.length > 0 ? remapPathNames(convertCbpProperties(essentialProps)) : {};

      const component = {
        typePath: child.className,
        rootObject: 'Persistent_Level',
        instanceName: newChildPath,
        flags: 262152,
        properties: compProps,
        specialProperties: { type: 'EmptySpecialProperties' },
        trailingData: [0, 0, 0, 0],
        saveCustomVersion,
        shouldMigrateObjectRefsToPersistent: false,
        parentEntityName: newInstanceName,
        type: 'SaveComponent',
      };

      newObjects.push(component);
    }
  }

  // Validate: deep check all properties have ueType
  function validateProps(props, path) {
    if (!props || typeof props !== 'object') return;
    for (const [pName, pVal] of Object.entries(props)) {
      if (!pVal || typeof pVal !== 'object') continue;
      if (pVal.name !== undefined && !pVal.ueType) {
        console.error(`MISSING ueType: ${path}.${pName} type=${pVal.type}`, JSON.stringify(pVal).slice(0, 200));
      }
      // Check nested struct properties
      if (pVal.value?.properties) validateProps(pVal.value.properties, `${path}.${pName}`);
      // Check array values
      if (Array.isArray(pVal.values)) {
        for (const v of pVal.values) {
          if (v?.value?.properties) validateProps(v.value.properties, `${path}.${pName}[]`);
        }
      }
    }
  }
  // Deep-normalize all properties to ensure ueType is set everywhere
  for (const obj of newObjects) {
    if (obj.properties) deepEnsureUeType(obj.properties);
  }

  // Validate after normalization
  for (const obj of newObjects) {
    if (obj.properties) validateProps(obj.properties, obj.instanceName);
  }

  // Inject into main level
  mainLevel.objects.push(...newObjects);
  console.log(`Injected ${newObjects.length} objects (entities + components) into ${mainLevelKey}`);

  // Write the modified save
  const outputName = `${saveState.name}_edit`;
  let headerBuf;
  const bodyChunks = [];
  Parser.WriteSave(save,
    h => { headerBuf = h; },
    c => { bodyChunks.push(c); }
  );
  const outputBuf = Buffer.concat([headerBuf, ...bodyChunks]);
  console.log(`Written save: ${(outputBuf.length / 1024 / 1024).toFixed(1)} MB`);

  return { outputName, outputBuf, entityCount: newObjects.filter(o => o.type === 'SaveEntity').length, totalCount: newObjects.length };
}

app.post('/api/merge', (req, res) => {
  try {
    const result = mergeCbpIntoSave();
    const { outputName, outputBuf, entityCount, totalCount } = result;
    // Send as downloadable file
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

app.post('/api/shutdown', (req, res) => {
  res.json({ success: true });
  console.log('Shutdown requested');
  process.exit(0);
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Viewer: http://localhost:${PORT}`);
});
