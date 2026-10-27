// Paire d'helices a etages dans l'anneau 0 de la gare de triage (utilisateur, 21/10/2026 : « c'est la variante 2 qu'il
// faut » : double voie entre les helices ; « le raccord aux helices est au nord a tous les etages comme en bas »).
// Posee avec l'etage du bas de hub.js.
//
// Deux helices a voie unique cote a cote d'est en ouest, toutes deux dans le sens des aiguilles d'une montre vu du
// dessus : montante U a l'ouest, descendante D a l'est, 7 m entre elles (6,5 m avant le 26/10/2026, voir GAP).
//  - En bas, une double voie nord-sud entre elles (circulation a droite, consequence du sens horaire) : depuis le cote
//    nord de l'anneau 0, quart de cercle de 18 m a droite puis 17 m de droite jusqu'au point est de U (cap sud) ; depuis
//    le point ouest de D (cap nord), 17 m de droite puis quart de cercle jusqu'au cote nord.
//  - Premier etage en un tour et demi a pente douce (40 % de la pente maximale, 10,6 deg) : les helices passent ensuite
//    chaque etage par leur cote exterieur, U par son point ouest (cap nord), D par son point est (cap sud). Aux etages
//    1 et 2, une bretelle les relie au cote nord par l'interieur, comme en bas : 17 m de droite et un quart de cercle.
//  - Puis un tour par etage (24,9 m), quarts [palier, rampe, pleine pente, rampe] (rayon 17 m, 25 deg) : le palier suit
//    l'aiguillage de U et precede la convergence de D.
//  - Cote nord de l'anneau 0 a 42,49 m, sans relevement (utilisateur : « pourquoi tu centres pas la voie principale sur
//    le cote ouest ») : le point nord des helices reste a 18 m du cote nord des etages, et a 17 m des quarts de cercle
//    des bretelles.
//
// Repere des helices (origine 141339,-261512,349 ; u ouest ; v nord) ; etage f a z = 24,9 f.
'use strict';

const R = 17;
const G = Math.tan((25 * Math.PI) / 180);
const LQ = (Math.PI * R) / 2; // longueur d'un quart de tour
const ETAGE = 2 * LQ * G; // 24,9 m
const g = 0.4 * G; // pente du premier etage : 5 quarts de pente douce (rampes comprises) pour un etage
const RING_R = 18; // rayon des coins des anneaux et des bretelles
const QS_U = -24.718; // bout du virage du canyon (QS / QN), ou la voie sud entre dans l'anneau 0 du bas
const UE0 = QS_U + RING_R; // cote est de l'anneau 0
const EXTRA = 0; // cote nord de l'anneau 0 non releve
const NORTH = 6.491 + 2 * RING_R + EXTRA; // cote nord de l'anneau 0 (42,49), a tous les etages
const SOUTH = -2 * RING_R; // cote sud (-36)
const SIDE = 26; // deux rails de 13 m entre deux aiguillages
// droite des bretelles : a 13 m, le debut de leur quart de cercle (bloc de l'anneau) passait a 4,4 m du palier de
// l'helice aux etages ; a 17 m, il en est a 7 m (verification a blanc du 21/10/2026)
const LEG = 17;
// Ecart entre les deux helices (point est de U, point ouest de D) : 7 m depuis le 26/10/2026 (utilisateur : « on passe le
// standard a 7m », « occupe toi des helices ») ; a 6,5 m, les tetes des trains qui s'y croisent au meme niveau pouvaient
// toucher (seuil 6,74 m pour des helices de 17 m, references/rails.md « Collisions entre trains »). D a ete rapprochee du
// cote est (rail de 12,5 m au lieu de 13 apres le coin NE) : U, le cote ouest des anneaux et tout le reste n'ont pas bouge.
const GAP = 7;
const D_MRG = UE0 + RING_R + 13 - (GAP - 6.5); // en bas : convergence de D sur le cote nord, un rail de 12,5 m apres le coin NE
const D_LEG = D_MRG + RING_R; // point ouest de D (bas)
const U_LEG = D_LEG + GAP; // point est de U (bas)
const U_DIV = U_LEG + RING_R; // en bas : aiguillage vers U sur le cote nord
const DC = D_LEG - R, UC = U_LEG + R; // centres
const U_W = UC + R, D_E = DC - R; // point ouest de U, point est de D (etages)
const U_MRG = U_W - RING_R; // etages : convergence de U sur le cote nord
const D_DIV = D_E + RING_R; // etages : aiguillage vers D sur le cote nord
const UW = U_DIV + SIDE + RING_R; // cote ouest de l'anneau 0 (le coin NW est un aiguillage : sortie de la gare est 1)
const CV = NORTH - RING_R - LEG; // centre des helices en v (7,49)
const rad = (d) => (d * Math.PI) / 180;
const FIRST = [[0, g], [g, g], [g, g], [g, g], [g, g], [g, 0]]; // un tour et demi
const TURN = [[0, 0], [0, G], [G, G], [G, 0]]; // un tour
const QUARTS = FIRST.concat(TURN);
const FLOOR = { 1: FIRST.length, 2: QUARTS.length }; // numero du joint d'etage sur chaque helice

