// Modele de gare "contournement" (valide par l'utilisateur le 18/10/2026, premiere instance : 64 m a l'ouest de Breda).
//
// Une gare + N quais de fret sur une voie decalee de 16 m de la ligne, pour une ligne a double voie :
//  - voie est (sens -u) : EN -> D -> quais -> gare -> A -> B -> ES ; la voie principale quitte l'axe de la ligne pour
//    la gare par une courbe en S qui finit sur l'aiguillage (D au nord, B au sud) ;
//  - contournement dans l'axe de la ligne (v = 16), decale seulement en hauteur : palier de niveau apres chaque
//    aiguillage (zone ou les deux branches se rejoignent), rampe, ligne droite a -9 m ;
//  - boucle de demi-tour pour les trains sortant de la gare vers la voie ouest (sens +u, v = 24) : descente droite
//    depuis A (la voie principale s'en ecarte vers l'ouest ; tourner aussitot la mettrait juste sous elle), demi-tour
//    de 20 m de rayon sous la ligne apres B en remontant pendant le second quart, courbe en S de niveau vers C ;
//  - signalisation suivant le wiki (Train_Signals) : signaux de chemin a l'entree des convergences B et C ("path in,
//    block out"), blocs de chemin de niveau, gare dans un bloc a signaux de bloc. Les bouts EN, ES, WN, WS attendent un
//    raccordement au reseau (blocs sans sortie d'ici la).
// Les cotes (rayons, longueurs de courbes et de rampes, paliers, ecarts entre voies) ont ete validees a blanc par le jeu
// et par railplan.js check (ecarts entre voies de blocs differents) pour 4 quais : 218 m hors tout.
//
// Repere de railplan.js (metres) : origine = sortie de la gare, u le long des quais, v = cap de u + 90 (cote voie
// ouest), z vertical.
// Options : --quais <n> (4), --chargement oui|non (oui)
// Usage : node railplan.js layouts/gare-contournement.js check|build --beside <gare> --offset <m> [--nom <instance>]
'use strict';

const QUAI = 16; // longueur d'une gare ou d'un quai (voie integree de 16 m, verifiee a la construction)
const MAX_RAIL = 90; // troncon le plus long : sous mMaxLength du jeu (100 m), qui refuse deja un rail droit de 100 m pile

// Rails d'une ligne droite de `from` a `to` (dans le sens donne), coupee en troncons egaux d'au plus MAX_RAIL ;
// joints intermediaires nommes prefix1, prefix2... ; ids : id unique si un seul troncon, sinon ids fournis
function straight(joints, ids, prefix, from, to, cap) {
  const [a, b] = [joints[from], joints[to]];
  const n = Math.ceil(Math.abs(b[0] - a[0]) / MAX_RAIL);
  const names = [from];
  for (let k = 1; k < n; k++) {
    names.push(prefix + k);
    joints[prefix + k] = a.map((x, i) => x + ((b[i] - x) * k) / n);
  }
  names.push(to);
  return names.slice(1).map((j, k) => ({ id: n === 1 ? ids[0] : ids[1](k), from: names[k], fromCap: cap, to: j, toCap: cap }));
}

