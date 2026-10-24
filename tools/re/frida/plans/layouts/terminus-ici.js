// Gare de chargement de minerai de l'ancien Venray, au bout de la ligne ici-ligne (utilisateur, 22-23/10/2026 : « pose la
// gare de chargement » ; ligne arrivee a la hauteur du joueur en vol, rail a 111,9 m). Modele du terminus du complexe
// d'acide (gare-acide.js, valide) : gare sur la voie d'arrivee, quais en chargement, boucle de demi-tour au bout, voie
// retour a 22 m (gare et quais debordent de 17 m de chaque cote : refus a 18 m, accepte a 22 m).
// - La ligne finit en double voie a 6,5 m (bouts libres A et R) : la gare est reculee de 57,8 m vers le sud pour laisser
//   la voie retour s'ecarter a 22 m (S de deux arcs de 57,8 m de rayon, cap 30 deg au milieu) ; la voie d'arrivee rejoint
//   le dernier quai par un rail droit de 57,8 m.
// - Boucle : trois arcs de rayon R = 22 / (4 cos 40 - 2) = 20,7 m (40 deg, 260 deg, 40 deg), caps des joints multiples
//   de 10 deg ; elle deborde de 47 m au-dela de la sortie, de 10 m a l'est et de 32 m a l'ouest.
// - Signaux de bloc : entree de la gare (bout du rail de liaison) et sortie (fin du premier arc de la boucle).
// - Repere : origine = sortie de la gare (TrackConnection1 de sa voie integree), axe 270 (u vers le nord, vers les
//   quais), v vers l'est : entrees / sorties de convoyeur des quais a l'est (comme hub-gare.js).
// node railplan.js layouts/terminus-ici.js check|build --origin -39186,-125286,11190 --axis 270 --nom terminus-ici
// Autre ligne finissant en double voie cap au sud (utilisateur, 23/10/2026 : gare des 8 gisements, ligne vers le Hub
// nord) : --bouts <fichier> (plans/<fichier>.json : { A: { path, near, far }, R: { ... } }, near = bout libre, far =
// autre bout du dernier rail) ; l'origine est alors 137,8 m au sud du bout A, a son altitude.
'use strict';
const fs = require('fs');
const path = require('path');

const QUAI = 16, LINK = 57.8, D = 22, TH = 40;
const R = D / (4 * Math.cos((TH * Math.PI) / 180) - 2);
const LEVEL = '/Game/FactoryGame/Map/GameLevel01/Persistent_Level.Persistent_Level:PersistentLevel.';
const rad = (d) => (d * Math.PI) / 180;

module.exports = (o = {}) => {
  const origin = String(o.origin || '-39186,-125286,11190').split(',').map(Number);
  // repere axe 270 : u = -(y - y0) / 100, v = (x - x0) / 100
  const loc = (p) => [-(p.y - origin[1]) / 100, (p.x - origin[0]) / 100, (p.z - origin[2]) / 100];
  const joints = { ST: [0, 0, 0], PL: [QUAI * 5, 0, 0] };
  const rails = [], signals = [];
  const J = (n, u, v) => { joints[n] = [u, v, 0]; return n; };
  let ENDS;
  if (o.bouts) {
    ENDS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', o.bouts + '.json'), 'utf8'));
  } else {
    // bouts de la ligne de l'ancien Venray (releves en jeu le 22/10/2026 : A18 TC1 et R18 TC0 libres a 111,9 m, cap sud)
    const line = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'ici-ligne-state.json'), 'utf8')).rails;
    ENDS = {
      A: { path: line.A18, near: { x: -39186, y: -139066, z: 11190 }, far: { x: -38710, y: -142050, z: 10877 } },
      R: { path: line.R18, near: { x: -39836, y: -139066, z: 11190 }, far: { x: -39360, y: -142050, z: 10877 } },
    };
  }
  for (const [k, e] of Object.entries(ENDS)) {
    joints[k + 'E'] = loc(e.near); joints['k' + k + 'f'] = loc(e.far);
    const n = joints[k + 'E'], f = joints['k' + k + 'f'];
    // cap dans le repere : celui de la corde du dernier rail (droit sur la ligne de l'ancien Venray), ou e.cap impose
    // (dernier rail courbe : la corde ne donne pas la tangente au bout)
    const cap = e.cap != null ? e.cap : Math.round((Math.atan2(n[1] - f[1], n[0] - f[0]) * 180) / Math.PI);
    rails.push({ id: 'k' + k, from: 'k' + k + 'f', fromCap: cap, to: k + 'E', toCap: cap, existing: e.path.includes('/') ? e.path : LEVEL + e.path });
  }
  // liaison : bout A -> dernier quai (vers le sud = cap 180 du repere) ; signal de bloc a l'entree de la gare
  rails.push({ id: 'Lk', from: 'AE', fromCap: 180, to: 'PL', toCap: 180 });
  signals.push({ id: 'xEn', type: 'block', rail: 'Lk', end: 'to' });
  // boucle : repere local (a le long du sens de marche = -u, b vers la voie retour = -v), caps h du jeu = h + 180
  const pt = (a, b) => [-a, -b];
  const arc2 = { a: 2 * R * Math.sin(rad(TH)), b: 2 * R * Math.cos(rad(TH)) - R }; // centre du grand arc
  const hs = [-TH, 10, 60, 110, 160, 180 + TH]; // joints du grand arc (troncons de 50 a 60 deg)
  const names = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'];
  hs.forEach((h, i) => { const [u, v] = pt(arc2.a + R * Math.sin(rad(h)), arc2.b - R * Math.cos(rad(h))); J(names[i], u, v); });
  J('RT0', 0, -D);
  const capOf = (h) => ((h + 180) % 360 + 360) % 360;
  rails.push({ id: 'B1', from: 'ST', fromCap: 180, to: 'L1', toCap: capOf(-TH) });
  signals.push({ id: 'xSo', type: 'block', rail: 'B1', end: 'to' });
  for (let i = 1; i < hs.length; i++) rails.push({ id: 'B' + (i + 1), from: names[i - 1], fromCap: capOf(hs[i - 1]), to: names[i], toCap: capOf(hs[i]) });
  rails.push({ id: 'B7', from: 'L6', fromCap: capOf(180 + TH), to: 'RT0', toCap: 0 });
  // voie retour le long de la gare, puis S vers le bout R de la ligne
  J('RN', QUAI * 5, -D);
  const Rs = (D - 6.5) / (2 * (1 - Math.cos(rad(30))));
  J('RS', QUAI * 5 + Rs * Math.sin(rad(30)), -D + Rs * (1 - Math.cos(rad(30))));
  rails.push({ id: 'Rg', from: 'RT0', fromCap: 0, to: 'RN', toCap: 0 });
  rails.push({ id: 'Rs1', from: 'RN', fromCap: 0, to: 'RS', toCap: 30 });
  rails.push({ id: 'Rs2', from: 'RS', fromCap: 30, to: 'RE', toCap: 0 });
  const check = Math.hypot(joints.RE[0] - (QUAI * 5 + 2 * Rs * Math.sin(rad(30))), joints.RE[1] + 6.5);
  if (check > 0.3) throw new Error('le S de la voie retour ne tombe pas sur le bout R (' + check.toFixed(2) + ' m) : revoir LINK');
  return {
    station: { at: [QUAI / 2, 0, 0], cap: 0 },
    platforms: { count: 4, firstAt: QUAI, length: QUAI, reversed: false, inAir: true },
    platformsRail: { id: 'quais', from: 'PL', fromCap: 180, to: 'ST', toCap: 180 },
    joints, rails, signals, signalsLeftHanded: true,
  };
};
