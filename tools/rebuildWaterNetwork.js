/**
 * Rebuilds the water extraction network for the nuclear complex.
 * 1. Finds existing nuclear plants and pipe holes, matches them 1:1
 * 2. Deletes all old water-related entities (pumps, pipes, junctions, power lines)
 * 3. Creates 16 clusters of 5 water extractors (one per nuclear plant)
 * 4. Builds collector pipes with pipeline pumps
 * 5. Connects each cluster to its nuclear plant via existing pipe hole
 * 6. Power lines for everything
 *
 * Usage: node bin/rebuildWaterNetwork.js [input.sav] [output.sav]
 */
const fs = require('fs');
const { Parser } = require('@etothepii/satisfactory-file-parser');
const {
  readFileAsArrayBuffer, FlowPort,
  WaterExtractor, Pipe, PipeJunction,
  PipePump, PowerLine, PipeHole, NukePlant,
  wirePowerLine,
} = require('../satisfactoryLib');

const INPUT_SAV = process.argv[2] || './bin/FICSIT_MAX_backup.sav';
const OUTPUT_SAV = process.argv[3] || './bin/FICSIT_MAX_water.sav';

// --- Layout constants ---
const WATER_Z = -1800;             // Water surface level
const COLLECTOR_Y_OFFSET = -2000;  // Collector offset in Y from extractors
const PUMP_Z = -1650;              // Pipeline pump Z
const WP_PER_CLUSTER = 5;
const WP_SPACING = 960;

// Bounding box for deletion (nuclear water area)
const DEL_BOX = {
  xMin: -252000, xMax: -215000,
  yMin: -256000, yMax: -190000,
  zMin: -2500, zMax: -350,
};

// ============================
// MAIN
// ============================

console.log(`Parsing ${INPUT_SAV}...`);
const t0 = Date.now();
const save = Parser.ParseSave('FICSIT_MAX', readFileAsArrayBuffer(INPUT_SAV));
console.log(`Parsed in ${Date.now() - t0}ms`);

const pl = save.levels['Persistent_Level'];
const initialCount = pl.objects.length;

// ============================
// STEP 1: FIND NUCLEAR PLANTS AND PIPE HOLES
// ============================
console.log('\n=== Step 1: Finding nuclear plants and pipe holes ===');

// Nuclear plants in the nuclear area (rotation z ≈ 1.0, i.e. 180° around Z)
const nukeEntities = pl.objects.filter(o =>
  o.typePath?.includes('GeneratorNuclear') && o.type === 'SaveEntity' &&
  Math.abs(o.transform?.rotation?.z) > 0.99
);
const nukePlants = nukeEntities.map(e => NukePlant.fromSave(e, pl.objects));
console.log(`Found ${nukePlants.length} nuclear plants`);

// Pipe holes in the nuclear area
const pipeHoleEntities = pl.objects.filter(o =>
  o.typePath?.includes('FoundationPassthrough_Pipe') && o.type === 'SaveEntity' &&
  o.transform?.translation?.x >= DEL_BOX.xMin && o.transform?.translation?.x <= DEL_BOX.xMax &&
  o.transform?.translation?.y >= DEL_BOX.yMin && o.transform?.translation?.y <= DEL_BOX.yMax);

console.log(`Found ${pipeHoleEntities.length} pipe holes`);

// Create PipeHole wrappers
const pipeHoles = pipeHoleEntities.map(e => PipeHole.fromSave(e));

// Match each nuke to its closest pipe hole
const nukeConfigs = [];
const usedHoles = new Set();
for (const nuke of nukePlants) {
  const np = nuke.entity.transform.translation;
  let minDist = Infinity, bestHole = null;
  for (const hole of pipeHoles) {
    if (usedHoles.has(hole)) continue;
    const hp = hole.entity.transform.translation;
    const d = Math.sqrt((np.x - hp.x) ** 2 + (np.y - hp.y) ** 2);
    if (d < minDist) { minDist = d; bestHole = hole; }
  }
  usedHoles.add(bestHole);
  nukeConfigs.push({ nuke, pipeHole: bestHole });
  const hp = bestHole.entity.transform.translation;
  console.log(`  Nuke (${Math.round(np.x)}, ${Math.round(np.y)}) -> PipeHole (${Math.round(hp.x)}, ${Math.round(hp.y)})`);
}

