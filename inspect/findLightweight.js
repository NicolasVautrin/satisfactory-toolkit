const path = require('path');
const { Parser } = require('@etothepii/satisfactory-file-parser');
const { readFileAsArrayBuffer } = require('../satisfactoryLib');

const SAVE_PATH = path.join(process.env.LOCALAPPDATA, 'FactoryGame/Saved/SaveGames/76561198036887614/TEST.sav');

const buf = readFileAsArrayBuffer(SAVE_PATH);
const save = Parser.ParseSave('TEST.sav', buf);

// 1. Find FGLightweightBuildableSubsystem in regular objects
let allObjects = [];
for (const [, lvl] of Object.entries(save.levels)) {
  if (lvl.objects) allObjects.push(...lvl.objects);
}

const lwSub = allObjects.find(o => o.typePath && o.typePath.includes('LightweightBuildable'));
if (lwSub) {
  console.log('=== FGLightweightBuildableSubsystem ===');
  console.log('typePath:', lwSub.typePath);
  console.log('instanceName:', lwSub.instanceName);
  console.log('Properties keys:', Object.keys(lwSub.properties || {}));
  // Dump structure
  const props = lwSub.properties || {};
  for (const [k, v] of Object.entries(props)) {
    console.log(`\n--- Property: ${k} ---`);
    console.log('type:', v?.type);
    if (Array.isArray(v?.values)) {
      console.log('values count:', v.values.length);
      if (v.values[0]) console.log('sample[0]:', JSON.stringify(v.values[0]).slice(0, 500));
      if (v.values[1]) console.log('sample[1]:', JSON.stringify(v.values[1]).slice(0, 500));
    } else if (v?.value && typeof v.value === 'object') {
      console.log('value keys:', Object.keys(v.value));
      console.log('value:', JSON.stringify(v.value).slice(0, 1000));
    } else {
      console.log('value:', JSON.stringify(v).slice(0, 500));
    }
  }
  // Check for any sub-arrays deeper
  console.log('\n\n=== Deep inspection of lwSub ===');
  function inspect(obj, path, depth) {
    if (depth > 5 || !obj) return;
    if (Array.isArray(obj)) {
      if (obj.length > 0) {
        console.log(`${path}: Array[${obj.length}]`);
        if (depth < 4) inspect(obj[0], `${path}[0]`, depth + 1);
      }
    } else if (typeof obj === 'object') {
      for (const [k, v] of Object.entries(obj)) {
        if (k === 'properties' || k === 'value' || k === 'values' || k === 'buildData' || k === 'instances' || k === 'items') {
          inspect(v, `${path}.${k}`, depth + 1);
        } else if (Array.isArray(v) && v.length > 10) {
          console.log(`${path}.${k}: Array[${v.length}]`);
          if (v[0]) console.log(`  sample: ${JSON.stringify(v[0]).slice(0, 300)}`);
        }
      }
    }
  }
  inspect(lwSub, 'lwSub', 0);
}

// 2. Check save-level properties for lightweight data
console.log('\n\n=== Save top-level keys ===');
for (const [k, v] of Object.entries(save)) {
  if (k === 'levels') continue;
  if (Array.isArray(v)) console.log(`save.${k}: Array[${v.length}]`);
  else if (v && typeof v === 'object') console.log(`save.${k}: {${Object.keys(v).slice(0, 5).join(',')}...}`);
  else console.log(`save.${k}: ${v}`);
}

// 3. Check each level for non-objects properties
console.log('\n=== Level structure ===');
for (const [levelId, lvl] of Object.entries(save.levels)) {
  const keys = Object.keys(lvl);
  const extras = keys.filter(k => k !== 'objects' && k !== 'collectables');
  if (extras.length > 0 || true) {
    const objCount = lvl.objects?.length || 0;
    console.log(`Level ${levelId}: ${objCount} objects, keys: [${keys.join(', ')}]`);
    for (const ek of extras) {
      const val = lvl[ek];
      if (Array.isArray(val)) console.log(`  ${ek}: Array[${val.length}]`);
      else if (val && typeof val === 'object') {
        const subKeys = Object.keys(val);
        console.log(`  ${ek}: {${subKeys.slice(0, 10).join(',')}} (${subKeys.length} keys)`);
        // Check if it contains buildable data
        for (const sk of subKeys.slice(0, 3)) {
          const sv = val[sk];
          if (Array.isArray(sv)) console.log(`    ${sk}: Array[${sv.length}]`);
          else if (sv && typeof sv === 'object') console.log(`    ${sk}: {${Object.keys(sv).slice(0, 5).join(',')}} `);
          else console.log(`    ${sk}: ${sv}`);
        }
      }
      else console.log(`  ${ek}: ${val}`);
    }
  }
}