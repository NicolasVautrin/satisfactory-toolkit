// Banc d'essai de croisement aux bouts d'anneau (utilisateur, 26/10/2026, apres quatre deraillements : « il faudrait
// construire 2 trains ESSAI1 et ESSAI2 avec disons 6 vagons » ; « j'essayerais bien une distance de 7m » ; « on augmentera
// de 0.5 en 0.5 si ca passe pas » ; « on peut faire des train avec des loco a chaque bout » ; « des gares sans quai » ;
// « juste au dessus du pipe de petrole »).
//
// Deux voies sans lien entre elles, qui reproduisent un bout d'anneau (anneau-voie-basse.js, hub.js) au point J :
//  - voie S (ESSAI1) : gare S1 au bout de la branche S, branche droite, quart de cercle de 18 m (W0 -> J, comme la sortie
//    So d'un anneau), droite jusqu'a la gare S2 ;
//  - voie N (ESSAI2) : gare N1, S de deux arcs de 30 deg qui l'ecarte de la voie S (les gares font 34 m de large), droite
//    parallele a la voie S a `ecart` m, quart de cercle de 18 m (J' -> W1, comme l'entree Ni), branche droite jusqu'a N2.
// Chaque train fait la navette entre ses deux gares (une locomotive a chaque bout). Les distances gare -> point de
// croisement sont egales sur les deux voies, dans les deux sens : partis ensemble, les trains se croisent a J a chaque
// trajet (croisements entre u -66 et +66 m pour des trains de 133 m : le S de la voie N, a partir de u 60, n'y entre pas).
//
// Repere du banc : origine J (--j x,y,z), u le long de la double voie (de J vers les gares S2 / N1), v a gauche de u
// (branche N du cote +v). Chaque morceau (--piece S1|S2|N1|N2) est un plan railplan dans le repere de SA gare (origine =
// sortie de la gare, u vers la voie) : frames(o) donne origine et cap de chaque gare. S2 / N2 : gare seule, posee avant
// la voie qui y aboutit (S1 / N1 : gare + rails).
//   node banc-croisement.js plan|pose ... (pilote : plans/banc-croisement.js)
'use strict';

const fs = require('fs');
const path = require('path');

const R = 18; // quarts de cercle des bouts d'anneau
const GARE = 16; // voie integree d'une gare
const SB = { angle: 30, offset: 30 }; // S de la voie N : deux arcs de 30 deg, ecart final de 30 m (gares a 37 m d'axe en axe)
const ND = 60; // double voie de J au debut du S
const rad = (d) => (d * Math.PI) / 180;
const SB_R = SB.offset / (2 * (1 - Math.cos(rad(SB.angle)))); // rayon des arcs du S (112 m)
const SB_L = 2 * SB_R * Math.sin(rad(SB.angle)); // longueur du S en u (112 m)
const SB_ARC = 2 * SB_R * rad(SB.angle); // longueur du S (117,2 m)
const QUART = (Math.PI * R) / 2;
const U_GARE = ND + SB_L; // entree (TrackConnection0) des gares S2 et N1
// Branches : memes distances gare -> croisement sur les deux voies, aller (S1 / N1) et retour (S2 / N2)
const LA_S = GARE + SB_ARC + ND - GARE - QUART; // S1 -> J = N1 -> J'
const LA_N = GARE + U_GARE - GARE - QUART; // N2 -> J' = S2 -> J
const PLANS = path.join(__dirname, '..') + '/';

