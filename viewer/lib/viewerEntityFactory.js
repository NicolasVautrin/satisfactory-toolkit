const clearanceData = require('../../data/clearanceData.json');
const Registry = require('../../lib/Registry');
const ConveyorLift = require('../../lib/logistic/ConveyorLift');
const { extractSplineSegments, extractCbpSplineSegments, segmentsToPoints } = require('./spline');

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

// ── Class registry: classNames, index, clearance ────────────────────
function createClassRegistry(existing) {
  const classNames = existing ? [...existing.classNames] : [];
  const index = {};
  for (let i = 0; i < classNames.length; i++) index[classNames[i]] = i;
  const clearance = existing ? { ...existing.clearance } : {};
  return { classNames, index, clearance };
}

function registerClass(cls, reg) {
  if (reg.index[cls] !== undefined) return;
  reg.index[cls] = reg.classNames.length;
  reg.classNames.push(cls);
  const cl = clearanceData[cls];
  if (cl) {
    reg.clearance[reg.index[cls]] = cl.boxes.map(b => ({
      min: b.min, max: b.max,
      rt: b.relativeTransform?.translation || null,
    }));
  }
}

// Known port definitions for spline builders (no PORT_LAYOUT)
const SPLINE_PORTS = {
  Build_RailroadTrack_C: [
    { n: 'TrackConnection0', flow: -1, type: 2 },
    { n: 'TrackConnection1', flow: -1, type: 2 },
  ],
  Build_RailroadTrackIntegrated_C: [
    { n: 'TrackConnection0', flow: -1, type: 2 },
    { n: 'TrackConnection1', flow: -1, type: 2 },
  ],
};

function collectPortLayouts(classNames) {
  const layouts = {};
  for (let i = 0; i < classNames.length; i++) {
    const cls = classNames[i];
    // Spline builders with known ports
    if (SPLINE_PORTS[cls]) {
      layouts[i] = SPLINE_PORTS[cls];
      continue;
    }
    const Builder = registry.get(cls);
    if (!Builder?.PORT_LAYOUT) continue;
    const ports = Object.entries(Builder.PORT_LAYOUT)
      .filter(([, p]) => p.type !== 'power')
      .map(([name, p]) => ({
        n: name,
        ox: p.offset.x, oy: p.offset.y, oz: p.offset.z,
        dx: p.dir.x, dy: p.dir.y, dz: p.dir.z,
        flow: p.flow === 'input' ? 0 : 1,
        type: p.type === 'belt' ? 0 : 1,
      }));
    if (ports.length > 0) layouts[i] = ports;
  }
  return layouts;
}

// ── Base item builder ───────────────────────────────────────────────
function makeItem(typePath, t, r, classIndex) {
  const cls = typePath.split('.').pop();
  return {
    c: classIndex[cls],
    tx: t.x, ty: t.y, tz: t.z,
    rx: r.x, ry: r.y, rz: r.z, rw: r.w,
    cat: classify(typePath),
  };
}

// ── Build a single save entity viewer item ──────────────────────────
function buildViewerEntity(entity, reg, compByName) {
  const cls = entity.typePath.split('.').pop();
  const item = makeItem(entity.typePath, entity.transform.translation, entity.transform.rotation, reg.index);

  // ConveyorLift → per-instance boxes + ports
  if (cls.startsWith('Build_ConveyorLift')) {
    const boxes = ConveyorLift.buildBoxes(entity);
    if (boxes) item.boxes = boxes;
    const ports = ConveyorLift.buildPortsLayout(entity);
    if (ports) {
      item.ports = ports;
      item.cn = ports.map(p => {
        const comp = compByName.get(entity.instanceName + '.' + p.n);
        return getPortConnRef(comp);
      });
      // Infer flow from connected component names
      for (let pi = 0; pi < ports.length; pi++) {
        const comp = compByName.get(entity.instanceName + '.' + ports[pi].n);
        const connPath = comp?.properties?.mConnectedComponent?.value?.pathName;
        if (!connPath) continue;
        const connPortName = connPath.split('.').pop();
        // Connected port is output → our port is input (0), and vice versa
        const connIsOutput = /^Output|ConveyorAny1$/.test(connPortName);
        const connIsInput = /^Input|ConveyorAny0$/.test(connPortName);
        if (connIsOutput) {
          ports[pi].flow = 0;      // input
          ports[1 - pi].flow = 1;  // output
          break;
        } else if (connIsInput) {
          ports[pi].flow = 1;      // output
          ports[1 - pi].flow = 0;  // input
          break;
        }
      }
    }
  }

  // Splines (belts, pipes, rails)
  const splineSegs = extractSplineSegments(entity);
  if (splineSegs) item.sp = segmentsToPoints(splineSegs);

  // Port connection state (class-based PORT_LAYOUT)
  const Builder = registry.get(cls);
  if (!item.cn && Builder?.PORT_LAYOUT && entity.components) {
    const portEntries = Object.entries(Builder.PORT_LAYOUT)
      .filter(([, p]) => p.type !== 'power');
    if (portEntries.length > 0) {
      item.cn = portEntries.map(([portName]) => {
        const comp = compByName.get(entity.instanceName + '.' + portName);
        return getPortConnRef(comp);
      });
    }
  }

  // Port connection state for spline builders (belt, pipe, track) without PORT_LAYOUT
  if (!item.cn && entity.components) {
    const portNames = ['TrackConnection0', 'TrackConnection1',
      'ConveyorAny0', 'ConveyorAny1',
      'PipelineConnection0', 'PipelineConnection1'];
    const found = portNames.filter(n => compByName.has(entity.instanceName + '.' + n));
    if (found.length > 0) {
      item.cn = found.map(portName => {
        const comp = compByName.get(entity.instanceName + '.' + portName);
        return getPortConnRef(comp);
      });
    }
  }

  // Entity label (mLabel StrProperty from editor)
  const mLabel = entity.properties?.mLabel?.value;
  if (mLabel) item.lb = mLabel;

  return item;
}

