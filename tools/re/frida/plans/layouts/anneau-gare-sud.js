// Gare au sud de la voie basse entre deux anneaux (utilisateur, 26/10/2026 : « on va faire une gare de chargement cote sud
// de cette gare » [N211 O96]) : image de layouts/anneau-gare-nord.js par le demi-tour autour du milieu des deux anneaux. Le
// cote sud des anneaux circule vers l'ouest : la gare (layouts/hub-gare.js, axe 0, origine = sortie a l'ouest) sort vers
// l'ouest (rail Eo, signal de chemin sur le cote est de l'anneau ouest, puis Eon jusqu'au coin SE, qui devient une
// convergence) ; elle entre a l'est (G5) depuis le coin SW de l'anneau est (aiguillage, rail Ein, signal de bloc xEi).
//
// Repere de l'anneau OUEST (layouts/anneau-voie-basse.js) : origine (cx ; -207 220 ; 349), axe 180 (u ouest, v nord).
// node railplan.js layouts/anneau-gare-sud.js check|build --origin -109599,-207220,349 --axis 180 --anneau anneau-vb2
//   --est anneau-vb --gare anneau-vb-sud1 --nom anneau-vb2-gare-sud
//   --anneau : etat de l'anneau ouest ; --est : etat de l'anneau est ; --gare : etat de la gare ; --entre <m> : distance
//   entre les centres des deux anneaux (defaut : lue dans les etats, d'apres leurs rails)
//   --ent <m> : ecart entre l'entree de la gare et le cote de l'anneau est (6 par defaut). Regle de l'utilisateur
//   (26/10/2026) : « pas de signaux a l'entree et a la sortie des gares, segment minimum de 12m » ; 12 : gare reculee de
//   6 m vers sa sortie, Eo raccourci d'autant, entree coupee en Ein (18 m, cote anneau) + Eing (12 m) et signal a leur
//   jonction (la courbe du coin reste a moins de 6,2 m du rail d'entree sur 13,6 m : meme bloc)
'use strict';
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf('--' + name); return i < 0 ? def : argv[i + 1]; };

const R = 18, QUAI = 16;
const PAIR = 117.05, QUAIS = QUAI * 5, ENT = 6; // cotes de la gare de triage (hub.js)
const XSTUB = PAIR - QUAIS - ENT; // de la sortie de la gare au cote de l'anneau (31,05 m)
const HG = require('./hub-helices.js').geometry();
const W = HG.UW - HG.UE0;
const PLANS = path.join(__dirname, '..') + '/';
const rad = (d) => (d * Math.PI) / 180;

module.exports = () => {
  const ouest = JSON.parse(fs.readFileSync(PLANS + opt('anneau', 'anneau-vb2') + '-state.json', 'utf8'));
  const est = JSON.parse(fs.readFileSync(PLANS + opt('est', 'anneau-vb') + '-state.json', 'utf8'));
  const gare = JSON.parse(fs.readFileSync(PLANS + opt('gare', 'anneau-vb-sud1') + '-state.json', 'utf8')).integrated;
  // distance entre les centres : origines des reperes des deux anneaux (anneaux poses sur la meme voie, axe 180)
  const D = opt('entre') != null ? Number(opt('entre')) : (ouest.frame.origin.x - est.frame.origin.x) / -100;
  if (!(D > W)) throw new Error('distance entre les anneaux invalide : ' + D);
  const ue = -W / 2, uw = W / 2, VSR = -2 * R;
  const ent = Number(opt('ent', ENT));
  if (!(ent >= ENT)) throw new Error('--ent : ' + opt('ent') + ' (au moins ' + ENT + ')');
  const joints = {}, rails = [], signals = [];
  const J = (name, u, v) => { joints[name] = [u, v, 0]; return name; };
  // anneau ouest : coin SE (se2 : sem -> SE) et debut du cote sud (sa : SE -> XO), deja poses
  J('SE', ue + R, VSR); J('sem', ue + R + R * Math.cos(rad(230)), -R + R * Math.sin(rad(230))); J('XO', -R - 6.5 / 2, VSR);
  rails.push({ id: 'se2', from: 'sem', fromCap: 320, to: 'SE', toCap: 360, existing: ouest.rails.se2 });
  rails.push({ id: 'sa', from: 'SE', fromCap: 0, to: 'XO', toCap: 0, existing: ouest.rails.sa });
  // gare : voies integrees G0 (sortie, a l'ouest) .. G5 (entree), vers l'est (u decroissant)
  const exit = ue - XSTUB + (ent - ENT);
  for (let i = 0; i <= 5; i++) J('G' + i, exit - QUAI * i, VSR);
  for (let i = 0; i < 5; i++) rails.push({ id: 'gare' + i, from: 'G' + i, fromCap: 180, to: 'G' + (i + 1), toCap: 180, existing: gare[i] });
  // sortie vers l'ouest jusqu'au cote est de l'anneau (signal de chemin : entree du bloc de l'anneau), puis coin SE
  J('XE', ue, VSR);
  rails.push({ id: 'Eo', from: 'G0', fromCap: 0, to: 'XE', toCap: 0 });
  signals.push({ id: 'eEo', type: 'path', rail: 'Eo', end: 'to' });
  rails.push({ id: 'Eon', from: 'XE', fromCap: 0, to: 'SE', toCap: 0 });
  // anneau est (centre a u = -D) : fin du cote sud (sc : XI -> SW) et debut du coin SW (sw1 : SW -> swm), deja poses ;
  // aiguillage en SW, droite jusqu'a l'entree de la gare (6 m du cote ouest de l'anneau est), signal de bloc a l'entree
  J('SW1', -D + uw - R, VSR); J('XI1', -D + R + 6.5 / 2, VSR);
  J('swm1', -D + uw - R + R * Math.cos(rad(320)), -R + R * Math.sin(rad(320)));
  rails.push({ id: 'sc1', from: 'XI1', fromCap: 0, to: 'SW1', toCap: 0, existing: est.rails.sc });
  rails.push({ id: 'sw1e', from: 'SW1', fromCap: 0, to: 'swm1', toCap: 50, existing: est.rails.sw1 });
  if (Math.abs(joints.G5[0] - (-D + uw + ent)) > 0.5) throw new Error('entree de la gare a ' + (joints.G5[0] + D - uw).toFixed(2) + ' m du cote ouest de l\'anneau est (attendu ' + ent + ')');
  if (ent >= 7.6) {
    J('Gm', joints.G5[0] - 12, VSR);
    rails.push({ id: 'Ein', from: 'SW1', fromCap: 0, to: 'Gm', toCap: 0 });
    rails.push({ id: 'Eing', from: 'Gm', fromCap: 0, to: 'G5', toCap: 0 });
  } else {
    rails.push({ id: 'Ein', from: 'SW1', fromCap: 0, to: 'G5', toCap: 0 });
  }
  signals.push({ id: 'xEi', type: 'block', rail: 'Ein', end: 'to' });
  return { joints, rails, signals, signalsLeftHanded: true };
};
