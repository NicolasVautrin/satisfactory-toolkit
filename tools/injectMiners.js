/**
 * Injects Miner Mk3 entities into a Satisfactory save file
 * for all unmined resource nodes in Grass Fields.
 *
 * Usage: node bin/injectMiners.js [input.sav] [output.sav]
 *   defaults: bin/FICSIT_MAX_backup.sav -> bin/FICSIT_MAX_modded.sav
 */
const fs = require('fs');
const { Parser, SaveEntity, SaveComponent } = require('@etothepii/satisfactory-file-parser');
const { readFileAsArrayBuffer, ref: makeRef, nextId } = require('../satisfactoryLib');

// --- Config ---
const ZONES = [
  { cx: -50000, cy: 240000, radius: 80000, name: 'Grass Fields' },
];
// Extra nodes to mine (by pathName) - closest to player position
const EXTRA_NODES = [
  'Persistent_Level:PersistentLevel.BP_ResourceNode11', // Limestone Pure near player
];
const MINER_TYPE_PATH = '/Game/FactoryGame/Buildable/Factory/MinerMk3/Build_MinerMk3.Build_MinerMk3_C';
const MINER_RECIPE = '/Game/FactoryGame/Recipes/Buildings/Recipe_MinerMk3.Recipe_MinerMk3_C';
const OVERCLOCK = 1.0; // 1.0 = 100%, 2.5 = 250%

const INPUT_SAV = process.argv[2] || './bin/FICSIT_MAX_backup.sav';
const OUTPUT_SAV = process.argv[3] || './bin/FICSIT_MAX_modded.sav';

// --- Load map data ---
const data = require('../data/mapObjects.json');
const resTab = data.options.find(t => t.tabId === 'resource_nodes');

// --- Collect unmined nodes in zones + extra nodes ---
function collectNodes(save) {
  const persistentLevel = save.levels['Persistent_Level'];

  // Find already-mined resource node pathNames
  const minedNodes = new Set();
  for (const obj of persistentLevel.objects) {
    if (obj.typePath?.includes('Miner') && obj.type === 'SaveEntity') {
      const res = obj.properties?.mExtractableResource;
      if (res?.value?.pathName) {
        minedNodes.add(res.value.pathName);
      }
    }
  }

  const nodes = [];
  const addedPaths = new Set();

  // Nodes in zones
  for (const zone of ZONES) {
    for (const res of resTab.options) {
      for (const layer of res.options) {
        for (const m of layer.markers) {
          const dx = m.x - zone.cx, dy = m.y - zone.cy;
          if (Math.sqrt(dx * dx + dy * dy) <= zone.radius) {
            if (!minedNodes.has(m.pathName) && !addedPaths.has(m.pathName)) {
              nodes.push({
                x: m.x, y: m.y, z: m.z,
                type: res.type, name: res.name,
                purity: m.purity,
                pathName: m.pathName,
                zone: zone.name,
              });
              addedPaths.add(m.pathName);
            }
          }
        }
      }
    }
  }

  // Extra nodes by pathName
  for (const extraPath of EXTRA_NODES) {
    if (minedNodes.has(extraPath) || addedPaths.has(extraPath)) continue;
    for (const res of resTab.options) {
      for (const layer of res.options) {
        for (const m of layer.markers) {
          if (m.pathName === extraPath) {
            nodes.push({
              x: m.x, y: m.y, z: m.z,
              type: res.type, name: res.name,
              purity: m.purity,
              pathName: m.pathName,
              zone: 'Extra (near player)',
            });
            addedPaths.add(m.pathName);
          }
        }
      }
    }
  }

  return nodes;
}

// --- Clone structure from an existing Miner Mk3 ---
function findReferenceMiner(save) {
  const persistentLevel = save.levels['Persistent_Level'];
  for (const obj of persistentLevel.objects) {
    if (obj.typePath === MINER_TYPE_PATH && obj.type === 'SaveEntity') {
      return obj;
    }
  }
  return null;
}

