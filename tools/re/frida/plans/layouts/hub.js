// Gare de triage en anneaux, un etage (utilisateur, 21/10/2026 : « l'utilisation des anneaux est validee donc on peut
// defaire l'etage du bas et etage 1, on refait etage 2 en supprimant la portion droite a la sortie de l'helice et en
// inscrivant les 2 helices dans l'anneau 0 » ; « ok avec le plan » ; variante 2 des helices retenue). Les helices :
// hub-helices.js, posees avec l'etage du bas (rails Uq*, Dq* de ce plan a l'etage 0, existants aux etages 1 et 2).
//
// Suite d'est en ouest, a chaque etage : anneau 0 (helices a l'interieur, ligne externe au sud) - paire 1 - anneau A
// (ligne externe au sud) - paire 2 - anneau Z - voies vers l'ouest (bouts libres).
// Anneau (modele anneaux.js) : sens horaire vu du dessus, de niveau, un seul bloc de chemin ; raccords par l'exterieur,
// aiguillage puis convergence, virages a gauche ; voies principales en quarts de cercle de 18 m aux cotes est et ouest ;
// gares aux coins, dans l'alignement des cotes nord et sud ; ligne externe au sud.
// Anneau 0 : les helices sont a l'interieur ; a tous les etages, elles s'accrochent par l'interieur sur le cote nord
// (utilisateur : « le raccord aux helices est au nord a tous les etages comme en bas ») : en bas par la double voie
// entre elles (aiguillage vers la montante, puis convergence de la descendante), aux etages par leurs cotes exterieurs
// (convergence de la montante, puis aiguillage vers la descendante). Deux lignes externes (« les anneaux 0 peuvent
// supporter 2 lignes externes est & sud ») : au sud a tous les etages, a 13 m du coin SE (26 m avant le coin SW, d'ou
// part la gare ouest 1) ; a l'est, la double voie du canyon en bas et une ligne externe aux etages, depuis le bout du
// coin NE, vers l'est puis le sud (circulation a gauche, sans croisement). Voies principales centrees sur les cotes est
// et ouest (cotes nord a 42,49 m). Pas de gare a l'est de l'anneau 0.
//
// Repere des helices (origine 141339,-261512,349 ; u ouest ; v nord) ; voie sud v 0.
// node railplan.js layouts/hub.js check|build --origin 141339,-261512,349 --axis 180 --nom hub<etage> --etage 0|1|2 [--ebauche oui]
//   [--ouest <u en m>] : etage bas, voies vers l'ouest prolongees en droite jusqu'a u (rails XS*, XN*)
//   [--colonne <v en m>] : avec --ouest, suite vers le sud au-dessus de la colonne de fondations jusqu'a v (XSt*, XSs*, XSc*...)
//   [--rangee <u en m>] : avec --colonne, suite vers l'ouest au-dessus des rangees du bord sud de la plateforme (XSu*, XSw*...)
'use strict';

const fs = require('fs');
const path = require('path');
const helices = require('./hub-helices.js');

const PLANS = path.join(__dirname, '..') + '/'; // etats des poses (plans/<nom>-state.json)
const H = { x: 141339, y: -261512, z: 349 };
const HG = helices.geometry();
const R = 18; // rayon des coins et des quarts de cercle des raccords
const QUAIS = 16 * 5; // gare + 4 quais
const PAIR = 117.05; // du cote ouest d'un anneau au cote est du suivant : voie principale de 81 m entre anneaux
const ENT = 6; // entree d'une gare a 6 m du cote de l'anneau
const XSTUB = PAIR - QUAIS - ENT; // sortie d'une gare jusqu'a son signal, sur le cote de l'anneau
const SIDE = 26; // deux rails de 13 m entre deux aiguillages
const EXT = 2 * R + 6.5; // ligne externe : du depart a l'arrivee (deux quarts de cercle, voies a 6,5 m)
const MAIN = PAIR - 2 * R; // voie principale entre deux anneaux (81 m)
const TAIL = MAIN; // voies vers l'ouest apres le dernier anneau
const rad = (d) => (d * Math.PI) / 180;

