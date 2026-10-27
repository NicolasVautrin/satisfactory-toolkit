// Plan d'un bout d'anneau refait (plans/bouts-anneaux.js) : lu dans le fichier --spec (JSON ecrit par l'outil : joints,
// rails a poser, rails existants d'accroche, signaux), dans le repere de l'anneau.
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = (o = {}) => {
  if (!o.spec) throw new Error('--spec <fichier JSON> requis (ecrit par bouts-anneaux.js)');
  const spec = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', o.spec), 'utf8'));
  return { joints: spec.joints, rails: spec.rails, signals: spec.signals };
};