// Sort by Y then X for consistent cluster ordering
nukeConfigs.sort((a, b) => {
  const ay = a.nuke.entity.transform.translation.y, by = b.nuke.entity.transform.translation.y;
  if (Math.abs(ay - by) > 100) return ay - by;
  return a.nuke.entity.transform.translation.x - b.nuke.entity.transform.translation.x;
});

// Collect protected pipes: walk chain from pipe hole top to nuke, protect all
const protectedPipes = new Set();

// Set of nuke FGPipeConnectionFactory names (chain walk stop condition)
const nukePipeConns = new Set(nukePlants.map(n => `${n.inst}.FGPipeConnectionFactory`));

for (const hole of pipeHoles) {
  const topRef = hole.entity.properties?.mTopSnappedConnection?.value?.pathName;
  if (!topRef) continue;
  const firstPipeInst = topRef.split('.').slice(0, -1).join('.');
  protectedPipes.add(firstPipeInst);

  // Walk the pipe chain from pipe hole toward nuke, protecting each pipe
  const holeSideConn = topRef.endsWith('Connection0') ? 'Connection0' : 'Connection1';
  const farSideConn = holeSideConn === 'Connection0' ? 'Connection1' : 'Connection0';

  let currentPipeInst = firstPipeInst;
  let currentFarConn = farSideConn;
  let chainLen = 0;
  while (currentPipeInst && chainLen < 10) {
    chainLen++;
    const farConnName = `${currentPipeInst}.Pipeline${currentFarConn}`;
    const farComp = pl.objects.find(o => o.instanceName === farConnName);
    const nextConnRef = farComp?.properties?.mConnectedComponent?.value?.pathName;
    if (!nextConnRef) break;
    // If we reached the nuke, stop
    if (nukePipeConns.has(nextConnRef)) break;
    // Otherwise it's an intermediate pipe — protect it
    const nextPipeInst = nextConnRef.split('.').slice(0, -1).join('.');
    protectedPipes.add(nextPipeInst);
    // Continue walking from the other end of this pipe
    const nextPipeConn = nextConnRef.endsWith('Connection0') ? 'Connection0' : 'Connection1';
    currentFarConn = nextPipeConn === 'Connection0' ? 'Connection1' : 'Connection0';
    currentPipeInst = nextPipeInst;
    console.log(`    + protected intermediate pipe ${nextPipeInst.split('.').pop()}`);
  }
  console.log(`  Protected pipe chain from ${hole.inst.split('.').pop()} [chain: ${chainLen}]`);
}
console.log(`Protected ${protectedPipes.size} pipes from deletion`);

// ============================
// STEP 2: DELETE OLD WATER NETWORK
// ============================
console.log('\n=== Step 2: Deleting old water network ===');

function inDeleteBox(pos) {
  if (!pos) return false;
  return pos.x >= DEL_BOX.xMin && pos.x <= DEL_BOX.xMax &&
         pos.y >= DEL_BOX.yMin && pos.y <= DEL_BOX.yMax &&
         pos.z >= DEL_BOX.zMin && pos.z <= DEL_BOX.zMax;
}

const toDelete = new Set();

// Note: FoundationPassthrough_Pipe removed — we keep pipe holes
const deleteTypes = [
  'WaterPump', 'Build_Pipeline.', 'PipelineMK2', 'PipelineMK2_NoIndicator',
  'PipelineJunction', 'PipelinePumpMk2', 'PipelineFlowIndicator',
  'PipeSupportStackable', 'PipelineSupport', 'PipelineSupportWall',
  'Valve',
];
const deleteStructuralTypes = [
  'PipelineSupportWall', 'PowerPoleWall',
];

