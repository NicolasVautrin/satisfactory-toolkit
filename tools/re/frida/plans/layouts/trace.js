// Plan railplan.js d'un trace calcule par tracer.js (plans/traces/<nom>.json) : une voie (V), ou deux voies decalees de
// 3,25 m de part et d'autre de l'axe (--double du trace) : aller (A) a gauche du sens de marche, retour (R) a droite,
// parcouru en sens inverse (circulation a gauche). Chaque voie s'accroche au connecteur de depart du trace s'il y en a
// (rail existant decrit par ses deux bouts) ; une voie simple, aussi a son connecteur d'arrivee (--arrivee-a du trace).
// Repere monde, en metres : origine 0,0,0, axe 0.
//
// node railplan.js layouts/trace.js check|build --origin 0,0,0 --axis 0 --nom <nom> --trace <nom du trace>
'use strict';
const fs = require('fs');
const path = require('path');

const LEVEL = '/Game/FactoryGame/Map/GameLevel01/Persistent_Level.Persistent_Level:PersistentLevel.';
const SPACING = 650; // double voie : 6,5 m d'axe en axe (uu)

module.exports = (o = {}) => {
  if (!o.trace) throw new Error('--trace <nom> requis (plans/traces/<nom>.json, ecrit par tracer.js)');
  const T = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'traces', o.trace + '.json'), 'utf8'));
  const joints = {}, rails = [];
  const m = (p) => [p.x / 100, p.y / 100, p.z / 100];
  const tracks = T.double ? [['A', -1, 'aller'], ['R', 1, 'retour']] : [['V', 0, 'aller']];
  for (const [k, side, end] of tracks) {
    T.joints.forEach((j, i) => {
      const a = ((j.cap + 90) * Math.PI) / 180, off = (side * SPACING) / 2;
      joints[k + i] = m({ x: j.x + off * Math.cos(a), y: j.y + off * Math.sin(a), z: j.z });
    });
    for (let i = 1; i < T.joints.length; i++) {
      const a = T.joints[i - 1], b = T.joints[i];
      if (k === 'R') rails.push({ id: k + i, from: k + i, fromCap: b.cap + 180, to: k + (i - 1), toCap: a.cap + 180, fromGrade: -b.grade, toGrade: -a.grade });
      else rails.push({ id: k + i, from: k + (i - 1), fromCap: a.cap, to: k + i, toCap: b.cap, fromGrade: a.grade, toGrade: b.grade });
    }
    // connecteur de depart : rail existant entre son autre bout et le premier joint de la voie
    const e = T.ends && T.ends[end];
    if (e) {
      const d = Math.hypot(e.location.x / 100 - joints[k + 0][0], e.location.y / 100 - joints[k + 0][1]);
      if (d > 0.5) throw new Error('voie ' + k + ' : le connecteur ' + e.path + '.' + e.name + ' est a ' + d.toFixed(2) + ' m de son premier joint');
      joints['k' + k + 'f'] = m(e.far);
      const cap = Math.round((Math.atan2(e.location.y - e.far.y, e.location.x - e.far.x) * 180) / Math.PI);
      rails.unshift({ id: 'k' + k, from: 'k' + k + 'f', fromCap: cap, to: k + 0, toCap: cap, existing: LEVEL + e.path });
    }
    // connecteur d'arrivee (voie simple, --arrivee-a du trace) : rail existant entre le dernier joint et son autre bout
    const z = T.ends && T.ends.arrivee, last = k + (T.joints.length - 1);
    if (z && k === 'V') {
      const d = Math.hypot(z.location.x / 100 - joints[last][0], z.location.y / 100 - joints[last][1]);
      if (d > 0.5) throw new Error('voie V : le connecteur ' + z.path + '.' + z.name + ' est a ' + d.toFixed(2) + ' m de son dernier joint');
      joints.kVz = m(z.far);
      const cap = Math.round((Math.atan2(z.far.y - z.location.y, z.far.x - z.location.x) * 180) / Math.PI);
      rails.push({ id: 'kVz', from: last, fromCap: cap, to: 'kVz', toCap: cap, existing: LEVEL + z.path });
    }
  }
  return { joints, rails, signals: [], signalsLeftHanded: true };
};