// ── Build entity data for save (parser format) ─────────────────────
function buildViewerEntitiesFromSave(entities, lwInstances, compByName, stationNames) {
  const reg = createClassRegistry();
  const items = [];
  const stationLabels = [];

  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    registerClass(e.typePath.split('.').pop(), reg);
    items.push(buildViewerEntity(e, reg, compByName));

    // Collect station label
    const name = stationNames?.get(e.instanceName);
    if (name) stationLabels.push({ ei: i, name });
  }

  // Lightweight buildables
  for (const lw of lwInstances) {
    registerClass(lw.cls, reg);
    const item = makeItem(lw.typePath, lw.transform.translation, lw.transform.rotation, reg.index);
    if (lw.beamLength) {
      item.box = { min: { x: -lw.beamLength, y: -50, z: -50 }, max: { x: 0, y: 50, z: 50 } };
    }
    items.push(item);
  }

  return { classNames: reg.classNames, clearance: reg.clearance, entities: items, portLayouts: collectPortLayouts(reg.classNames), stationLabels };
}

// ── Build entity data for CBP (SCIM format) ────────────────────────
function buildViewerEntitiesFromCbp(cbpRaw) {
  const reg = createClassRegistry();
  const items = [];

  for (const entry of cbpRaw.data) {
    const p = entry.parent;
    if (!p || !p.className) continue;
    const cls = p.className.split('.').pop();
    if (!cls.startsWith('Build_')) continue;

    registerClass(cls, reg);

    const tr = p.transform;
    const t = { x: tr.translation[0], y: tr.translation[1], z: tr.translation[2] };
    const r = { x: tr.rotation[0], y: tr.rotation[1], z: tr.rotation[2], w: tr.rotation[3] };
    const item = makeItem(p.className, t, r, reg.index);

    if (p.properties && Array.isArray(p.properties)) {
      const splineSegs = extractCbpSplineSegments(p.properties, { translation: t, rotation: r });
      if (splineSegs) item.sp = segmentsToPoints(splineSegs);
    }

    items.push(item);
  }

  return { classNames: reg.classNames, clearance: reg.clearance, entities: items };
}

// ── Build a single entity item (for incremental addition) ──────────
function buildViewerEntityFromEditor(entity, existingEntityData, compByName) {
  const reg = createClassRegistry(existingEntityData);
  const cls = entity.typePath.split('.').pop();
  const isNew = reg.index[cls] === undefined;
  registerClass(cls, reg);

  const item = buildViewerEntity(entity, reg, compByName);

  const classUpdate = {};
  if (isNew) {
    classUpdate.classNames = reg.classNames;
    classUpdate.clearance = reg.clearance;
    classUpdate.portLayouts = collectPortLayouts(reg.classNames);
  }

  return { item, classUpdate, isNewClass: isNew };
}

/**
 * Return connected port pathName(s), or 0 if not connected.
 * Handles mConnectedComponent (belt/pipe) and mConnectedComponents (track).
 * Returns: 0 | "pathName" | "pathName1,pathName2" (for switches)
 */
function getPortConnRef(comp) {
  if (!comp) return 0;
  const single = comp.properties?.mConnectedComponent?.value?.pathName;
  if (single) return single;
  const arr = comp.properties?.mConnectedComponents?.values;
  if (arr && arr.length > 0) return arr.map(v => v.pathName).join(',');
  return 0;
}

function isPortConnected(comp) {
  return !!getPortConnRef(comp);
}

module.exports = { classify, buildViewerEntitiesFromSave, buildViewerEntitiesFromCbp, buildViewerEntityFromEditor, isPortConnected };