// Fantome d'un plan de voies (utilisateur, 24/10/2026 : « un hologramme de la gare que je puisse manipuler, un peu comme
// un blueprint ») : blocs d'hologramme poses par l'agent (RPC ghost), qui suivent la visee du joueur. Le centre de la gare
// va au point vise ; a la creation, les trains traversent les quais dans le sens du regard. Ensuite, en jeu : molette =
// rotation de 1 deg autour du centre (Maj + molette : 10 deg), Ctrl + molette = altitude des rails de 1 m, clic gauche =
// fige, clic droit = reprend le suivi. Puis on relit sa position pour construire au meme endroit avec railplan.js.
// --reprendre <fichier> : recree le fantome fige a la position enregistree (sortie JSON de ghostGet), ex. apres un
// redemarrage de l'hote (qui fait perdre la main sur les blocs : les retirer avant).
//
// node fantome.js gare [--quais 4] [--ecart 6.5] [--miroir oui] [--z 150] [--sortie 250] [--entree 60]
//      modele layouts/gare-contournement.js (memes options) : voies (courbes d'Hermite des rails du plan, en troncons de
//      10 m au plus), gare et quais (volume), couloirs de prolongement a la sortie (--sortie m) et a l'entree (--entree m),
//      mat au centre de la gare ; suivi de la visee
// node fantome.js fige | suis           arrete / reprend le suivi de la visee
// node fantome.js altitude <m>          altitude des rails (m)
// node fantome.js lire                  position du fantome et repere railplan equivalent (--origin, --axis)
// node fantome.js retire                retire le fantome
'use strict';
const path = require('path');
const { call } = require('./client');

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf('--' + name); return i < 0 ? def : argv[i + 1]; };
const rad = (d) => (d * Math.PI) / 180;
const CENTER = [40, 0]; // centre de la gare et des quais (u, v), en metres

// Blocs d'un rail du plan : courbe d'Hermite de from (cap fromCap) a to (cap toCap), troncons de 10 m au plus
function railBlocks(J, r) {
  const a = J[r.from], b = J[r.to];
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const t0 = [L * Math.cos(rad(r.fromCap)), L * Math.sin(rad(r.fromCap))], t1 = [L * Math.cos(rad(r.toCap)), L * Math.sin(rad(r.toCap))];
  const at = (t) => {
    const h00 = 2 * t ** 3 - 3 * t ** 2 + 1, h10 = t ** 3 - 2 * t ** 2 + t, h01 = -2 * t ** 3 + 3 * t ** 2, h11 = t ** 3 - t ** 2;
    return [h00 * a[0] + h10 * t0[0] + h01 * b[0] + h11 * t1[0], h00 * a[1] + h10 * t0[1] + h01 * b[1] + h11 * t1[1], a[2] + (b[2] - a[2]) * (3 * t ** 2 - 2 * t ** 3)];
  };
  const n = Math.max(1, Math.ceil(L / 10)), out = [];
  for (let k = 0; k < n; k++) {
    const p = at(k / n), q = at((k + 1) / n);
    const du = q[0] - p[0], dv = q[1] - p[1], dz = q[2] - p[2], len = Math.hypot(du, dv);
    out.push({ u: (p[0] + q[0]) / 2, v: (p[1] + q[1]) / 2, z: (p[2] + q[2]) / 2, lu: len / 2 + 0.3, lv: 1.5, lz: 0.4, yaw: (Math.atan2(dv, du) * 180) / Math.PI, pitch: (Math.atan2(dz, len) * 180) / Math.PI });
  }
  return out;
}

