// Anneau sur la voie basse (partie est-ouest, voies a y -207 220 et -207 870), centre sur une abscisse donnee, avec un depart
// de ligne au sud (utilisateur, 22/10/2026 : « un anneau ferroviaire sur la voie basse centre sur moi », « depart de ligne
// au sud »). Modele des anneaux de la gare de triage (layouts/hub.js, anneaux 0 et A) : sens horaire vu du dessus, de
// niveau, un seul bloc de chemin (signaux de chemin aux entrees, de bloc aux sorties) ; coins et raccords en quarts de
// cercle de 18 m ; la voie basse entre et sort par les cotes est et ouest (circulation a gauche : voie sud vers l'ouest,
// voie nord vers l'est) ; ligne externe au sud : aiguillage de depart puis convergence d'arrivee, par l'exterieur, double
// voie vers le sud terminee par des bouts libres a 40 m.
//
// Repere : origine sur la voie sud a l'abscisse du centre (cx ; -207 220 ; 349), axe 180 (u vers l'ouest, v vers le nord) ;
// voie sud v 0, voie nord v 6,5. Les rails de la voie basse sous l'anneau sont retires avant la pose ; l'anneau s'accroche
// aux rails gardes de part et d'autre, decrits par --keep (JSON prepare par anneau-ici.js : pour ES, EN, WS, WN, le chemin
// du rail garde, son bout cote anneau et son autre bout en {x, y} monde).
// Autre repere (ligne ouest, 24/10/2026) : origine sur la voie qui va dans le sens +u, au centre, axe quelconque ; axe 0
// sur une voie est-ouest = ligne externe au NORD (le modele tourne de 180 deg est identique : anneau symetrique). Un cote
// sans rails gardes (ES/EN ou WS/WN absents) laisse ses raccords libres, sans signaux (ligne a prolonger).
// keep.Y (embranchement d'une gare en boucle de retournement, ex. Lund) : { path, near: {x,y,z}, far: {x,y} } = rail
// existant cote gare au point P, dans l'axe u (vers +u) ; la ligne externe descend jusqu'a P en deux quarts de cercle qui
// s'y rejoignent (depart : rayon Pu + 3,25 ; arrivee : Pu - 3,25, au moins 18 m), sans croisement. Rails touchant P : Yd2,
// Ya1 (a poser quand P est libere de son autre voie).
//
// node railplan.js layouts/anneau-voie-basse.js check|build --origin <cx>,-207220,349 --axis 180 --nom <nom> --keep '<json>'
//   --keep accepte aussi le chemin d'un fichier JSON (plans/<fichier>.json)
'use strict';

const fs = require('fs');
const path = require('path');
const R = 18; // rayon des coins et des raccords
const VN = 6.5; // voie nord
const EXT = 2 * R + VN; // ligne externe : du depart a l'arrivee (deux quarts de cercle, voies a 6,5 m)
const ENT = 6; // entree d'une gare a 6 m du cote de l'anneau (gare de triage, hub.js)
// Largeur de l'anneau 0 de la gare de triage, qui loge les deux helices (utilisateur : « fais-le assez long pour
// eventuellement accueillir des helices ») : lue dans la geometrie des helices, pas recopiee
const HG = require('./hub-helices.js').geometry();
const W = HG.UW - HG.UE0; // 117,5 m du cote est au cote ouest
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
const LEVEL = '/Game/FactoryGame/Map/GameLevel01/Persistent_Level.Persistent_Level:PersistentLevel.';