// du : decalage en u de la paire d'helices depuis l'anneau 0 (anneau A : utilisateur, 23/10/2026, balise « Helice » au
// centre de l'anneau A, « fais les helices » : meme montage que l'anneau 0, decale de son cote est a celui de l'anneau)
function geometry(du = 0) {
  const s = (x) => x + du;
  return {
    R, ETAGE, EXTRA, NORTH, SOUTH, UE0: s(UE0), UW: s(UW), CV, U_LEG: s(U_LEG), D_LEG: s(D_LEG), U_DIV: s(U_DIV),
    D_MRG: s(D_MRG), U_W: s(U_W), D_E: s(D_E), U_MRG: s(U_MRG), D_DIV: s(D_DIV), FLOOR,
    U: { u: s(UC), v: CV }, D: { u: s(DC), v: CV },
  };
}

// o.du : decalage (voir geometry) ; o.prefix : prefixe des joints, rails et signaux (vide pour l'anneau 0, 'A' pour
// l'anneau A : AU0..AU10, AUq1.., AsU5...)
function plan(o = {}) {
  const du = o.du || 0, p = o.prefix || '';
  const joints = {}, rails = [], signals = [];
  const sig = (id, type, r, end) => signals.push({ id, type, rail: r, end });
  // helice : joints k = 0..10, posee du bas vers le haut ; phi = angle dans le repere (u, v) ; s = +1 pose dans le sens
  // horaire de la carte (U), -1 dans l'autre (D, parcourue vers le bas)
  const helix = (key, c, phi0, s) => {
    let z = 0, phi = phi0;
    joints[key + 0] = [c.u + R * Math.cos(rad(phi)), c.v + R * Math.sin(rad(phi)), 0];
    QUARTS.forEach(([g0, g1], k) => {
      const next = phi + s * 90;
      z += (LQ * (g0 + g1)) / 2;
      joints[key + (k + 1)] = [c.u + R * Math.cos(rad(next)), c.v + R * Math.sin(rad(next)), z];
      rails.push({ id: key + 'q' + (k + 1), from: key + k, fromCap: phi + s * 90, fromGrade: g0, to: key + (k + 1), toCap: next + s * 90, toGrade: g1 });
      phi = next;
    });
  };
  helix(p + 'U', { u: UC + du, v: CV }, 180, 1); // depart au point est de U, cap sud
  helix(p + 'D', { u: DC + du, v: CV }, 0, -1); // arrivee au point ouest de D, cap nord (posee cap sud)
  // signaux de U : les trains montent dans le sens de la pose (sortie d'un rail par son bout 'to') ; la sortie de
  // l'anneau du bas est sur la bretelle (plan de l'anneau)
  sig(p + 'sU5', 'block', p + 'Uq5', 'to'); // entree de l'aiguillage de l'etage 1 (rampe Uq6, aiguillage U6, palier Uq7)
  sig(p + 'sU7', 'block', p + 'Uq7', 'to'); // sortie de l'aiguillage, vers le haut
  // signaux de D : les trains descendent ; sur l'helice, sortie d'un rail par son bout 'from'
  sig(p + 'sD7', 'path', p + 'Dq8', 'from'); // entree de la convergence de l'etage 1 (palier Dq7)
  sig(p + 'sD6', 'block', p + 'Dq7', 'from'); // sortie de la convergence, au point de convergence D6
  return { joints, rails, signals, signalsLeftHanded: true };
}

module.exports = (o) => plan(o);
module.exports.geometry = geometry;
