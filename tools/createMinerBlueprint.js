const fs = require('fs');
const { Parser, SaveEntity } = require('@etothepii/satisfactory-file-parser');

// --- Config ---
const ZONE = { cx: -50000, cy: 240000, radius: 80000, name: 'Grass Fields' };
const MINER_TYPE_PATH = '/Game/FactoryGame/Buildable/Factory/MinerMk3/Build_MinerMk3.Build_MinerMk3_C';
const BLUEPRINT_NAME = 'GrassFields_Miners';

// --- Load map data ---
const data = require('../data/mapObjects.json');
const resTab = data.options.find(t => t.tabId === 'resource_nodes');

// --- Collect nodes in zone ---
const nodes = [];
for (const res of resTab.options) {
  for (const layer of res.options) {
    for (const m of layer.markers) {
      const dx = m.x - ZONE.cx, dy = m.y - ZONE.cy;
      if (Math.sqrt(dx * dx + dy * dy) <= ZONE.radius) {
        nodes.push({
          x: m.x, y: m.y, z: m.z,
          type: res.type, name: res.name,
          purity: m.purity,
          pathName: m.pathName
        });
      }
    }
  }
}

console.log(`Found ${nodes.length} resource nodes in ${ZONE.name}`);

// --- Compute blueprint origin (center of all nodes) ---
const origin = {
  x: nodes.reduce((s, n) => s + n.x, 0) / nodes.length,
  y: nodes.reduce((s, n) => s + n.y, 0) / nodes.length,
  z: nodes.reduce((s, n) => s + n.z, 0) / nodes.length,
};
console.log(`Blueprint origin (place blueprint here): x=${origin.x.toFixed(1)}, y=${origin.y.toFixed(1)}, z=${origin.z.toFixed(1)}`);

// --- Create SaveEntity for each miner ---
const entities = nodes.map((node, i) => {
  const entity = new SaveEntity(
    MINER_TYPE_PATH,
    'Persistent_Level',
    `Persistent_Level:PersistentLevel.Build_MinerMk3_C_${i}`,
    'Persistent_Level'
  );
  entity.needTransform = true;
  entity.wasPlacedInLevel = false;
  entity.transform = {
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    translation: {
      x: node.x - origin.x,
      y: node.y - origin.y,
      z: node.z - origin.z,
    },
    scale3d: { x: 1, y: 1, z: 1 },
  };
  return entity;
});

console.log(`Created ${entities.length} miner entities`);

// --- Assemble blueprint ---
const blueprint = {
  name: BLUEPRINT_NAME,
  compressionInfo: {
    chunkHeaderVersion: 572662306,
    packageFileTag: 1734,
    maxUncompressedChunkContentSize: 131072,
    compressionAlgorithm: 3,
  },
  header: {
    headerVersion: 2,
    saveVersion: 13,
    buildVersion: 271854,
    designerDimension: { x: 0, y: 0, z: 0 },
    itemCosts: [],
    recipeReferences: [],
  },
  config: {
    configVersion: 4,
    description: `${ZONE.name} - ${nodes.length} Miner Mk3 on all resource nodes`,
    color: { r: 50, g: 200, b: 50, a: 255 },
    iconID: 0,
    lastEditedBy: [],
  },
  objects: entities,
};

// --- Write .sbp and .sbpcfg ---
let mainFileHeader;
const chunks = [];
Parser.WriteBlueprintFiles(
  blueprint,
  h => { mainFileHeader = h; },
  c => { chunks.push(c); },
);

const sbpPath = `./bin/${BLUEPRINT_NAME}.sbp`;
const sbpcfgPath = `./bin/${BLUEPRINT_NAME}.sbpcfg`;
fs.writeFileSync(sbpPath, Buffer.concat([mainFileHeader, ...chunks]));

// WriteBlueprintFiles returns { mainFileChunkSummary, configFileBinary }
// We need to call it again to get configFileBinary - actually it's returned
let mainFileHeader2;
const chunks2 = [];
const result = Parser.WriteBlueprintFiles(
  blueprint,
  h => { mainFileHeader2 = h; },
  c => { chunks2.push(c); },
);
fs.writeFileSync(sbpcfgPath, Buffer.from(result.configFileBinary));

console.log(`\nWritten:`);
console.log(`  ${sbpPath}`);
console.log(`  ${sbpcfgPath}`);

// --- Verify by re-parsing ---
const { readFileAsArrayBuffer } = require('../satisfactoryLib');

const bp2 = Parser.ParseBlueprintFiles(
  BLUEPRINT_NAME,
  readFileAsArrayBuffer(sbpPath),
  readFileAsArrayBuffer(sbpcfgPath),
);
console.log(`\nVerification: re-parsed ${bp2.objects.length} objects OK`);

// --- Summary ---
console.log(`\n=== Summary ===`);
console.log(`Blueprint: ${BLUEPRINT_NAME}`);
console.log(`Zone: ${ZONE.name} (center: ${ZONE.cx}, ${ZONE.cy}, radius: ${ZONE.radius})`);
console.log(`Miners: ${nodes.length} x Miner Mk3`);
console.log(`\nTo install in Satisfactory:`);
console.log(`  Copy ${BLUEPRINT_NAME}.sbp and ${BLUEPRINT_NAME}.sbpcfg to:`);
console.log(`  %LOCALAPPDATA%\\FactoryGame\\Saved\\SaveGames\\blueprints\\<your-session>\\`);
console.log(`\nBlueprint origin (world coords): x=${origin.x.toFixed(1)}, y=${origin.y.toFixed(1)}, z=${origin.z.toFixed(1)}`);

// Node details
console.log(`\nNodes included:`);
const byType = {};
nodes.forEach(n => {
  if (!byType[n.name]) byType[n.name] = [];
  byType[n.name].push(n.purity);
});
for (const [name, purities] of Object.entries(byType)) {
  const counts = {};
  purities.forEach(p => { counts[p] = (counts[p] || 0) + 1; });
  const details = Object.entries(counts).map(([p, c]) => `${c} ${p}`).join(', ');
  console.log(`  ${name}: ${purities.length} (${details})`);
}