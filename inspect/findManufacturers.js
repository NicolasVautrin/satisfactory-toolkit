const fs = require('fs');
const path = require('path');
const { Parser } = require('@etothepii/satisfactory-file-parser');
const { readFileAsArrayBuffer } = require('../satisfactoryLib');

const savePath = path.join(process.env.LOCALAPPDATA, 'FactoryGame', 'Saved', 'SaveGames', '76561198036887614', 'TEST.sav');
console.log('Reading:', savePath);
const ab = readFileAsArrayBuffer(savePath);
const save = Parser.ParseSave('TEST', ab);

const objects = save.levels.flatMap(l => l.saveObjects);

// Find player pawn
const player = objects.find(o => o.typePath && o.typePath.includes('Char_Player'));
if (player) {
  console.log('Player pos:', JSON.stringify(player.transform?.translation));
}

// Find all manufacturer-like buildings
const manufacturers = objects.filter(o => o.typePath && o.typePath.toLowerCase().includes('manufacturer'));
console.log('\nManufacturer entities:', manufacturers.length);
manufacturers.forEach((m, i) => {
  const pos = m.transform?.translation;
  console.log(`  [${i}] ${m.typePath}`);
  console.log(`       pos: ${JSON.stringify(pos)}`);
  console.log(`       instance: ${m.instanceName}`);
});