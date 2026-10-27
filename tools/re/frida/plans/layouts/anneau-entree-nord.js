// Entree d'une gare posee au nord de la voie basse, a l'est d'un anneau DEJA pose (layouts/anneau-gare-nord.js pour sa
// sortie) : aiguillage au coin NE de l'anneau, droite Ein jusqu'a l'entree de la gare (G5, 6 m du cote est de l'anneau),
// signal de bloc xEi a l'entree ; comme le rail Ein de layouts/anneau-voie-basse.js (keep.GARE), sans reposer l'anneau
// (ses rails gardes ont pu etre remplaces depuis par l'anneau suivant ; 26/10/2026, gare N266 E53 devant le module de
// carburant pour fusees).
// Repere de l'anneau (layouts/anneau-voie-basse.js) : origine (cx ; y de la voie sud ; 349), axe 180 (u ouest, v nord).
// node railplan.js layouts/anneau-entree-nord.js check|build --origin 39716,-261512,349 --axis 180 --anneau anneau-vbd2
//   --gare anneau-vbd-est1 --nom anneau-vbd2-entree
// --ent <m> : ecart entre l'entree de la gare et le cote de l'anneau (6 par defaut). Regle de l'utilisateur (26/10/2026) :
// « pas de signaux a l'entree et a la sortie des gares, segment minimum de 12m ». Le rail d'entree part d'un aiguillage
// tangent au coin de l'anneau, dont la courbe reste a moins de 6,2 m du rail sur 13,6 m (meme bloc) : au-dela de 7,6 m,
// l'entree est coupee (Ein cote anneau, Eing de 12 m cote gare) et le signal passe a leur jonction ; 12 : 18 + 12 m.
'use strict';
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf('--' + name); return i < 0 ? def : argv[i + 1]; };

const R = 18, VN = 6.5, QUAI = 16, ENT = 6;
const HG = require('./hub-helices.js').geometry();
const W = HG.UW - HG.UE0;
const PLANS = path.join(__dirname, '..') + '/';
const rad = (d) => (d * Math.PI) / 180;

module.exports = () => {
  const ring = JSON.parse(fs.readFileSync(PLANS + opt('anneau', 'anneau-vbd2') + '-state.json', 'utf8')).rails;
  const gare = JSON.parse(fs.readFileSync(PLANS + opt('gare', 'anneau-vbd-est1') + '-state.json', 'utf8')).integrated;
  const ue = -W / 2, VNR = VN + 2 * R;
  const joints = {}, rails = [], signals = [];
  const J = (name, u, v) => { joints[name] = [u, v, 0]; return name; };
  // anneau : fin du cote nord (n2 : nj1 -> NE) et debut du coin NE (ne1 : NE -> nem), deja poses
  J('nj1', 0, VNR); J('NE', ue + R, VNR); J('nem', ue + R + R * Math.cos(rad(140)), VNR - R + R * Math.sin(rad(140)));
  rails.push({ id: 'n2', from: 'nj1', fromCap: 180, to: 'NE', toCap: 180, existing: ring.n2 });
  rails.push({ id: 'ne1', from: 'NE', fromCap: 180, to: 'nem', toCap: 230, existing: ring.ne1 });
  // gare : derniere voie integree (G4 -> G5, entree), a ENT (ou --ent) du cote est de l'anneau
  const ent = Number(opt('ent', ENT));
  if (!(ent >= ENT)) throw new Error('--ent : ' + opt('ent') + ' (au moins ' + ENT + ')');
  J('G5', ue - ent, VNR); J('G4', ue - ent - QUAI, VNR);
  rails.push({ id: 'kGARE', from: 'G5', fromCap: 180, to: 'G4', toCap: 180, existing: gare[gare.length - 1] });
  if (ent >= 7.6) {
    J('Gm', ue - ent + 12, VNR);
    rails.push({ id: 'Ein', from: 'NE', fromCap: 180, to: 'Gm', toCap: 180 });
    rails.push({ id: 'Eing', from: 'Gm', fromCap: 180, to: 'G5', toCap: 180 });
  } else {
    rails.push({ id: 'Ein', from: 'NE', fromCap: 180, to: 'G5', toCap: 180 });
  }
  signals.push({ id: 'xEi', type: 'block', rail: 'Ein', end: 'to' });
  return { joints, rails, signals, signalsLeftHanded: true };
};
