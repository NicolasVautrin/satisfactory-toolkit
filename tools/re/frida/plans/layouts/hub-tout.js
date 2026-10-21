// Plan combine pour la verification a blanc : les trois etages (hub.js, helices comprises a l'etage du bas), noms des
// etages prefixes (f0_, f1_, f2_) sauf les rails, joints et signaux des helices (hub-helices.js), partages. Check seulement.
// node railplan.js layouts/hub-tout.js check --origin 141339,-261512,15349 --axis 180 --nom hub-essai --ebauche oui
'use strict';
const hub = require('./hub.js');
const helices = require('./hub-helices.js');

module.exports = (o = {}) => {
  const hel = helices();
  const sharedJ = new Set(Object.keys(hel.joints));
  const helRails = new Set(hel.rails.map((r) => r.id));
  const helSig = new Set(hel.signals.map((s) => s.id));
  const out = { joints: Object.assign({}, hel.joints), rails: hel.rails.slice(), signals: hel.signals.slice(), signalsLeftHanded: true };
  for (const f of [0, 1, 2]) {
    const p = hub(Object.assign({}, o, { etage: f }));
    const n = (x) => (sharedJ.has(x) ? x : 'f' + f + '_' + x);
    const nr = (x) => (helRails.has(x) ? x : 'f' + f + '_' + x);
    for (const [k, v] of Object.entries(p.joints)) if (!sharedJ.has(k)) out.joints[n(k)] = v;
    for (const r of p.rails) {
      if (helRails.has(r.id)) continue;
      out.rails.push(Object.assign({}, r, { id: nr(r.id), from: n(r.from), to: n(r.to) }));
    }
    for (const s of p.signals) {
      if (helSig.has(s.id)) continue;
      out.signals.push(Object.assign({}, s, { id: 'f' + f + '_' + s.id, rail: nr(s.rail) }));
    }
  }
  return out;
};