function plan(o) {
  const [ox, oy, oz] = String(o.origin || '').split(',').map(Number);
  if (!Number.isFinite(ox) || !o.keep) throw new Error('--origin <cx>,-207220,349 et --keep <json> requis (voir anneau-ici.js)');
  const keep = typeof o.keep !== 'string' ? o.keep
    : o.keep.trim().startsWith('{') ? JSON.parse(o.keep) : JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', o.keep), 'utf8'));
  // monde -> repere (m) ; axe 180 : u = (cx - x) / 100, v = (y0 - y) / 100
  const ax = rad(o.axis != null ? Number(o.axis) : 180);
  const loc = (p) => {
    const dx = (p.x - ox) / 100, dy = (p.y - oy) / 100;
    return [dx * Math.cos(ax) + dy * Math.sin(ax), -dx * Math.sin(ax) + dy * Math.cos(ax)];
  };
  const joints = {}, rails = [], signals = [];
  const J = (name, uu, vv, zz = 0) => { joints[name] = [uu, vv, zz]; return name; };
  const rail = (id, from, fromCap, to, toCap, extra) => rails.push(Object.assign({ id, from, fromCap, to, toCap }, extra || {}));
  const sig = (id, type, r, end) => signals.push({ id, type, rail: r, end });
  const straight = (id, a, b, c, min = 2) => {
    const [ua, va] = joints[a], [ub, vb] = joints[b];
    const n = Math.max(min, Math.ceil(Math.hypot(ub - ua, vb - va) / 60));
    let prev = a;
    for (let i = 1; i <= n; i++) {
      const j = i === n ? b : J(id + 'j' + i, ua + ((ub - ua) * i) / n, va + ((vb - va) * i) / n);
      rail(id + (n > 1 ? i : ''), prev, c, j, c);
      prev = j;
    }
    return id + (n > 1 ? n : ''); // dernier rail (arrivee en b)
  };
  // quart de cercle en deux rails : 50 deg puis 40 deg (milieu sur un cap multiple de 10)
  const corner = (id, a, capA, center, ang0, b, capB) => {
    const ang = ang0 + 50;
    J(id + 'm', center[0] + R * Math.cos(rad(ang)), center[1] + R * Math.sin(rad(ang)));
    rail(id + '1', a, capA, id + 'm', capA + (capB - capA > 0 ? 50 : -50));
    rail(id + '2', id + 'm', capA + (capB - capA > 0 ? 50 : -50), b, capB);
  };
  const ue = -W / 2, uw = W / 2;
  const VNR = VN + 2 * R, VSR = -2 * R; // cotes nord et sud
  J('NW', uw - R, VNR); J('NE', ue + R, VNR); J('E0', ue, VN + R); J('E1', ue, -R);
  J('SE', ue + R, VSR); J('SW', uw - R, VSR); J('W0', uw, -R); J('W1', uw, VN + R);
  straight('n', 'NW', 'NE', 180);
  corner('ne', 'NE', 180, [ue + R, VNR - R], 90, 'E0', 270);
  // cote est en deux rails (aiguillage en E0, convergence en E1 : jamais un seul rail entre deux aiguillages), joint a v 10
  // et non au milieu : au milieu, il tombait a l'aplomb du cable electrique de la rangee de fondations sous la voie (-17 m)
  // et le jeu refusait le rail (check du 22/10/2026). Meme chose a l'ouest.
  J('ej', ue, 10); rail('e1', 'E0', 270, 'ej', 270); rail('e2', 'ej', 270, 'E1', 270);
  corner('se', 'E1', 270, [ue + R, -R], 180, 'SE', 360);
  // ligne externe au milieu du cote sud (ses deux voies de part et d'autre de u 0) ; un seul rail de chaque cote entre le
  // coin et l'aiguillage (le coin n'est pas un aiguillage), deux rails entre depart et arrivee (deux aiguillages)
  const xo = -R - VN / 2, xi = xo + EXT;
  J('XO', xo, VSR); J('XI', xi, VSR);
  straight('sa', 'SE', 'XO', 0, 1); straight('sb', 'XO', 'XI', 0); straight('sc', 'XI', 'SW', 0, 1);
  J('XOL', xo + R, VSR - R); J('XIL', xi - R, VSR - R);
  rail('Xo', 'XO', 0, 'XOL', 270); rail('Xi', 'XIL', 90, 'XI', 0);
  if (keep.Y) {
    // embranchement de gare en P : amorces droites puis quarts de cercle qui se rejoignent en P (cap +u), pente reguliere
    // de l'anneau a P (0 au bord de l'anneau et en P ; les raccords de pente prennent la moitie de leur rail)
    // s = +1 : gare vers +u depuis P (P au-dela de l'arrivee) ; s = -1 : symetrique, gare vers -u (P avant le depart)
    const g = keep.Y, [pu, pv] = loc(g.near), pz = (g.near.z - oz) / 100, [fu, fv] = loc(g.far), s = pu > 0 ? 1 : -1;
    const rd = s * (pu - (xo + R)), ra = s * (pu - (xi - R)); // rayons des quarts de depart et d'arrivee
    if (Math.abs(fv - pv) > 0.5 || s * (fu - pu) <= 0 || Math.min(rd, ra) < R - 0.01) throw new Error('Y : P doit etre sur un rail dans l\'axe u, oriente vers la gare, a |u| >= ' + (xi - R + R).toFixed(2) + ' (u = ' + pu.toFixed(2) + ')');
    const lsd = VSR - R - (pv + rd), lsa = VSR - R - (pv + ra); // amorces droites jusqu'aux quarts
    if (lsd < 12 || lsa < 12) throw new Error('Y : P trop pres de l\'anneau (amorces ' + lsd.toFixed(1) + ' / ' + lsa.toFixed(1) + ' m)');
    const L = (r, d) => (r * d * Math.PI) / 180;
    // coupures des quarts (bouts libres en attendant Yd2 / Ya1) : quart interieur (18 m) a 40 deg de P, exterieur a 50 deg,
    // soit 8,5 m entre les deux bouts libres et des rails de 12,6 m au moins (le jeu refuse sous 12 m : FGCDTrackTooShort) ;
    // a 40 et 50 deg en sens inverse, les bouts tombaient a 2 m et le jeu y accrochait Ya2 (FGCDTrackTrunToSharp,
    // 24/10/2026). Depart exterieur si s = +1, interieur si s = -1.
    const dP = s > 0 ? 50 : 40, aP = s > 0 ? 40 : 50; // coupures du depart et de l'arrivee, en deg depuis P
    const gd = pz / (lsd / 2 + L(rd, 90 - dP) + L(rd, dP) / 2), ga = -pz / (L(ra, aP) / 2 + L(ra, 90 - aP) + lsa / 2);
    const toGare = s > 0 ? 0 : 180; // cap de P vers la gare
    J('Y', pu, pv, pz); J('Yf', fu, fv, pz);
    rail('kY', 'Y', toGare, 'Yf', toGare, { existing: LEVEL + g.path });
    // depart : XOE (cap 270) -> P (cap vers la gare), centre (pu, pv + rd), coupe a th = 90 - dP deg de XOE
    const th = 90 - dP;
    J('XOE', xo + R, pv + rd, (gd * lsd) / 2);
    J('Ydm', pu - s * rd * Math.cos(rad(th)), pv + rd - rd * Math.sin(rad(th)), gd * (lsd / 2 + L(rd, th)));
    rail('Xos', 'XOL', 270, 'XOE', 270, { fromGrade: 0, toGrade: gd });
    rail('Yd1', 'XOE', 270, 'Ydm', 270 + th * s, { fromGrade: gd, toGrade: gd });
    rail('Yd2', 'Ydm', 270 + th * s, 'Y', toGare, { fromGrade: gd, toGrade: 0 });
    // arrivee : P (dos a la gare) -> XIE (cap 90), centre (pu, pv + ra), coupee a aP deg de P
    J('Yam', pu - s * ra * Math.sin(rad(aP)), pv + ra - ra * Math.cos(rad(aP)), pz + (ga * L(ra, aP)) / 2);
    J('XIE', xi - R, pv + ra, pz + ga * (L(ra, aP) / 2 + L(ra, 90 - aP)));
    rail('Ya1', 'Y', toGare + 180, 'Yam', toGare + 180 - aP * s, { fromGrade: 0, toGrade: ga });
    rail('Ya2', 'Yam', toGare + 180 - aP * s, 'XIE', 90, { fromGrade: ga, toGrade: ga });
    rail('Xis', 'XIE', 90, 'XIL', 90, { fromGrade: ga, toGrade: 0 });
  } else {
    J('XOE', xo + R, VSR - R - 40); J('XIE', xi - R, VSR - R - 40);
    rail('Xos', 'XOL', 270, 'XOE', 270); rail('Xis', 'XIE', 90, 'XIL', 90);
  }
  sig('xXo', 'block', 'Xo', 'to'); sig('eXi', 'path', 'Xis', 'to');
  corner('sw', 'SW', 0, [uw - R, -R], 270, 'W0', 90);
  J('wj', uw, 10); rail('w1', 'W0', 90, 'wj', 90); rail('w2', 'wj', 90, 'W1', 90);
  corner('nw', 'W1', 90, [uw - R, VNR - R], 0, 'NW', 180);
  // rails gardes : bout cote anneau (k) et autre bout (kf), caps d'apres leur corde (le jeu donne la vraie courbe)
  for (const k of ['ES', 'EN', 'WS', 'WN']) {
    const g = keep[k];
    if (!g) continue; // cote a prolonger : raccords libres
    const n = loc(g.near), f = loc(g.far);
    J(k, n[0], n[1]); J(k + 'f', f[0], f[1]);
    const cap = Math.round(deg(Math.atan2(n[1] - f[1], n[0] - f[0])));
    rail('k' + k, k + 'f', cap, k, cap, { existing: LEVEL + g.path });
  }
  // points de raccord a la voie basse ; quand le rail garde y aboutit deja (anneau pose a la sortie d'un virage :
  // utilisateur, « commence l'anneau a la sortie du virage »), le raccord se fait sur son bout, sans droite
  const at = (name, uu, vv, k) => (joints[k] && Math.hypot(joints[k][0] - uu, joints[k][1] - vv) < 0.5 ? k : J(name, uu, vv));
  const NO = at('NO', ue - R, VN, 'EN'), SI = at('SI', ue - R, 0, 'ES'), SO = at('SO', uw + R, 0, 'WS'), NI = at('NI', uw + R, VN, 'WN');
  // Raccord direct sur un virage (rails gardes courbes ES / EN, suivis de ES2 / EN2) : le dernier rail du virage et le quart
  // de cercle de l'anneau tournent en sens contraires et le jeu les dit en contact (mOverlappingTracks, constate le
  // 22/10/2026) ; un signal entre eux fusionnait le bloc de l'anneau et celui de la voie. Les signaux de cette entree et de
  // cette sortie sont donc reportes un rail plus loin : le rail du virage entre dans le bloc de l'anneau.
  const curveE = SI === 'ES' && keep.ES2 && keep.EN2;
  if (curveE) {
    for (const k of ['ES2', 'EN2']) {
      const g = keep[k], n = loc(g.near), f = loc(g.far);
      J(k + 'f', f[0], f[1]); // son bout cote anneau est le bout lointain du rail garde (ESf / ENf)
      rail('k' + k, k + 'f', 0, k.slice(0, 2) + 'f', 0, { existing: LEVEL + g.path });
      if (Math.hypot(n[0] - joints[k.slice(0, 2) + 'f'][0], n[1] - joints[k.slice(0, 2) + 'f'][1]) > 0.5) throw new Error(k + ' ne prolonge pas ' + k.slice(0, 2));
    }
  }
  // signaux sur un bout raccorde seulement : un cote sans rails gardes les recevra avec son prolongement
  rail('No', 'E0', 270, NO, 180);
  if (curveE) sig('xNo', 'block', 'kEN', 'from'); else if (keep.EN) sig('xNo', 'block', 'No', 'to'); // sortie vers l'est
  rail('Si', SI, 0, 'E1', 270);
  rail('So', 'W0', 90, SO, 0); if (keep.WS) sig('xSo', 'block', 'So', 'to');
  rail('Ni', NI, 180, 'W1', 90);
  // droites jusqu'aux rails gardes ; signaux d'entree de l'anneau sur le dernier rail avant les raccords SI et NI
  if (keep.ES) { const eSi = curveE ? 'kES2' : SI === 'ES' ? 'kES' : straight('MSe', 'ES', SI, 0, 1); sig('eSi', 'path', eSi, 'to'); } // entree depuis l'est
  if (keep.EN && NO !== 'EN') straight('MNe', NO, 'EN', 180, 1);
  if (keep.WS && SO !== 'WS') straight('MSw', SO, 'WS', 0, 1);
  if (keep.WN) { const eNi = NI === 'WN' ? 'kWN' : straight('MNw', 'WN', NI, 180, 1); sig('eNi', 'path', eNi, 'to'); } // entree depuis l'ouest
  // Gare deja posee dans l'alignement du cote nord, a l'est de l'anneau (layouts/anneau-gare-nord.js : elle sort vers
  // l'anneau precedent) : son entree (G5, bout libre de sa derniere voie integree, decrit par keep.GARE) se raccorde au coin
  // NE comme les gares est de la gare de triage (hub.js, rails Ein) : aiguillage en NE, droite jusqu'a l'entree, signal de
  // bloc a l'entree de la gare
  if (keep.GARE) {
    const g = keep.GARE, n = loc(g.near), f = loc(g.far);
    if (Math.abs(n[1] - VNR) > 0.5 || ue + R - n[0] < 12) throw new Error('GARE : entree hors de l\'alignement du cote nord, ou a moins de 12 m du coin NE');
    J('GARE', n[0], n[1]); J('GAREf', f[0], f[1]);
    rail('kGARE', 'GARE', 180, 'GAREf', 180, { existing: LEVEL + g.path });
    rail('Ein', 'NE', 180, 'GARE', 180); sig('xEi', 'block', 'Ein', 'to');
  }
  return { joints, rails, signals, signalsLeftHanded: true };
}

module.exports = (o = {}) => plan(o);
module.exports.SPAN = W / 2 + R; // demi-emprise jusqu'aux raccords de la voie basse (m)
module.exports.HALF = W / 2; // du centre aux cotes est et ouest (m)
module.exports.ENT = ENT;
