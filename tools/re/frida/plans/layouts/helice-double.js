// Helice ferroviaire a double voie (« ascenseur ferroviaire », demande de l'utilisateur du 21/10/2026 : « pente
// maximale, rayon minimum ») : deux voies concentriques ecartees de 6,5 m (a 6 m le jeu fusionne leurs blocs) montent
// ensemble, a la meme altitude a chaque angle. La voie interieure, au rayon minimum, porte la pente maximale ; la voie
// exterieure, plus longue, monte du meme denivele avec une pente plus douce. Un quart de tour de raccord en bas et en
// haut fait passer la pente de 0 au maximum : les quatre bouts sont de niveau, libres, a raccorder au reseau.
//
// Repere du plan : origine = axe de l'helice, au niveau des bouts bas ; u = direction des bouts bas depuis l'axe ;
// v = u + 90 deg ; z vertical ; en metres. Un rail par quart de tour et par voie.
//
//   node railplan.js layouts/helice-double.js check --origin x,y,z --axis <cap monde de u, multiple de 10>
//        [--rayon 15] [--pente 25] [--tours 2] [--sens horaire|antihoraire]
//
// --rayon : rayon de la voie interieure (m) ; --pente : pente de la voie interieure (deg) ; --tours : nombre de tours
// (multiple de 0,25) ; --sens : sens de rotation en montant, vu du dessus, nord en haut (horaire = cap croissant).
'use strict';

const GAP = 6.5;

module.exports = (o = {}) => {
  const rIn = Number(o.rayon || 15);
  const grade = Math.tan((Number(o.pente || 25) * Math.PI) / 180);
  const quarters = Math.round(Number(o.tours || 2) * 4);
  if (quarters < 2) throw new Error('au moins une demi-tour : les deux quarts de raccord');
  const s = (o.sens || 'horaire') === 'horaire' ? 1 : -1;
  const climb = ((Math.PI * rIn) / 2) * grade; // denivele d'un quart de tour a pleine pente
  // Altitude du joint k : quarts de raccord a mi-pente en bas et en haut
  const zAt = (k) => (k === 0 ? 0 : k === quarters ? climb * (quarters - 1) : climb * (k - 0.5));
  const phi = (k) => s * 90 * k; // azimut du joint k (deg du repere)
  const cap = (k) => phi(k) + s * 90; // cap de circulation en montant
  const tracks = [
    { key: 'I', r: rIn, g: grade },
    { key: 'E', r: rIn + GAP, g: (grade * rIn) / (rIn + GAP) },
  ];
  const joints = {};
  const rails = [];
  for (const t of tracks) {
    const gAt = (k) => (k === 0 || k === quarters ? 0 : t.g);
    for (let k = 0; k <= quarters; k++) {
      const a = (phi(k) * Math.PI) / 180;
      joints[t.key + k] = [t.r * Math.cos(a), t.r * Math.sin(a), zAt(k)];
    }
    for (let k = 0; k < quarters; k++) {
      rails.push({ id: t.key + k, from: t.key + k, fromCap: cap(k), fromGrade: gAt(k), to: t.key + (k + 1), toCap: cap(k + 1), toGrade: gAt(k + 1) });
    }
  }
  return { joints, rails, signals: [] };
};