function layout(o = {}) {
  const etage = Number(o.etage || 0);
  const VN = 6.491; // voie nord
  const EXTRA = HG.EXTRA; // cote nord des anneaux releve, a tous les etages (ecart des helices de l'anneau 0)
  const VNR = VN + 2 * R + EXTRA, VSR = -2 * R; // cotes nord et sud des anneaux
  const rings = [
    { id: 'R0', ue: HG.UE0, uw: HG.UW, slot: true, xoff: 13, helices: true },
    { id: 'RA', slot: true },
    { id: 'RZ', slot: false },
  ];
  for (let i = 1; i < rings.length; i++) {
    rings[i].ue = rings[i - 1].uw + PAIR;
    rings[i].uw = rings[i].ue + 2 * R + (rings[i].slot ? 2 * SIDE + EXT : SIDE);
  }
  const prefix = 'hub' + etage;
  const stations = {};
  for (let k = 1; k < rings.length; k++) {
    stations['est' + k] = { nom: prefix + '-est' + k, exit: rings[k - 1].uw + XSTUB, v: VNR, axis: 180 };
    stations['ouest' + k] = { nom: prefix + '-ouest' + k, exit: rings[k].ue - XSTUB, v: VSR, axis: 0 };
  }
  const z = H.z + 100 * etage * HG.ETAGE;
  for (const st of Object.values(stations)) st.origin = { x: H.x - 100 * st.exit, y: H.y - 100 * st.v, z };
  return { etage, Z: etage * HG.ETAGE, VN, VNR, VSR, EXTRA, rings, stations };
}