for (const obj of pl.objects) {
  if (obj.type !== 'SaveEntity') continue;
  const tp = obj.typePath || '';
  const pos = obj.transform?.translation;
  if (!inDeleteBox(pos)) continue;

  // Skip protected nuke-side pipes
  if (protectedPipes.has(obj.instanceName)) continue;

  const isWaterInfra = deleteTypes.some(t => tp.includes(t));
  const isStructural = deleteStructuralTypes.some(t => tp.includes(t)) && pos.z < -300;
  if (isWaterInfra || isStructural) {
    toDelete.add(obj.instanceName);
    if (obj.components) {
      obj.components.forEach(c => toDelete.add(c.pathName));
    }
  }
}

// Delete power lines connected to deleted entities
for (const obj of pl.objects) {
  if (!obj.typePath?.includes('PowerLine')) continue;
  const sp = obj.specialProperties;
  if (!sp?.source?.pathName || !sp?.target?.pathName) continue;

  const sourceParent = sp.source.pathName.split('.').slice(0, -1).join('.');
  const targetParent = sp.target.pathName.split('.').slice(0, -1).join('.');

  if (toDelete.has(sourceParent) || toDelete.has(targetParent)) {
    toDelete.add(obj.instanceName);
  }
}

// Remove mWires references to deleted power lines from non-deleted PowerConnections
const deletedPowerLines = new Set();
for (const name of toDelete) {
  if (name.includes('PowerLine')) deletedPowerLines.add(name);
}

for (const obj of pl.objects) {
  if (toDelete.has(obj.instanceName)) continue;
  if (obj.properties?.mWires?.values) {
    obj.properties.mWires.values = obj.properties.mWires.values.filter(
      v => !deletedPowerLines.has(v.pathName)
    );
  }
  if (obj.properties?.mConnectedComponent?.value?.pathName) {
    if (toDelete.has(obj.properties.mConnectedComponent.value.pathName) ||
        toDelete.has(obj.properties.mConnectedComponent.value.pathName.split('.').slice(0, -1).join('.'))) {
      delete obj.properties.mConnectedComponent;
    }
  }
}

// Clean up pipe hole mBottomSnappedConnection references to deleted pipes
for (const entity of pipeHoleEntities) {
  const bottomRef = entity.properties?.mBottomSnappedConnection?.value?.pathName;
  if (bottomRef) {
    const pipeInst = bottomRef.split('.').slice(0, -1).join('.');
    if (toDelete.has(pipeInst) || toDelete.has(bottomRef)) {
      delete entity.properties.mBottomSnappedConnection;
    }
  }
}

pl.objects = pl.objects.filter(obj => !toDelete.has(obj.instanceName));

console.log(`Deleted ${toDelete.size} entities/components (${initialCount} -> ${pl.objects.length})`);

// ============================
// STEP 3: CREATE CLEAN WATER NETWORK (16 clusters)
// ============================
console.log('\n=== Step 3: Creating clean water network ===');

const newEntities = [];
const powerConns = [];

function addEntities(...items) {
  for (const item of items) {
    newEntities.push(item.entity, ...item.components);
  }
}

