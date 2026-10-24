// Remise de la voie basse entre x -124 096 et -152 613 (22/10/2026) apres le retrait d'un anneau pose au mauvais endroit
// (layouts/anneau-voie-basse.js, centre sur une ancienne position du joueur). Double voie droite comme a l'origine : 5 rails
// de 57 m par voie, joints en x -129 800, -135 503, -141 206, -146 910 ; accrochee aux rails gardes de part et d'autre.
// Repere de l'anneau : origine (-138 000 ; -207 220 ; 349), axe 180 (u vers l'ouest, v vers le nord) ; voie sud v 0.
//
// node railplan.js layouts/voie-basse-reprise.js check|build --origin -138000,-207220,349 --axis 180 --nom voie-basse-reprise
'use strict';

const VN = 6.5;
const u = (x) => (-138000 - x) / 100;
const LEVEL = '/Game/FactoryGame/Map/GameLevel01/Persistent_Level.Persistent_Level:PersistentLevel.';
const KEEP = {
  ES: { path: 'Build_RailroadTrack_C_2144688674', near: u(-124096), far: u(-118393), v: 0 },
  EN: { path: 'Build_RailroadTrack_C_2144690604', near: u(-124096), far: u(-118393), v: VN },
  WS: { path: 'Build_RailroadTrack_C_2144688295', near: u(-152613), far: u(-158317), v: 0 },
  WN: { path: 'Build_RailroadTrack_C_2144690202', near: u(-152613), far: u(-158317), v: VN },
};

module.exports = () => {
  const joints = {}, rails = [];
  const J = (name, uu, vv) => { joints[name] = [uu, vv, 0]; return name; };
  for (const [k, g] of Object.entries(KEEP)) {
    J(k, g.near, g.v); J(k + 'f', g.far, g.v);
    if (k[0] === 'E') rails.push({ id: 'k' + k, from: k + 'f', fromCap: 0, to: k, toCap: 0, existing: LEVEL + g.path });
    else rails.push({ id: 'k' + k, from: k, fromCap: 0, to: k + 'f', toCap: 0, existing: LEVEL + g.path });
  }
  // 5 rails par voie : voie sud de l'est vers l'ouest (cap 0), voie nord de l'ouest vers l'est (cap 180)
  for (const [id, a, b, cap, v] of [['S', 'ES', 'WS', 0, 0], ['N', 'WN', 'EN', 180, VN]]) {
    const ua = joints[a][0], ub = joints[b][0];
    let prev = a;
    for (let i = 1; i <= 5; i++) {
      const j = i === 5 ? b : J(id + 'j' + i, ua + ((ub - ua) * i) / 5, v);
      rails.push({ id: id + i, from: prev, fromCap: cap, to: j, toCap: cap });
      prev = j;
    }
  }
  return { joints, rails, signals: [], signalsLeftHanded: true };
};