const COMMANDS = {
  async gare() {
    const model = require(path.join(__dirname, 'layouts', 'gare-contournement.js'));
    const o = { quais: opt('quais', '4'), chargement: 'oui', ecart: opt('ecart', '6.5'), miroir: opt('miroir', 'oui') };
    const plan = model(o);
    const J = plan.joints, parts = [];
    for (const r of plan.rails) parts.push(...railBlocks(J, r));
    // gare puis quais : boites englobantes mesurees en jeu sur G15 (layouts/gare-boites.json, repere du plan : u, v, z en
    // metres ; 17,4 x 33,9 x 20,7 m pour la gare, 16 x 34,1 x 20,1 m par quai), un quai de plus par 16 m au-dela de 4
    const quais = Number(o.quais);
    const boxes = JSON.parse(require('fs').readFileSync(path.join(__dirname, 'layouts', 'gare-boites.json'), 'utf8'));
    for (let k = 0; k <= quais; k++) {
      const bx = boxes[Math.min(k, boxes.length - 1)], du = k < boxes.length ? 0 : 16 * (k - boxes.length + 1);
      parts.push({ u: (bx.u[0] + bx.u[1]) / 2 + du, v: (bx.v[0] + bx.v[1]) / 2, z: (bx.z[0] + bx.z[1]) / 2, lu: (bx.u[1] - bx.u[0]) / 2, lv: (bx.v[1] - bx.v[0]) / 2, lz: (bx.z[1] - bx.z[0]) / 2 });
    }
    const axisV = (J.ES[1] + J.WS[1]) / 2, sortie = Number(opt('sortie', '250')), entree = Number(opt('entree', '60'));
    if (sortie > 0) parts.push({ u: J.ES[0] - sortie / 2, v: axisV, z: 0, lu: sortie / 2, lv: 6.5, lz: 0.15 });
    if (entree > 0) parts.push({ u: J.EN[0] + entree / 2, v: (J.EN[1] + J.WN[1]) / 2, z: 0, lu: entree / 2, lv: 6.5, lz: 0.15 });
    parts.push({ u: CENTER[0], v: CENTER[1], z: 40, lu: 1, lv: 1, lz: 40 }); // mat de 80 m au centre
    const back = opt('reprendre');
    const prev = back ? JSON.parse(require('fs').readFileSync(back, 'utf8').replace(/^﻿/, '')) : null;
    const opts = { center: CENTER, z: prev ? prev.z : Number(opt('z', '150')) * 100 };
    if (prev && prev.frame) opts.frame = Object.assign({}, prev.frame, { z: prev.z, axis: prev.axis != null ? prev.axis : prev.frame.axis });
    const r = await call('ghost', parts, opts);
    console.log(r.blocks, 'blocs ; suivi de la visee :', r.follow ? 'oui' : 'non (fige, clic droit pour reprendre)');
  },
  async fige() { console.log(JSON.stringify(await call('ghostSet', { follow: false }))); },
  async suis() { console.log(JSON.stringify(await call('ghostSet', { follow: true }))); },
  async altitude(m) { console.log(JSON.stringify(await call('ghostSet', { z: Number(m) * 100 }))); },
  async lire() {
    const g = await call('ghostGet');
    if (!g.frame) throw new Error('aucun fantome');
    const f = g.frame, a = rad(f.axis);
    // origine du plan (sortie de la gare, u = 0) : centre moins CENTER le long de u et v
    const b = rad(f.axis + 90);
    const ox = f.x - g.center[0] * 100 * Math.cos(a) - g.center[1] * 100 * Math.cos(b);
    const oy = f.y - g.center[0] * 100 * Math.sin(a) - g.center[1] * 100 * Math.sin(b);
    console.log('centre de la gare (' + Math.round(f.x) + ' ; ' + Math.round(f.y) + '), rails a ' + (f.z / 100).toFixed(1) + ' m, sens de marche dans les quais ' + Math.round((f.axis + 180) % 360) + ' deg, suivi ' + (g.follow ? 'oui' : 'non'));
    console.log('railplan : --origin ' + Math.round(ox) + ',' + Math.round(oy) + ',' + Math.round(f.z) + ' --axis ' + Math.round(f.axis * 10) / 10);
  },
  async retire() { console.log(JSON.stringify(await call('ghostRemove'))); },
};

const cmd = argv[0];
if (!COMMANDS[cmd]) {
  console.error('usage : node fantome.js gare [options] | fige | suis | altitude <m> | lire | retire');
  process.exit(2);
}
COMMANDS[cmd](...argv.slice(1).filter((a) => !a.startsWith('--'))).catch((e) => { console.error('ERR', e.message); process.exit(1); });