module.exports = (opt) => {
  const quais = Number(opt.quais || 4);
  const load = !/^(non|false|0)$/i.test(String(opt.chargement || 'oui'));
  const PL = QUAI * (1 + quais); // bout libre du dernier quai
  const D = PL + 44; // aiguillage nord : troncon de 12 m apres les quais + courbe en S de 32 m
  const B = -46; // aiguillage sud : troncon de 12 m apres la gare + courbe en S de 34 m (en 2 rails)
  const C = B + 34; // convergence de la boucle sur la voie ouest

  const joints = {
    ST: [0, 0, 0], // sortie de la gare
    PL: [PL, 0, 0],
    N1: [PL + 12, 0, 0],
    D: [D, 16, 0],
    EN1: [D + 12, 16, 0],
    EN: [D + 24, 16, 0],
    // Contournement dans l'axe v = 16
    DL: [D - 12, 16, 0], // fin du palier nord
    RB: [D - 48, 16, -9], // pied de la rampe nord
    RS: [B + 54, 16, -9], // pied de la rampe sud
    T: [B + 18, 16, 0], // debut du palier sud (signal de chemin), assez loin de B pour que la branche principale soit a plus de 6 m
    A: [-12, 0, 0],
    SM: [(B - 12) / 2, 8, 0], // milieu de la courbe en S sud (signal de chemin)
    B: [B, 16, 0],
    ES1: [B - 12, 16, 0],
    ES: [B - 24, 16, 0],
    // Boucle de demi-tour
    LA: [B + 2, 0, -9],
    LB: [B - 18, 20, -9],
    LT: [B + 2, 40, 0], // haut de la remontee de la boucle (signal de chemin : bloc de convergence de niveau)
    C: [C, 24, 0],
    W1: [C + 12, 24, 0],
    WN: [D + 24, 24, 0],
    WS: [B - 24, 24, 0],
    WS1: [C - 16, 24, 0], // signal de chemin : assez loin de C pour que la courbe en S de la boucle soit a plus de 6 m
  };
  if (joints.RB[0] - joints.RS[0] < 12) throw new Error('trop peu de quais pour ce modele (contournement < 12 m)');

  // Ordre de construction : a un aiguillage, le rail commun (tronc) avant la 2e branche
  const rails = [
    { id: 'stubN', from: 'PL', fromCap: 0, to: 'N1', toCap: 0 },
    { id: 'sN', from: 'N1', fromCap: 0, to: 'D', toCap: 0 },
    { id: 'en1', from: 'D', fromCap: 0, to: 'EN1', toCap: 0 },
    { id: 'en2', from: 'EN1', fromCap: 0, to: 'EN', toCap: 0 },
    { id: 'stubS', from: 'ST', fromCap: 180, to: 'A', toCap: 180 },
    { id: 'sS1', from: 'A', fromCap: 180, to: 'SM', toCap: 140 },
    { id: 'sS2', from: 'SM', fromCap: 140, to: 'B', toCap: 180 },
    { id: 'es1', from: 'B', fromCap: 180, to: 'ES1', toCap: 180 },
    { id: 'es2', from: 'ES1', fromCap: 180, to: 'ES', toCap: 180 },
    { id: 'palN', from: 'D', fromCap: 180, to: 'DL', toCap: 180 },
    { id: 'rampN', from: 'DL', fromCap: 180, to: 'RB', toCap: 180 },
    ...straight(joints, ['byp', (k) => 'byp' + (k + 1)], 'BM', 'RB', 'RS', 180),
    { id: 'rampS', from: 'RS', fromCap: 180, to: 'T', toCap: 180 },
    { id: 'palS', from: 'T', fromCap: 180, to: 'B', toCap: 180 },
    { id: 'loopS1', from: 'A', fromCap: 180, to: 'LA', toCap: 180 },
    { id: 'loopS2', from: 'LA', fromCap: 180, to: 'LB', toCap: 90 },
    { id: 'loopS3', from: 'LB', fromCap: 90, to: 'LT', toCap: 0 },
    { id: 'w3', from: 'C', fromCap: 0, to: 'W1', toCap: 0 },
    ...straight(joints, ['w4', (k) => 'w' + (k + 4)], 'WM', 'W1', 'WN', 0),
    { id: 'loopC', from: 'LT', fromCap: 0, to: 'C', toCap: 0 },
    { id: 'w1', from: 'WS', fromCap: 0, to: 'WS1', toCap: 0 },
    { id: 'w2', from: 'WS1', fromCap: 0, to: 'C', toCap: 0 },
  ];

  return {
    station: { at: [QUAI / 2, 0, 0], cap: 0 }, // centre de la gare (sortie en u = 0)
    // Quais de fret retournes comme a Breda (entrees / sorties de convoyeur cote -v, a l'oppose de la voie ouest) ; en
    // l'air (pas de dalle) : refus "pas de sol" accepte
    platforms: { count: quais, firstAt: QUAI, length: QUAI, load, reversed: true, inAir: true },
    platformsRail: { id: 'quais', from: 'PL', fromCap: 180, to: 'ST', toCap: 180 },
    joints,
    rails,
    // Signal : garde le bout `end` du rail `rail` (arrete les trains qui sortent du rail par ce bout)
    signals: [
      { id: 'EN1', type: 'block', rail: 'en2', end: 'from' }, // entree de l'aiguillage D
      { id: 'N1', type: 'block', rail: 'sN', end: 'from' }, // entree de la gare
      { id: 'RB', type: 'block', rail: 'rampN', end: 'to' }, // entree du contournement
      { id: 'A', type: 'block', rail: 'stubS', end: 'to' }, // sortie de la gare
      { id: 'SS', type: 'path', rail: 'sS1', end: 'to' }, // convergence B, cote gare
      { id: 'T', type: 'path', rail: 'rampS', end: 'to' }, // convergence B, cote contournement
      { id: 'ES1', type: 'block', rail: 'es1', end: 'to' }, // sortie de la convergence B
      { id: 'LT', type: 'path', rail: 'loopS3', end: 'to' }, // convergence C, cote boucle
      { id: 'WS1', type: 'path', rail: 'w1', end: 'to' }, // convergence C, cote voie ouest
      { id: 'W1', type: 'block', rail: 'w3', end: 'to' }, // sortie de la convergence C
    ],
  };
};
