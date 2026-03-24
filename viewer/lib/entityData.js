const clearanceData = require('../../data/clearanceData.json');
const Registry = require('../../lib/Registry');
const { quatRotate, extractSplineSegments, extractCbpSplineSegments, segmentsToPoints } = require('./spline');

const registry = Registry.default();

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

// ── Port layout collection ──────────────────────────────────────────
function collectPortLayouts(classNames) {
  const layouts = {};
  for (let i = 0; i < classNames.length; i++) {
    const cls = classNames[i];
    const Builder = registry.get(cls);
    if (!Builder?.PORT_LAYOUT) continue;
    const ports = Object.entries(Builder.PORT_LAYOUT)
      .filter(([, p]) => p.type !== 'power')
      .map(([name, p]) => ({
        n: name,
        ox: p.offset.x, oy: p.offset.y, oz: p.offset.z,
        dx: p.dir.x, dy: p.dir.y, dz: p.dir.z,
        flow: p.flow === 'input' ? 0 : 1,
        type: p.type === 'belt' ? 0 : 1, // 0=belt, 1=pipe
      }));
    if (ports.length > 0) layouts[i] = ports;
  }
  return layouts;
}

// ── Build entity data for save (parser format) ─────────────────────
function buildSaveEntityData(entities, lwInstances, compByName) {
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

    // ConveyorLift → lift data (bottom + top endpoints)
    if (cls.startsWith('Build_ConveyorLift')) {
      const topTrans = e.properties?.mTopTransform?.value?.properties?.Translation?.value;
      if (topTrans) {
        const rotated = quatRotate(r, topTrans.x, topTrans.y, topTrans.z);
        item.lift = [
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

    // Port connection state
    const Builder = registry.get(cls);
    if (Builder?.PORT_LAYOUT && e.components) {
      const portEntries = Object.entries(Builder.PORT_LAYOUT)
        .filter(([, p]) => p.type !== 'power');
      if (portEntries.length > 0) {
        const cn = [];
        for (const [portName] of portEntries) {
          const compPath = e.instanceName + '.' + portName;
          const comp = compByName.get(compPath);
          cn.push(comp?.properties?.mConnectedComponent?.value?.pathName ? 1 : 0);
        }
        item.cn = cn;
      }
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

  const portLayouts = collectPortLayouts(classNames);
  return { classNames, clearance: classNameClearance, entities: items, portLayouts };
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

module.exports = { classify, buildSaveEntityData, buildCbpEntityData };