function rig(o) {
  const [x, y, z] = String(o.j || '').split(',').map(Number);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) throw new Error('--j x,y,z (point de croisement J) requis');
  const ecart = Number(o.ecart || 7);
  const axe = Number(o.axe != null ? o.axe : 270);
  // points du banc (repere du banc, m) ; caps du sens de marche aller (S1 -> S2, N1 -> N2)
  const P = {
    S1x: [-R, -R - LA_S - GARE], S1in: [-R, -R - LA_S], S1m: [-R, -R - LA_S / 2], W0: [-R, -R], J: [0, 0],
    Sdm: [U_GARE / 2, 0], S2in: [U_GARE, 0], S2x: [U_GARE + GARE, 0],
    N1x: [U_GARE + GARE, ecart + SB.offset], N1in: [U_GARE, ecart + SB.offset], Nsm: [ND + SB_L / 2, ecart + SB.offset / 2],
    Ns0: [ND, ecart], Jp: [0, ecart], W1: [-R, ecart + R], N2m: [-R, ecart + R + LA_N / 2], N2in: [-R, ecart + R + LA_N],
    N2x: [-R, ecart + R + LA_N + GARE],
  };
  const world = (p, zz = 0) => ({ x: x + 100 * (p[0] * Math.cos(rad(axe)) - p[1] * Math.sin(rad(axe))), y: y + 100 * (p[0] * Math.sin(rad(axe)) + p[1] * Math.cos(rad(axe))), z: z + 100 * zz });
  // gares : sortie (bout mort) et cap de leur voie (de la sortie vers la voie) dans le repere du banc
  const stations = {
    S1: { at: P.S1x, cap: 90 }, S2: { at: P.S2x, cap: 180 }, N1: { at: P.N1x, cap: 180 }, N2: { at: P.N2x, cap: 270 },
  };
  for (const s of Object.values(stations)) { s.origin = world(s.at); s.axis = (axe + s.cap) % 360; }
  return { x, y, z, ecart, axe, P, world, stations };
}

function frames(o) {
  const b = rig(o);
  return Object.fromEntries(Object.entries(b.stations).map(([k, s]) => [k, { origin: s.origin, axis: s.axis }]));
}

function plan(o) {
  const b = rig(o);
  const piece = o.piece;
  if (!b.stations[piece]) throw new Error('--piece S1|S2|N1|N2');
  const st = b.stations[piece];
  // repere de la gare : u = cap st.cap du banc depuis sa sortie
  const toLocal = (p) => {
    const dx = p[0] - st.at[0], dy = p[1] - st.at[1], a = rad(st.cap);
    return [dx * Math.cos(a) + dy * Math.sin(a), -dx * Math.sin(a) + dy * Math.cos(a), 0];
  };
  const cap = (c) => (((c - st.cap) % 360) + 360) % 360;
  const joints = {}, rails = [];
  const J = (name) => { joints[name] = toLocal(b.P[name]); return name; };
  const rail = (id, from, fromCap, to, toCap, extra) => { J(from); J(to); rails.push(Object.assign({ id, from, fromCap: cap(fromCap), to, toCap: cap(toCap) }, extra || {})); };
  // voie integree d'une gare deja posee (S2 / N2), accroche du dernier rail
  const kept = (id, a, b2, c, state) => {
    const f = PLANS + state + '-state.json';
    const t = fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, 'utf8')).integrated || [])[0] : null;
    if (!t && !o.ebauche) throw new Error('gare ' + state + ' pas posee (poser S2 / N2 d\'abord)');
    rail(id, a, c, b2, c, t ? { existing: t } : {});
  };
  const base = { station: { at: [GARE / 2, 0, 0], cap: 0 }, joints, rails, signals: [] };
  if (piece === 'S1') {
    rail('Sa1', 'S1in', 90, 'S1m', 90); rail('Sa2', 'S1m', 90, 'W0', 90);
    rail('Sq', 'W0', 90, 'J', 0);
    rail('Sd1', 'J', 0, 'Sdm', 0); rail('Sd2', 'Sdm', 0, 'S2in', 0);
    kept('kS2', 'S2in', 'S2x', 0, o.nom.replace(/S1$/, 'S2'));
  } else if (piece === 'N1') {
    rail('Ns1', 'N1in', 180, 'Nsm', 180 + SB.angle); rail('Ns2', 'Nsm', 180 + SB.angle, 'Ns0', 180);
    rail('Nd', 'Ns0', 180, 'Jp', 180);
    rail('Nq', 'Jp', 180, 'W1', 90);
    rail('Na1', 'W1', 90, 'N2m', 90); rail('Na2', 'N2m', 90, 'N2in', 90);
    kept('kN2', 'N2in', 'N2x', 90, o.nom.replace(/N1$/, 'N2'));
  } else {
    joints.ST = [0, 0, 0];
  }
  return base;
}

module.exports = (o = {}) => plan(o);
module.exports.frames = frames;
module.exports.rig = rig;
module.exports.LENGTHS = { R, GARE, ND, SB_R, SB_L, SB_ARC, QUART, U_GARE, LA_S, LA_N };
