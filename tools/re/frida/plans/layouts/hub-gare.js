// Gares du hub : gare + 4 quais, sans rails ; les voies sont dans hub.js.
// Repere de railplan : origine = sortie de la gare, u vers ses quais, v vers l'exterieur (entrees / sorties de
// convoyeur de ce cote). Origines et caps : require('./hub.js').layout({ etage }).stations
//   node railplan.js layouts/hub-gare.js build --origin <x,y,z> --axis 180 --nom hub<f>-est<k>
//   node railplan.js layouts/hub-gare.js build --origin <x,y,z> --axis 0   --nom hub<f>-ouest<k>
'use strict';
const QUAI = 16;
module.exports = () => ({
  station: { at: [QUAI / 2, 0, 0], cap: 0 },
  platforms: { count: 4, firstAt: QUAI, length: QUAI, reversed: false, inAir: true },
  platformsRail: { id: 'quais', from: 'PL', fromCap: 180, to: 'ST', toCap: 180 },
  joints: { ST: [0, 0, 0], PL: [QUAI * 5, 0, 0] },
  rails: [],
  signals: [],
});