function plan(o) {
  const L = layout(o);
  const { VN, VNR, VSR, EXTRA } = L;
  const RINGS = L.rings;
  const joints = {}, rails = [], signals = [];
  const J = (name, u, v) => { joints[name] = [u, v, L.Z]; return name; };
  const rail = (id, from, fromCap, to, toCap, extra) => rails.push(Object.assign({ id, from, fromCap, to, toCap }, extra || {}));
  const sig = (id, type, r, end) => signals.push({ id, type, rail: r, end });
  // droite de `a` a `b` (cap c) en rails d'au plus 60 m, au moins `min` (2 entre deux aiguillages)
  const straight = (id, a, b, c, min = 2) => {
    const [ua, va] = joints[a], [ub, vb] = joints[b];
    const n = Math.max(min, Math.ceil(Math.hypot(ub - ua, vb - va) / 60));
    let prev = a;
    for (let i = 1; i <= n; i++) {
      const j = i === n ? b : J(id + 'j' + i, ua + ((ub - ua) * i) / n, va + ((vb - va) * i) / n);
      rail(id + (n > 1 ? i : ''), prev, c, j, c);
      prev = j;
    }
  };
  // quart de cercle en deux rails : 50 deg puis 40 deg (milieu sur un cap multiple de 10)
  const corner = (id, a, capA, center, ang0, b, capB) => {
    const ang = ang0 + 50;
    J(id + 'm', center[0] + R * Math.cos(rad(ang)), center[1] + R * Math.sin(rad(ang)));
    rail(id + '1', a, capA, id + 'm', capA + (capB - capA > 0 ? 50 : -50));
    rail(id + '2', id + 'm', capA + (capB - capA > 0 ? 50 : -50), b, capB);
  };
  // quart de cercle de rayon R en deux rails (split deg puis le reste) depuis `a`, cap c ; t = +1 : cap croissant (virage
  // a droite sur la carte)
  const quarter = (id, a, c, t, b, split = 50) => {
    const [ua, va] = joints[a];
    const cu = ua + R * Math.cos(rad(c + 90 * t)), cv = va + R * Math.sin(rad(c + 90 * t));
    const m = c + split * t;
    J(id + 'm', cu - R * Math.cos(rad(m + 90 * t)), cv - R * Math.sin(rad(m + 90 * t)));
    rail(id + '1', a, c, id + 'm', m); rail(id + '2', id + 'm', m, b, c + 90 * t);
  };
  const helState = fs.existsSync(PLANS + 'hub0-state.json') ? JSON.parse(fs.readFileSync(PLANS + 'hub0-state.json', 'utf8')).rails : {};
  const hel = (id) => {
    if (!helState[id] && !o.ebauche) throw new Error('helice : rail ' + id + ' pas construit (hub0)');
    return helState[id] ? { existing: helState[id] } : null;
  };
  const oldHel = JSON.parse(fs.readFileSync(PLANS + 'helices-state.json', 'utf8')).rails;
  const st = L.stations;
  const trackOf = (key) => {
    const file = PLANS + st[key].nom + '-state.json';
    const tracks = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).integrated : null;
    if (!o.ebauche && (!tracks || tracks.length !== 5)) throw new Error('gare ' + st[key].nom + ' : 5 voies integrees attendues');
    return tracks;
  };
  const HEL = helices(), HJ = HEL.joints;
  // helices : posees avec l'etage du bas
  if (L.etage === 0) { Object.assign(joints, HJ); rails.push(...HEL.rails); signals.push(...HEL.signals); }

  for (const r of RINGS) {
    const { id, ue, uw } = r;
    const n = (x) => id + x;
    J(n('NW'), uw - R, VNR); J(n('NE'), ue + R, VNR); J(n('E0'), ue, VN + R); J(n('E1'), ue, -R);
    const NEc = EXTRA ? J(n('NEc'), ue, VNR - R) : n('E0'); // bout du coin NE
    J(n('SE'), ue + R, VSR); J(n('SW'), uw - R, VSR); J(n('W0'), uw, -R); J(n('W1'), uw, VN + R);
    // cote nord (vers l'est)
    if (r.helices && L.etage === 0) {
      // bretelles des helices vers l'interieur : aiguillage vers U en UDV (quart de cercle a droite, 13 m de droite
      // jusqu'au depart de U), puis convergence de D en DMG (13 m de droite depuis l'arrivee de D, quart de cercle)
      J(n('UDV'), HG.U_DIV, VNR); J(n('DMG'), HG.D_MRG, VNR); J(n('Ubq'), HG.U_LEG, VNR - R); J(n('Dbq'), HG.D_LEG, VNR - R);
      quarter(n('Ub'), n('UDV'), 180, 1, n('Ubq')); sig(n('xUb'), 'block', n('Ub2'), 'to'); // sortie de l'anneau vers U
      rail(n('Ubd'), n('Ubq'), 270, 'U0', 270);
      rail(n('Dbd'), 'D0', 90, n('Dbq'), 90); sig(n('eDb'), 'path', n('Dbd'), 'to'); // entree de l'anneau depuis D
      quarter(n('Db'), n('Dbq'), 90, 1, n('DMG'));
      straight(n('nA'), n('NW'), n('UDV'), 180); straight(n('nB'), n('UDV'), n('DMG'), 180); straight(n('nC'), n('DMG'), n('NE'), 180, 1);
    } else if (r.helices) {
      // etages : bretelles des cotes exterieurs des helices ; convergence de U en UMG (13 m de droite depuis le point
      // ouest de U, quart de cercle), puis aiguillage vers D en DDV (quart de cercle, 13 m jusqu'au point est de D)
      const kU = 'U' + HG.FLOOR[L.etage], kD = 'D' + HG.FLOOR[L.etage];
      for (const hr of HEL.rails.filter((x) => [kU, kD].includes(x.from) || [kU, kD].includes(x.to))) {
        const e = hel(hr.id);
        if (!e) continue;
        joints[hr.from] = HJ[hr.from]; joints[hr.to] = HJ[hr.to];
        rails.push(Object.assign({}, hr, e));
      }
      joints[kU] = HJ[kU]; joints[kD] = HJ[kD];
      J(n('UMG'), HG.U_MRG, VNR); J(n('DDV'), HG.D_DIV, VNR); J(n('Ufq'), HG.U_W, VNR - R); J(n('Dfq'), HG.D_E, VNR - R);
      rail(n('Uf'), kU, 90, n('Ufq'), 90); sig(n('eUf'), 'path', n('Uf'), 'to'); // entree de l'anneau depuis U
      quarter(n('Ug'), n('Ufq'), 90, 1, n('UMG'), 40); // milieu a 6,4 m du joint du cote nord (a 50 deg : 4,9 m)
      quarter(n('Dg'), n('DDV'), 180, 1, n('Dfq'));
      // sortie de l'anneau vers D : entree de la convergence a l'etage 1 (chemin), debut de la descente en haut (bloc)
      sig(n('xDg'), L.etage === 1 ? 'path' : 'block', n('Dg2'), 'to');
      rail(n('Df'), n('Dfq'), 270, kD, 270);
      straight(n('nA'), n('NW'), n('UMG'), 180); straight(n('nB'), n('UMG'), n('DDV'), 180); straight(n('nC'), n('DDV'), n('NE'), 180, 1);
    } else {
      straight(n('n'), n('NW'), n('NE'), 180);
    }
    // coin NE puis cote est ; aux etages, 13 m de droite entre la fin du coin et la voie nord (E0)
    corner(n('ne'), n('NE'), 180, [ue + R, VNR - R], 90, NEc, 270);
    if (r.helices && L.etage > 0) {
      // ligne externe des etages sur le cote est (vers le sud) : depart au bout du coin NE, quart de cercle a gauche vers
      // l'est, 18,5 m de droite, quart de cercle a droite vers le sud, 40 m ; retour 6,5 m plus a l'ouest : 40 m vers le
      // nord, quart de cercle a gauche vers l'ouest, 12 m de droite, quart de cercle a gauche, convergence en YI (sans
      // cote nord releve : au debut du coin SE, et les deux voies dans l'alignement des voies principales)
      const vy = joints[NEc][1];
      const YI = EXTRA ? J(n('YI'), ue, vy - EXT) : n('E1');
      const vin = joints[YI][1] + R; // voie d'arrivee
      if (EXTRA) { straight(n('ey'), NEc, YI, 270); straight(n('ez'), YI, n('E1'), 270, 1); } else straight(n('e'), NEc, YI, 270);
      J(n('YOL'), ue - R, vy - R); J(n('YOS'), ue - R - 18.5, vy - R); J(n('YOT'), ue - 2 * R - 18.5, vy - 2 * R); J(n('YOE'), ue - 2 * R - 18.5, vy - 2 * R - 40);
      J(n('YIq'), ue - R, vin); J(n('YIS'), ue - R - 12, vin); J(n('YIL'), ue - 2 * R - 12, vin - R); J(n('YIE'), ue - 2 * R - 12, vin - R - 40);
      quarter(n('Yo'), NEc, 270, -1, n('YOL')); sig(n('xYo'), 'block', n('Yo2'), 'to'); // sortie de l'anneau
      rail(n('Yod'), n('YOL'), 180, n('YOS'), 180); quarter(n('Yoq'), n('YOS'), 180, 1, n('YOT')); rail(n('Yos'), n('YOT'), 270, n('YOE'), 270);
      rail(n('Yis'), n('YIE'), 90, n('YIL'), 90); quarter(n('Yiq'), n('YIL'), 90, -1, n('YIS'));
      rail(n('Yid'), n('YIS'), 0, n('YIq'), 0); sig(n('eYi'), 'path', n('Yid'), 'to'); // entree de l'anneau
      quarter(n('Yi'), n('YIq'), 0, -1, YI);
    } else {
      if (EXTRA) straight(n('ex'), NEc, n('E0'), 270, 1);
      straight(n('e'), n('E0'), n('E1'), 270);
    }
    corner(n('se'), n('E1'), 270, [ue + R, -R], 180, n('SE'), 360);
    // cote sud (vers l'ouest), avec ou sans ligne externe
    if (r.slot) {
      // depart de la ligne externe a xoff (ou SIDE) du bout du coin SE ; un seul rail si le coin SE n'est pas un aiguillage
      const xo = ue + R + (r.seFree ? 0 : r.xoff || SIDE), xi = xo + EXT;
      const XO = r.seFree ? n('SE') : J(n('XO'), xo, VSR);
      J(n('XI'), xi, VSR);
      if (!r.seFree) straight(n('sa'), n('SE'), XO, 0, r.xoff ? 1 : 2);
      straight(n('sb'), XO, n('XI'), 0); straight(n('sc'), n('XI'), n('SW'), 0);
      J(n('XOL'), xo + R, VSR - R); J(n('XOE'), xo + R, VSR - R - 40);
      J(n('XIL'), xi - R, VSR - R); J(n('XIE'), xi - R, VSR - R - 40);
      rail(n('Xo'), XO, 0, n('XOL'), 270); rail(n('Xos'), n('XOL'), 270, n('XOE'), 270);
      rail(n('Xis'), n('XIE'), 90, n('XIL'), 90); rail(n('Xi'), n('XIL'), 90, n('XI'), 0);
      sig(n('xXo'), 'block', n('Xo'), 'to'); sig(n('eXi'), 'path', n('Xis'), 'to');
    } else {
      straight(n('s'), n('SE'), n('SW'), 0);
    }
    corner(n('sw'), n('SW'), 0, [uw - R, -R], 270, n('W0'), 90);
    straight(n('w'), n('W0'), n('W1'), 90);
    const W1c = EXTRA ? J(n('W1c'), uw, VNR - R) : n('W1');
    if (EXTRA) straight(n('wx'), n('W1'), W1c, 90, 1);
    corner(n('nw'), W1c, 90, [uw - R, VNR - R], 0, n('NW'), 180);
    // voies principales : quarts de cercle cote est (sauf l'anneau 0 en etage) et cote ouest
    if (id !== 'R0' || L.etage === 0) {
      J(n('NO'), ue - R, VN); J(n('SI'), ue - R, 0);
      rail(n('No'), n('E0'), 270, n('NO'), 180); sig(n('xNo'), 'block', n('No'), 'to'); // vers l'est
      rail(n('Si'), n('SI'), 0, n('E1'), 270); // depuis l'est
    }
    J(n('SO'), uw + R, 0); J(n('NI'), uw + R, VN);
    rail(n('So'), n('W0'), 90, n('SO'), 0); sig(n('xSo'), 'block', n('So'), 'to'); // vers l'ouest
    rail(n('Ni'), n('NI'), 180, n('W1'), 90); // depuis l'ouest
  }

  // --- Canyon (etage du bas) : la double voie arrive au cote est de l'anneau 0, au bout de son virage --------------------
  if (L.etage === 0) {
    joints.KS = [...localXY(KEEP.S.b), 0]; joints.KN = [...localXY(KEEP.N.b), 0];
    rail('virageS', 'KS', 20, 'R0SI', 0, { existing: oldHel.virageS });
    rail('virageN', 'KN', 20, 'R0NO', 0, { existing: oldHel.virageN });
    sig('eR0Si', 'path', 'virageS', 'to'); // entree de l'anneau 0 par la voie sud
  }
  // --- Voies principales entre anneaux et vers l'ouest -----------------------------------------------------------------
  for (let k = 1; k < RINGS.length; k++) {
    const a = RINGS[k - 1].id, b = RINGS[k].id;
    rail('MS' + k, a + 'SO', 0, b + 'SI', 0); sig('e' + b + 'Si', 'path', 'MS' + k, 'to');
    rail('MN' + k, b + 'NO', 180, a + 'NI', 180); sig('e' + a + 'Ni', 'path', 'MN' + k, 'to');
  }
  const z = RINGS[RINGS.length - 1];
  J('SEND', z.uw + R + TAIL, 0); J('NEND', z.uw + R + TAIL, VN);
  rail('MS' + RINGS.length, z.id + 'SO', 0, 'SEND', 0);
  rail('MN' + RINGS.length, 'NEND', 180, z.id + 'NI', 180); sig('e' + z.id + 'Ni', 'path', 'MN' + RINGS.length, 'to');
  // Prolongement de l'etage bas vers l'ouest jusqu'a u = --ouest (m), en droite, bouts libres (utilisateur, 21/10/2026 :
  // « t'as juste a prolonger l'etage bas »). Les deux voies partent des bouts existants SEND / NEND. Pose : --ouest 2160.
  if (o.ouest && L.etage === 0) {
    J('SEND2', Number(o.ouest), 0); J('NEND2', Number(o.ouest), VN);
    straight('XS', 'SEND', 'SEND2', 0);
    straight('XN', 'NEND', 'NEND2', 0);
  }
  // Suite vers le sud au-dessus de la colonne de fondations 8x1 posee par l'utilisateur a -17 m (centree en x -75 502, soit
  // u 2168,41 ; relevee en jeu le 21/10/2026), variante 1 retenue : quart de cercle de 18 m au bout des voies, S de deux
  // arcs de 10 deg qui ramene la double voie au-dessus de la colonne, droite vers le sud jusqu'a v = --colonne (m)
  if (o.ouest && o.colonne && L.etage === 0) {
    const UCOL = 2168.41, HALF = VN / 2, RI = 18, ue = Number(o.ouest), vc = -RI;
    const d = ue + RI - (UCOL - HALF); // decalage vers l'est (-u) apres le quart de cercle
    const Rs = d / (2 * (1 - Math.cos(rad(10)))), Ls = 2 * Rs * Math.sin(rad(10));
    for (const [k, from, Rr] of [['XS', 'SEND2', RI], ['XN', 'NEND2', RI + VN]]) {
      J(k + 'tm', ue + Rr * Math.sin(rad(50)), vc + Rr * Math.cos(rad(50)));
      J(k + 'te', ue + Rr, vc);
      rail(k + 't1', from, 0, k + 'tm', -50); rail(k + 't2', k + 'tm', -50, k + 'te', -90);
      J(k + 'sm', ue + Rr - d / 2, vc - Ls / 2); J(k + 'se', ue + Rr - d, vc - Ls);
      rail(k + 's1', k + 'te', -90, k + 'sm', -100); rail(k + 's2', k + 'sm', -100, k + 'se', -90);
      J(k + 'end', ue + Rr - d, Number(o.colonne));
      straight(k + 'c', k + 'se', k + 'end', -90);
    }
  }
  // Puis vers l'ouest au-dessus de la rangee de fondations du bord sud de la plateforme (relevee en jeu le 21/10/2026, -17 m,
  // centree en y -207 545 = v -539,67, jusqu'a x -190 702), et dans son alignement au-dela, sans suivre le decalage de 8 m
  // vers le nord de la rangee suivante (utilisateur : « evite le decrochage comme sur les fondations »). Quart de cercle a
  // droite au bout de la colonne (voie nord a l'interieur, sans droite avant : rayon impose par l'ecart au cote de la
  // rangee), droite jusqu'a u = --rangee (m). Les rails w s'arretent en u 3281,73 (pose du 21/10), les rails v continuent.
  if (o.ouest && o.colonne && o.rangee && L.etage === 0) {
    const HALF = VN / 2, V1 = -539.67, vt = Number(o.colonne);
    const uN = joints.XNend[0], RI = vt - (V1 + HALF), cu = uN + RI; // voie nord : de la colonne a V1 + HALF
    const us = 3281.73; // fin des rails w poses
    for (const [k, Rr, vw] of [['XN', RI, V1 + HALF], ['XS', RI + VN, V1 - HALF]]) {
      J(k + 'um', cu - Rr * Math.cos(rad(50)), vt - Rr * Math.sin(rad(50)));
      J(k + 'ue', cu, vw);
      rail(k + 'u1', k + 'end', -90, k + 'um', -40); rail(k + 'u2', k + 'um', -40, k + 'ue', 0);
      J(k + 'zs', us, vw);
      straight(k + 'w', k + 'ue', k + 'zs', 0);
      J(k + 'vend', Number(o.rangee), vw);
      straight(k + 'v', k + 'zs', k + 'vend', 0);
    }
  }

  // --- Paires de gares -------------------------------------------------------------------------------------------------
  for (let k = 1; k < RINGS.length; k++) {
    const a = RINGS[k - 1], b = RINGS[k];
    const E = st['est' + k], W = st['ouest' + k];
    for (const [key, s, dir] of [['E' + k, E, 1], ['W' + k, W, -1]]) {
      const tracks = trackOf(key[0] === 'E' ? 'est' + k : 'ouest' + k);
      for (let i = 0; i <= 5; i++) J(key + 'G' + i, s.exit + dir * 16 * i, s.v);
      for (let i = 0; i < 5; i++) {
        rail('gare' + key + i, key + 'G' + i, dir > 0 ? 0 : 180, key + 'G' + (i + 1), dir > 0 ? 0 : 180, tracks ? { existing: tracks[i] } : {});
      }
    }
    // gare est k (cote nord) : sortie vers l'est, signal de chemin sur le cote ouest de l'anneau a, puis son coin NW
    J('XE' + k, a.uw, VNR);
    rail('Eo' + k, 'E' + k + 'G0', 180, 'XE' + k, 180); sig('eEo' + k, 'path', 'Eo' + k, 'to');
    rail('Eon' + k, 'XE' + k, 180, a.id + 'NW', 180);
    // entree depuis le coin NE de l'anneau b (signal de bloc a l'entree de la gare)
    rail('Ein' + k, b.id + 'NE', 180, 'E' + k + 'G5', 180); sig('xEi' + k, 'block', 'Ein' + k, 'to');
    // gare ouest k (cote sud) : entree depuis le coin SW de l'anneau a
    rail('Win' + k, a.id + 'SW', 0, 'W' + k + 'G5', 0); sig('xWi' + k, 'block', 'Win' + k, 'to');
    // sortie vers l'ouest, signal de chemin sur le cote est de l'anneau b, puis son coin SE
    J('XW' + k, b.ue, VSR);
    rail('Wo' + k, 'W' + k + 'G0', 0, 'XW' + k, 0); sig('eWo' + k, 'path', 'Wo' + k, 'to');
    rail('Won' + k, 'XW' + k, 0, b.id + 'SE', 0);
  }
  return { joints, rails, signals, signalsLeftHanded: true, positions: { RINGS, stations: st } };
}

// Bouts des droites gardees du raccord au canyon (lus en jeu le 21/10/2026, cf. helices-etages.js) : fin des rails
// canyonN / canyonS, debut des virages
const KEEP = { N: { b: { x: 147231, y: -261558 } }, S: { b: { x: 147009, y: -260948 } } };
function localXY(p) { return [-(p.x - H.x) / 100, -(p.y - H.y) / 100]; }

module.exports = (o = {}) => plan(o);
module.exports.layout = layout;
