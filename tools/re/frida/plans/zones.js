// Rails d'un plan de triage a poser depuis une position du joueur, dans l'ordre du plan (celui de railplan build) :
//  - pas encore construits, les deux joints a moins de --r m (a l'horizontale) du point (u, v) du repere des helices ;
//  - chaque bout doit trouver son accroche : a son joint, un bout du cote oppose deja pose (ou pose plus tot dans ce
//    lancement), ou aucun rail encore pose a ce joint (bout libre, que les suivants prendront comme accroche).
// node zones.js --plan layouts/hub --u 200 --v 3 --r 125 [--filtre <regex>] [options du plan : --etage 1 --nom hub1 ...]
const fs = require('fs');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : d; };
const o = {};
for (let i = 2; i < process.argv.length; i++) if (process.argv[i].startsWith('--')) o[process.argv[i].slice(2)] = process.argv[i + 1];
if (!o.plan) throw new Error('--plan <plan sans .js>');
const plan = require('./' + o.plan + '.js')(o);
const sp = __dirname + '/' + o.nom + '-state.json';
const state = fs.existsSync(sp) ? JSON.parse(fs.readFileSync(sp, 'utf8')).rails : {};
const u = Number(arg('u')), v = Number(arg('v')), r = Number(arg('r', 125));
const only = arg('filtre') ? new RegExp(arg('filtre')) : null;
const near = (j) => Math.hypot(plan.joints[j][0] - u, plan.joints[j][1] - v) <= r;
const norm = (a) => ((Math.round(a) % 360) + 360) % 360;
// bouts : { rail, joint, out } (out = normale sortante du bout)
const ends = [];
for (const x of plan.rails) {
  ends.push({ rail: x.id, joint: x.from, out: norm(x.fromCap + 180) });
  ends.push({ rail: x.id, joint: x.to, out: norm(x.toCap) });
}
const built = new Set(plan.rails.filter((x) => x.existing || state[x.id]).map((x) => x.id));
const ok = (x, joint, want) => {
  const here = ends.filter((e) => e.joint === joint && e.rail !== x.id && built.has(e.rail));
  return !here.length || here.some((e) => e.out === norm(want));
};
const ids = [];
for (const x of plan.rails) {
  if (built.has(x.id) || !near(x.from) || !near(x.to)) continue;
  if (only && !only.test(x.id)) continue; // --filtre : rails de ce motif seulement
  if (!ok(x, x.from, x.fromCap) || !ok(x, x.to, x.toCap + 180)) continue;
  ids.push(x.id);
  built.add(x.id);
}
const left = plan.rails.filter((x) => !built.has(x.id)).map((x) => x.id);
console.error(ids.length + ' rails ici, ' + left.length + ' restent : ' + left.join(' '));
console.log(ids.join('|'));
