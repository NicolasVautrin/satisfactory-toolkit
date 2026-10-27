// Gares du hub : gare + 4 quais, sans rails ; les voies sont dans hub.js.
// Repere de railplan : origine = sortie de la gare, u vers ses quais, v vers l'exterieur (entrees / sorties de
// convoyeur de ce cote). Origines et caps : require('./hub.js').layout({ etage }).stations
//   node railplan.js layouts/hub-gare.js build --origin <x,y,z> --axis 180 --nom hub<f>-est<k>
//   node railplan.js layouts/hub-gare.js build --origin <x,y,z> --axis 0   --nom hub<f>-ouest<k>
// --types fluide,fluide,fret,vide : type de chaque quai depuis la gare (defaut : 4 quais de fret) ; --chargement oui|non :
// mode des quais (defaut : celui du jeu, chargement) ; --visee <m> : hauteur de depart du rayon qui accroche les quais
// (sous l'etage du dessus quand il existe deja : 20 m dans le hub, etages a 25 m ; le toit des quais est a 15-19 m, un
// rayon parti de 8 ou 12 m demarre sous le toit et le quai ne s'accroche pas, mesure le 26/10/2026)
'use strict';
const QUAI = 16;
const RECETTE = { fret: 'Recipe_TrainDockingStation_C', fluide: 'Recipe_TrainDockingStationLiquid_C', vide: 'Recipe_TrainPlatformEmpty_C' };
module.exports = (o = {}) => {
  const types = o.types ? String(o.types).split(',') : null;
  if (types && (types.length !== 4 || types.some((t) => !RECETTE[t]))) throw new Error('--types : 4 quais parmi ' + Object.keys(RECETTE).join(', '));
  return {
    station: { at: [QUAI / 2, 0, 0], cap: 0 },
    platforms: {
      count: 4, firstAt: QUAI, length: QUAI, reversed: false, inAir: true,
      recipes: types ? types.map((t) => RECETTE[t]) : undefined,
      load: o.chargement === 'oui' ? true : o.chargement === 'non' ? false : undefined,
      aimAbove: o.visee ? Number(o.visee) * 100 : undefined,
    },
    platformsRail: { id: 'quais', from: 'PL', fromCap: 180, to: 'ST', toCap: 180 },
    joints: { ST: [0, 0, 0], PL: [QUAI * 5, 0, 0] },
    rails: [],
    signals: [],
  };
};