// --- Create a Miner Mk3 + components for a resource node ---
function createMiner(node, refMiner) {
  const id = nextId();
  const baseName = `Build_MinerMk3_C_${id}`;
  const instanceName = `Persistent_Level:PersistentLevel.${baseName}`;

  // --- Main entity ---
  const entity = new SaveEntity(
    MINER_TYPE_PATH,
    'Persistent_Level',
    instanceName,
    '' // parentEntityName
  );
  entity.needTransform = true;
  entity.wasPlacedInLevel = false;
  entity.flags = refMiner.flags;
  entity.saveCustomVersion = refMiner.saveCustomVersion;
  entity.shouldMigrateObjectRefsToPersistent = false;
  entity.transform = {
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    translation: { x: node.x, y: node.y, z: node.z },
    scale3d: { x: 1, y: 1, z: 1 },
  };
  entity.parentObject = makeRef('Persistent_Level:PersistentLevel.BuildableSubsystem');

  // Component references
  const compNames = ['FGFactoryLegs', 'InventoryPotential', 'powerInfo', 'OutputInventory', 'Output0', 'PowerInput'];
  entity.components = compNames.map(name => makeRef(`${instanceName}.${name}`));

  // Properties
  entity.properties = {
    mExtractableResource: {
      type: 'ObjectProperty', ueType: 'ObjectProperty',
      name: 'mExtractableResource',
      value: makeRef(node.pathName),
    },
    mOutputInventory: {
      type: 'ObjectProperty', ueType: 'ObjectProperty',
      name: 'mOutputInventory',
      value: makeRef(`${instanceName}.OutputInventory`),
    },
    mPowerInfo: {
      type: 'ObjectProperty', ueType: 'ObjectProperty',
      name: 'mPowerInfo',
      value: makeRef(`${instanceName}.powerInfo`),
    },
    mInventoryPotential: {
      type: 'ObjectProperty', ueType: 'ObjectProperty',
      name: 'mInventoryPotential',
      value: makeRef(`${instanceName}.InventoryPotential`),
    },
    mCurrentPotential: {
      type: 'FloatProperty', ueType: 'FloatProperty',
      name: 'mCurrentPotential', value: OVERCLOCK,
    },
    mPendingPotential: {
      type: 'FloatProperty', ueType: 'FloatProperty',
      name: 'mPendingPotential', value: OVERCLOCK,
    },
    mProductivityMonitorEnabled: {
      type: 'BoolProperty', ueType: 'BoolProperty',
      name: 'mProductivityMonitorEnabled', value: true,
    },
    mBuiltWithRecipe: {
      type: 'ObjectProperty', ueType: 'ObjectProperty',
      name: 'mBuiltWithRecipe',
      value: makeRef(MINER_RECIPE, ''),
    },
    mCustomizationData: refMiner.properties.mCustomizationData, // copy swatch
  };

  // --- Components ---
  const components = [];

  // FGFactoryLegs - empty legs (game will recalculate)
  const legs = new SaveComponent(
    '/Script/FactoryGame.FGFactoryLegsComponent',
    'Persistent_Level',
    `${instanceName}.FGFactoryLegs`,
    baseName
  );
  legs.parentEntityName = instanceName;
  legs.saveCustomVersion = refMiner.saveCustomVersion;
  legs.properties = {};
  components.push(legs);

  // InventoryPotential (overclock shards inventory)
  const invPot = new SaveComponent(
    '/Script/FactoryGame.FGInventoryComponent',
    'Persistent_Level',
    `${instanceName}.InventoryPotential`,
    baseName
  );
  invPot.parentEntityName = instanceName;
  invPot.saveCustomVersion = refMiner.saveCustomVersion;
  invPot.properties = {
    mArbitrarySlotSizes: {
      type: 'Int32ArrayProperty', ueType: 'ArrayProperty',
      name: 'mArbitrarySlotSizes', subtype: 'IntProperty',
      values: [1, 1, 1],
    },
  };
  components.push(invPot);

  // powerInfo
  const power = new SaveComponent(
    '/Script/FactoryGame.FGPowerInfoComponent',
    'Persistent_Level',
    `${instanceName}.powerInfo`,
    baseName
  );
  power.parentEntityName = instanceName;
  power.saveCustomVersion = refMiner.saveCustomVersion;
  power.properties = {
    mTargetConsumption: {
      type: 'FloatProperty', ueType: 'FloatProperty',
      name: 'mTargetConsumption', value: 0.1,
    },
  };
  components.push(power);

  // OutputInventory
  const outInv = new SaveComponent(
    '/Script/FactoryGame.FGInventoryComponent',
    'Persistent_Level',
    `${instanceName}.OutputInventory`,
    baseName
  );
  outInv.parentEntityName = instanceName;
  outInv.saveCustomVersion = refMiner.saveCustomVersion;
  outInv.properties = {};
  components.push(outInv);

  // Output0 (conveyor connection)
  const output0 = new SaveComponent(
    '/Script/FactoryGame.FGFactoryConnectionComponent',
    'Persistent_Level',
    `${instanceName}.Output0`,
    baseName
  );
  output0.parentEntityName = instanceName;
  output0.saveCustomVersion = refMiner.saveCustomVersion;
  output0.properties = {};
  components.push(output0);

  // PowerInput (power connection)
  const powerInput = new SaveComponent(
    '/Script/FactoryGame.FGPowerConnectionComponent',
    'Persistent_Level',
    `${instanceName}.PowerInput`,
    baseName
  );
  powerInput.parentEntityName = instanceName;
  powerInput.saveCustomVersion = refMiner.saveCustomVersion;
  powerInput.properties = {};
  components.push(powerInput);

  return { entity, components };
}

