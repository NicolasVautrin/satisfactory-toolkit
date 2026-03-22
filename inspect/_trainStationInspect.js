const path = require('path');
const { Parser } = require('@etothepii/satisfactory-file-parser');
const fs = require('fs');

const GAME_SAVES = path.join(process.env.LOCALAPPDATA, 'FactoryGame/Saved/SaveGames/76561198036887614');
const buf = fs.readFileSync(`${GAME_SAVES}/TEST.sav`);
const save = Parser.ParseSave('TEST.sav', buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

const allObjects = Object.values(save.levels).flatMap(l => l.objects);

// 1. Find all FGTrainStationIdentifier objects
const stIds = allObjects.filter(o => o.typePath?.includes('TrainStationIdentifier'));
console.log('=== FGTrainStationIdentifier objects ===');
for (const s of stIds) {
  console.log('instanceName:', s.instanceName);
  console.log('typePath:', s.typePath);
  console.log('parentObject:', JSON.stringify(s.parentObject));
  console.log('needTransform:', s.needTransform);
  console.log('properties:', JSON.stringify(s.properties, null, 2));
  console.log('flags:', s.flags);
  console.log('entity:', JSON.stringify(s.entity));
  console.log('---');
}

// 2. Find the FGRailroadSubsystem
const rrSub = allObjects.find(o => o.typePath?.includes('RailroadSubsystem'));
if (rrSub) {
  console.log('\n=== FGRailroadSubsystem ===');
  console.log('instanceName:', rrSub.instanceName);
  console.log('typePath:', rrSub.typePath);
  console.log('properties keys:', Object.keys(rrSub.properties || {}));
  console.log('properties:', JSON.stringify(rrSub.properties, null, 2).substring(0, 5000));
  console.log('components:', JSON.stringify(rrSub.components));
}

// 3. Find the existing train station (Build_TrainStation)
const stations = allObjects.filter(o => o.typePath?.includes('Build_TrainStation'));
console.log('\n=== Existing Train Stations ===');
for (const s of stations) {
  console.log('instanceName:', s.instanceName);
  console.log('properties:', JSON.stringify(s.properties, null, 2).substring(0, 3000));
  console.log('---');
}

// 4. Check if there's a FGTrainStationIdentifier in the railroad subsystem
const rrSubAll = allObjects.filter(o => o.typePath?.includes('Railroad'));
console.log('\n=== All Railroad-related objects ===');
for (const r of rrSubAll) {
  console.log(r.typePath, '-', r.instanceName);
}

// 5. Check BP_Train objects
const trains = allObjects.filter(o => o.typePath?.includes('BP_Train'));
console.log('\n=== BP_Train objects ===');
for (const t of trains) {
  console.log('instanceName:', t.instanceName);
  console.log('properties:', JSON.stringify(t.properties, null, 2).substring(0, 3000));
}

// 6. Check which level the existing station identifier is in
for (const [levelName, level] of Object.entries(save.levels)) {
  const found = level.objects?.find(o => o.typePath?.includes('TrainStationIdentifier'));
  if (found) {
    console.log('\n=== Level containing TrainStationIdentifier ===');
    console.log('Level name:', levelName);
    console.log('Object count:', level.objects.length);
  }
}