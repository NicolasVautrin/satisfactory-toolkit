const path = require('path');
const { Parser } = require('@etothepii/satisfactory-file-parser');
const fs = require('fs');

const GAME_SAVES = path.join(process.env.LOCALAPPDATA, 'FactoryGame/Saved/SaveGames/76561198036887614');
const buf = fs.readFileSync(`${GAME_SAVES}/TEST.sav`);
const save = Parser.ParseSave('TEST.sav', buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

const allObjects = Object.values(save.levels).flatMap(l => l.objects);

// Pick the first existing station: Milano
const stationName = 'Build_TrainStation_C_2146574245';
const station = allObjects.find(o => o.instanceName?.includes(stationName));
const idName = 'FGTrainStationIdentifier_2146574243';
const identifier = allObjects.find(o => o.instanceName?.includes(idName));

console.log('=== Station object (Milano) - ALL keys ===');
console.log('Keys:', Object.keys(station));
for (const key of Object.keys(station)) {
  if (key === 'properties') continue; // already seen
  const val = station[key];
  if (typeof val === 'object' && val !== null) {
    console.log(`${key}:`, JSON.stringify(val));
  } else {
    console.log(`${key}:`, val);
  }
}

console.log('\n=== Station transform ===');
console.log('transform:', JSON.stringify(station.transform, null, 2));

console.log('\n=== Station components ===');
console.log('components:', JSON.stringify(station.components, null, 2));

console.log('\n=== Identifier object (Milano) - ALL keys ===');
console.log('Keys:', Object.keys(identifier));
for (const key of Object.keys(identifier)) {
  if (key === 'properties') continue;
  const val = identifier[key];
  if (typeof val === 'object' && val !== null) {
    console.log(`${key}:`, JSON.stringify(val));
  } else {
    console.log(`${key}:`, val);
  }
}

console.log('\n=== Identifier transform ===');
console.log('transform:', JSON.stringify(identifier.transform, null, 2));

console.log('\n=== Identifier components ===');
console.log('components:', JSON.stringify(identifier.components, null, 2));

// Check what the integrated track looks like
const trackName = 'Build_RailroadTrackIntegrated_C_2146574240';
const track = allObjects.find(o => o.instanceName?.includes(trackName));
if (track) {
  console.log('\n=== Integrated Track - ALL keys ===');
  console.log('Keys:', Object.keys(track));
  for (const key of Object.keys(track)) {
    if (key === 'properties') continue;
    const val = track[key];
    if (typeof val === 'object' && val !== null) {
      console.log(`${key}:`, JSON.stringify(val));
    } else {
      console.log(`${key}:`, val);
    }
  }
  console.log('\nTrack properties:', JSON.stringify(track.properties, null, 2));
  console.log('\nTrack entity:', JSON.stringify(track.entity, null, 2));
}

// Check the railroad track entity - splines
const anyTrack = allObjects.find(o => o.typePath?.includes('Build_RailroadTrack.Build_RailroadTrack_C'));
if (anyTrack) {
  console.log('\n=== Regular Track entity (first one) ===');
  console.log('entity:', JSON.stringify(anyTrack.entity, null, 2)?.substring(0, 3000));
}

// Check station entity
console.log('\n=== Station entity ===');
console.log('entity:', JSON.stringify(station.entity, null, 2));

// Check if station has powerInfo component object
const powerInfo = allObjects.find(o => o.instanceName?.includes('Build_TrainStation_C_2146574245.powerInfo'));
if (powerInfo) {
  console.log('\n=== PowerInfo component ===');
  console.log('Keys:', Object.keys(powerInfo));
  console.log('typePath:', powerInfo.typePath);
  for (const key of Object.keys(powerInfo)) {
    if (key === 'properties') {
      console.log('properties:', JSON.stringify(powerInfo.properties, null, 2));
    } else {
      const val = powerInfo[key];
      if (typeof val === 'object' && val !== null) {
        console.log(`${key}:`, JSON.stringify(val));
      } else {
        console.log(`${key}:`, val);
      }
    }
  }
}