// =====================
// MAIN
// =====================
console.log(`Parsing ${INPUT_SAV}...`);
const t0 = Date.now();
const save = Parser.ParseSave('FICSIT_MAX', readFileAsArrayBuffer(INPUT_SAV));
console.log(`Parsed in ${Date.now() - t0}ms`);

const refMiner = findReferenceMiner(save);
if (!refMiner) {
  console.error('No reference Miner Mk3 found in save!');
  process.exit(1);
}
console.log('Reference miner:', refMiner.instanceName);

const nodes = collectNodes(save);
console.log(`\n${nodes.length} unmined nodes to inject:`);
const byZone = {};
nodes.forEach(n => {
  const key = n.zone;
  if (!byZone[key]) byZone[key] = {};
  if (!byZone[key][n.name]) byZone[key][n.name] = 0;
  byZone[key][n.name]++;
});
for (const [zone, types] of Object.entries(byZone)) {
  console.log(`  [${zone}]`);
  for (const [name, count] of Object.entries(types)) {
    console.log(`    ${name}: ${count}`);
  }
}

// Create miners
const persistentLevel = save.levels['Persistent_Level'];
let added = 0;
for (const node of nodes) {
  const { entity, components } = createMiner(node, refMiner);
  persistentLevel.objects.push(entity);
  for (const comp of components) {
    persistentLevel.objects.push(comp);
  }
  added++;
}
console.log(`\nInjected ${added} Miner Mk3 (+ ${added * 6} components)`);

// Write modified save
console.log(`\nWriting ${OUTPUT_SAV}...`);
const t1 = Date.now();
let headerBuf;
const bodyChunks = [];
const writeResult = Parser.WriteSave(save,
  h => { headerBuf = h; },
  c => { bodyChunks.push(c); }
);
const outputBuf = Buffer.concat([headerBuf, ...bodyChunks]);
fs.writeFileSync(OUTPUT_SAV, outputBuf);
console.log(`Written in ${Date.now() - t1}ms (${(outputBuf.length / 1024 / 1024).toFixed(1)} MB)`);

console.log('\n=== Done ===');
console.log(`Copy ${OUTPUT_SAV} to your save folder and load it in Satisfactory.`);
console.log(`Save folder: %LOCALAPPDATA%\\FactoryGame\\Saved\\SaveGames\\76561198036887614\\`);