for (let ci = 0; ci < nukeConfigs.length; ci++) {
  const { nuke, pipeHole } = nukeConfigs[ci];
  const nukePos = nuke.entity.transform.translation;
  const nukeX = Math.round(nukePos.x);
  const nukeY = Math.round(nukePos.y);
  const holePos = pipeHole.entity.transform.translation;

  console.log(`\n--- Cluster ${ci}: Nuke (${nukeX}, ${nukeY}) -> PipeHole (${Math.round(holePos.x)}, ${Math.round(holePos.y)}) ---`);

  // Extractors centered on nukeX, at nukeY, on the water surface
  const startX = nukeX - Math.floor((WP_PER_CLUSTER - 1) / 2) * WP_SPACING;
  const extractorY = nukeY;
  const collectorY = nukeY + COLLECTOR_Y_OFFSET;

  const junctions = [];
  const extractors = [];

  // Create junctions on the collector line
  for (let i = 0; i < WP_PER_CLUSTER; i++) {
    const junc = PipeJunction.create(startX + i * WP_SPACING, collectorY, WATER_Z);
    junctions.push(junc);
    addEntities(junc);
  }

  // Create water extractors + pipe from each output to its junction
  for (let i = 0; i < WP_PER_CLUSTER; i++) {
    const wp = WaterExtractor.create(startX + i * WP_SPACING, extractorY, WATER_Z);
    extractors.push(wp);
    addEntities(wp);
    powerConns.push({ conn: wp.port(WaterExtractor.Ports.POWER), nukeY });

    const wpOutput = wp.port(WaterExtractor.Ports.OUTPUT);
    const pipe = Pipe.create(wpOutput, junctions[i].port(PipeJunction.Ports.CONN2));
    addEntities(pipe);
    wpOutput.attach(pipe.port(Pipe.Ports.CONN0));
    junctions[i].port(PipeJunction.Ports.CONN2).attach(pipe.port(Pipe.Ports.CONN1));
  }

  // Collector pipes between junctions
  for (let i = 0; i < WP_PER_CLUSTER - 1; i++) {
    const pipe = Pipe.create(junctions[i].port(PipeJunction.Ports.CONN0), junctions[i + 1].port(PipeJunction.Ports.CONN1));
    addEntities(pipe);
    junctions[i].port(PipeJunction.Ports.CONN0).attach(pipe.port(Pipe.Ports.CONN0));
    junctions[i + 1].port(PipeJunction.Ports.CONN1).attach(pipe.port(Pipe.Ports.CONN1));
  }

  // Pipeline pump vertical, 800u (8m) above last junction
  const lastJuncX = startX + (WP_PER_CLUSTER - 1) * WP_SPACING;
  const pumpRotUp = { x: 0, y: -0.7071068, z: 0, w: 0.7071068 }; // 90° pitch up
  const pump = PipePump.create(lastJuncX, collectorY, WATER_Z + 800, pumpRotUp);
  addEntities(pump);
  powerConns.push({ conn: pump.port(PipePump.Ports.POWER), nukeY });

  // Pipe: last junction -> pump input
  const lastJunc = junctions[WP_PER_CLUSTER - 1];
  const pipeToPump = Pipe.create(lastJunc.port(PipeJunction.Ports.CONN0), pump.port(PipePump.Ports.INPUT));
  addEntities(pipeToPump);
  lastJunc.port(PipeJunction.Ports.CONN0).attach(pipeToPump.port(Pipe.Ports.CONN0));
  pump.attachPipe(pipeToPump.port(Pipe.Ports.CONN1), 'input');

  // Pipe: pump output -> pipe hole bottom (vertical/diagonal pipe)
  const vertPipe = Pipe.create(pump.port(PipePump.Ports.OUTPUT), pipeHole.port(PipeHole.Ports.BOTTOM));
  addEntities(vertPipe);
  pump.attachPipe(vertPipe.port(Pipe.Ports.CONN0), 'output');
  pipeHole.port(PipeHole.Ports.BOTTOM).attach(vertPipe.port(Pipe.Ports.CONN1));

  // Attach the existing nuke pipe (nuke -> pipe hole, single pipe)
  const nukePipeRef = nuke.port(NukePlant.Ports.PIPE).component.properties.mConnectedComponent?.value?.pathName;
  if (nukePipeRef) {
    const nukePipeInst = nukePipeRef.split('.').slice(0, -1).join('.');
    const nukePipe = Pipe.fromSave(pl.objects.find(o => o.instanceName === nukePipeInst), pl.objects);
    const nukeConnIndex = nukePipeRef.endsWith('Connection0') ? 0 : 1;
    nuke.port(NukePlant.Ports.PIPE).attach(nukeConnIndex === 0 ? nukePipe.port(Pipe.Ports.CONN0) : nukePipe.port(Pipe.Ports.CONN1));
    pipeHole.port(PipeHole.Ports.TOP).attach(nukeConnIndex === 0 ? nukePipe.port(Pipe.Ports.CONN1) : nukePipe.port(Pipe.Ports.CONN0));
  }

  // Save first extractor's power conn for grid connection
  nukeConfigs[ci].firstExtractorPower = extractors[0].port(WaterExtractor.Ports.POWER);

  console.log(`  ${WP_PER_CLUSTER} extractors, ${WP_PER_CLUSTER} junctions, 1 pump, ${WP_PER_CLUSTER + WP_PER_CLUSTER - 1 + 2} pipes`);
}

