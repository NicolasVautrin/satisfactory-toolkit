// Gare de dechargement au nord de l'anneau de la voie basse (utilisateur, 22/10/2026 : « sur le cote nord, meme layout que
// la metallurgie, tu referas un anneau apres ») : comme les gares « est » de la gare de triage (layouts/hub.js), gare + 4
// quais dans l'alignement du cote nord, a l'ouest de l'anneau ; sortie vers l'est (rail Eo, signal de chemin sur le cote
// ouest de l'anneau, puis Eon jusqu'au coin NW, qui devient une convergence) ; entree a l'ouest (G5) depuis le coin NE du
// second anneau, posee avec lui (anneau-ici.js --gare anneau-vb-est1 --nom anneau-vb2 : rail Ein, signal xEi).
// Gare posee par layouts/hub-gare.js (etat anneau-vb-est1, origine -95 124 ; -211 470 ; 349, axe 180), quais en dechargement.
//
// Repere de l'anneau (layouts/anneau-voie-basse.js) : origine (-86 144 ; -207 220 ; 349), axe 180 (u ouest, v nord).
// node railplan.js layouts/anneau-gare-nord.js check|build --origin -86144,-207220,349 --axis 180 --nom anneau-vb-gare-nord
// Paire suivante (utilisateur, 23/10/2026 : gare jumelle de la 39 « dans le prolongement de la voie du bas au nord, apres le
// prochain anneau ») : --anneau <etat de l'anneau a l'est de la gare> --gare <etat de la gare>, origine = centre de cet
// anneau, ex. --origin -109599,-207220,349 --anneau anneau-vb2 --gare anneau-vb-est2 --nom anneau-vb2-gare-nord
// --ent <m> : ecart entre l'entree de la gare et le cote de l'anneau suivant (6 par defaut) ; 12 pour la regle de
// l'utilisateur (26/10/2026 : pas de signal a l'entree d'une gare, rail de 12 m au moins ; gare avancee de 6 m vers sa
// sortie, Eo raccourci d'autant, voir layouts/hub.js --ent et layouts/anneau-entree-nord.js --ent)
'use strict';
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf('--' + name); return i < 0 ? def : argv[i + 1]; };

const R = 18, VN = 6.5, QUAI = 16;
const PAIR = 117.05, QUAIS = QUAI * 5, ENT = 6; // cotes de la gare de triage (hub.js)
const XSTUB = PAIR - QUAIS - ENT; // de la sortie de la gare au cote ouest de l'anneau (31,05 m)
const HG = require('./hub-helices.js').geometry();
const W = HG.UW - HG.UE0;
const PLANS = path.join(__dirname, '..') + '/';
const rad = (d) => (d * Math.PI) / 180;

module.exports = () => {
  const ring = JSON.parse(fs.readFileSync(PLANS + opt('anneau', 'anneau-vb') + '-state.json', 'utf8')).rails;
  const gare = JSON.parse(fs.readFileSync(PLANS + opt('gare', 'anneau-vb-est1') + '-state.json', 'utf8')).integrated;
  const uw = W / 2, VNR = VN + 2 * R;
  const ent = Number(opt('ent', ENT));
  if (!(ent >= ENT)) throw new Error('--ent : ' + opt('ent') + ' (au moins ' + ENT + ')');
  const joints = {}, rails = [], signals = [];
  const J = (name, u, v) => { joints[name] = [u, v, 0]; return name; };
  // anneau : coin NW (nw2 : nwm -> NW) et debut du cote nord (n1 : NW -> nj1), deja poses
  J('NW', uw - R, VNR); J('nwm', uw - R + R * Math.cos(rad(50)), VNR - R + R * Math.sin(rad(50))); J('nj1', 0, VNR);
  rails.push({ id: 'nw2', from: 'nwm', fromCap: 140, to: 'NW', toCap: 180, existing: ring.nw2 });
  rails.push({ id: 'n1', from: 'NW', fromCap: 180, to: 'nj1', toCap: 180, existing: ring.n1 });
  // gare : voies integrees G0 (sortie) .. G5 (entree), vers l'ouest
  const exit = uw + XSTUB - (ent - ENT);
  for (let i = 0; i <= 5; i++) J('G' + i, exit + QUAI * i, VNR);
  for (let i = 0; i < 5; i++) rails.push({ id: 'gare' + i, from: 'G' + i, fromCap: 0, to: 'G' + (i + 1), toCap: 0, existing: gare[i] });
  // sortie vers l'est jusqu'au cote ouest de l'anneau (signal de chemin : entree du bloc de l'anneau), puis coin NW
  J('XE', uw, VNR);
  rails.push({ id: 'Eo', from: 'G0', fromCap: 180, to: 'XE', toCap: 180 });
  signals.push({ id: 'eEo', type: 'path', rail: 'Eo', end: 'to' });
  rails.push({ id: 'Eon', from: 'XE', fromCap: 180, to: 'NW', toCap: 180 });
  return { joints, rails, signals, signalsLeftHanded: true };
};
