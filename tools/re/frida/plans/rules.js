// Regles du jeu utilisees par les plans de construction. Deux sortes de regles :
//  - LUES dans le jeu en cours (recettes, cadences, debits, encombrement) : rien d'extrait, rien a redecouvrir,
//    mises en cache par knowledge.js tant que la version du jeu ne change pas ;
//  - CONSTATEES en jeu (build 1.2.4.1, CL 513885) : chacune indique comment elle a ete etablie.
'use strict';

const { call } = require('./client');
const K = require('./knowledge');

// --- Constatees en jeu (17/10/2026) ------------------------------------------------------------

// Hauteur des ascenseurs par paliers de 1 m : un ecart de 8,5 m a donne des ascenseurs de 9 m et 8 m dont
// l'extremite ne se raccordait pas (le jeu construit quand meme). Les connecteurs relies par ascenseur doivent
// donc etre separes d'un multiple de LIFT_STEP.
const LIFT_STEP = 100;
// Une machine n'a qu'un emplacement de cable (PowerInput maxWires = 1 lu sur foreuse et constructeurs) :
// impossible de chainer machine -> machine, il faut un poteau.
const MACHINE_WIRES = 1;
// Longueur max d'un cable (FGCDWireTooLong au-dela).
const WIRE_MAX_LENGTH = 10000;
// Un element pose en l'air (diviseur, fusionneur, poteau) recoit FGCDInvalidFloor ; les tours du joueur
// sont construites ainsi, ce motif est donc accepte pour elles.
const IN_AIR = ['FGCDInvalidFloor'];
// Multiplicateur de purete des gisements (impur / normal / pur), regle du jeu : une foreuse Mk3 a 250 % sur le
// gisement impur 557 a bien produit 300 / min = 240 x 0,5 x 2,5.
const PURITY = { impure: 0.5, normal: 1, pure: 2 };

// --- Lues dans le jeu ------------------------------------------------------------------------------

// Recette de production : ingredients / produits par minute a 100 %, et batiment producteur (Build_*)
async function recipe(name) {
  const r = await call('recipe', name);
  return {
    name: r.recipe,
    duration: r.duration,
    inputs: r.ingredients.map(({ item, perMinute }) => ({ item, perMinute })),
    outputs: r.products.map(({ item, perMinute }) => ({ item, perMinute })),
    producer: r.producedIn.find((p) => p.startsWith('Build_')) || null,
  };
}

// Production d'une foreuse (objets / min) : cadence lue dans le jeu x purete x vitesse (1.0 = 100 %)
async function minerRate(tier, purity, potential = 1) {
  if (PURITY[purity] === undefined) throw new Error('purete inconnue : ' + purity);
  return (await K.minerBaseRate(tier)) * PURITY[purity] * potential;
}

// Build_ConstructorMk1_C -> Recipe_ConstructorMk1_C (verifie ensuite par la disposition apprise : buildClass).
// Exception du jeu, lue en jeu le 25/10/2026 (layout) : la fonderie simple Build_SmelterMk1_C se construit avec
// Recipe_SmelterBasicMk1_C ; Recipe_SmelterMk1_C construit la fonderie a deux entrees Build_FoundryMk1_C
const BUILD_RECIPE = { Build_SmelterMk1_C: 'Recipe_SmelterBasicMk1_C' };
const buildingRecipeOf = (buildClass) => BUILD_RECIPE[buildClass] || buildClass.replace(/^Build_/, 'Recipe_');

module.exports = {
  LIFT_STEP,
  MACHINE_WIRES,
  WIRE_MAX_LENGTH,
  IN_AIR,
  PURITY,
  recipe,
  minerRate,
  buildingRecipeOf,
  beltFor: K.beltFor,
};