// ============================
// STEP 4: POWER LINES (daisy chain per nuke row)
// ============================
console.log('\n=== Step 4: Creating power lines ===');

const yGroups = {};
for (const e of powerConns) {
  const yKey = Math.round(e.nukeY);
  if (!yGroups[yKey]) yGroups[yKey] = [];
  yGroups[yKey].push(e.conn);
}

let powerLineCount = 0;
for (const [yKey, conns] of Object.entries(yGroups)) {
  conns.sort((a, b) => a.pos.x - b.pos.x);
  for (let i = 0; i < conns.length - 1; i++) {
    const line = PowerLine.create(conns[i], conns[i + 1]);
    newEntities.push(line.entity);
    wirePowerLine(line, conns[i], conns[i + 1]);
    powerLineCount++;
  }
}
// Connect each cluster to its nuke's power grid
for (const { nuke, firstExtractorPower } of nukeConfigs) {
  const nukePowerConn = nuke.port(NukePlant.Ports.POWER);
  if (!nukePowerConn.component) {
    console.log(`  WARNING: PowerConnection not found for ${nuke.inst}`);
    continue;
  }
  const line = PowerLine.create(nukePowerConn, firstExtractorPower);
  newEntities.push(line.entity);
  wirePowerLine(line, nukePowerConn, firstExtractorPower);
  powerLineCount++;
}
console.log(`Created ${powerLineCount} power lines (including ${nukeConfigs.length} grid connections)`);

// ============================
// STEP 5: ADD ALL NEW ENTITIES
// ============================
for (const obj of newEntities) {
  pl.objects.push(obj);
}

console.log(`\nTotal new entities added: ${newEntities.length}`);
console.log(`Final object count: ${pl.objects.length}`);

// ============================
// STEP 6: WRITE SAVE
// ============================
console.log(`\nWriting ${OUTPUT_SAV}...`);
const t1 = Date.now();
let headerBuf;
const bodyChunks = [];
Parser.WriteSave(save,
  h => { headerBuf = h; },
  c => { bodyChunks.push(c); }
);
const outputBuf = Buffer.concat([headerBuf, ...bodyChunks]);
fs.writeFileSync(OUTPUT_SAV, outputBuf);
console.log(`Written in ${Date.now() - t1}ms (${(outputBuf.length / 1024 / 1024).toFixed(1)} MB)`);

console.log('\n=== Summary ===');
console.log(`Deleted: ${toDelete.size} old entities`);
console.log(`Created: ${nukeConfigs.length} clusters of ${WP_PER_CLUSTER} extractors (${nukeConfigs.length * WP_PER_CLUSTER} total)`);
console.log(`Created: ${nukeConfigs.length} pipeline pumps`);
console.log(`Created: ${powerLineCount} power lines`);
console.log(`Connected to ${pipeHoles.length} pipe holes -> nuclear plants`);
