// Controle d'une gare de triage construite, compare au plan : a chaque joint, chaque bout de rail doit etre raccorde a
// tous les bouts du cote oppose (et a eux seuls) ; contacts du jeu (mOverlappingTracks) hors joint commun.
// node verif-plan.js --plan layouts/hub [options du plan : --nom hub1 --etage 1]
const fs = require('fs');
const { call, short } = require('./client.js');
const o = {};
for (let i = 2; i < process.argv.length; i++) if (process.argv[i].startsWith('--')) o[process.argv[i].slice(2)] = process.argv[i + 1];
if (!o.plan) throw new Error('--plan <plan sans .js>');
const plan = require('./' + o.plan + '.js')(o);
const st = JSON.parse(fs.readFileSync(__dirname + '/' + o.nom + '-state.json'));
const H = { x: 141339, y: -261512, z: 349 };
const local = (p) => [-(p.x - H.x) / 100, -(p.y - H.y) / 100, (p.z - H.z) / 100];
const norm = (a) => ((Math.round(a) % 360) + 360) % 360;
const gap = (j, at) => Math.hypot(...plan.joints[j].map((v, i) => v - at[i]));
(async () => {
  const path = {};
  for (const r of plan.rails) path[r.id] = r.existing || st.rails[r.id];
  const byPath = {};
  for (const id in path) if (path[id]) byPath[path[id]] = id;
  const ends = [];
  for (const r of plan.rails) {
    ends.push({ rail: r.id, joint: r.from, out: norm(r.fromCap + 180) });
    ends.push({ rail: r.id, joint: r.to, out: norm(r.toCap) });
  }
  const opposite = (a, b) => Math.cos(((a - b) * Math.PI) / 180) < -0.5;
  let bad = 0, switches = 0;
  const contacts = [];
  for (const r of plan.rails) {
    if (!path[r.id]) { console.log('NON CONSTRUIT', r.id); bad++; continue; }
    if (r.existing && !/^(gare|l\dU1)/.test(r.id)) continue; // ancres hors du trace (helice, canyon)
    const info = await call('rails', path[r.id]);
    for (const c of info.connections) {
      const at = local(c.location);
      const e = ends.filter((x) => x.rail === r.id).sort((a, b) => gap(a.joint, at) - gap(b.joint, at))[0];
      const d = gap(e.joint, at);
      const want = ends.filter((x) => x.joint === e.joint && x.rail !== r.id && opposite(x.out, e.out)).map((x) => x.rail).sort();
      const got = c.connections.map((x) => byPath[x.track] || short(x.track)).sort();
      if (got.length > 1) switches++;
      const okj = d < 0.5 && JSON.stringify(want) === JSON.stringify(got);
      if (!okj) { bad++; console.log('ECART', r.id, c.name, 'joint', e.joint, 'a ' + d.toFixed(2) + ' m', 'attendu [' + want.join(',') + '] obtenu [' + got.join(',') + ']'); }
    }
    try {
      const dd = await call('dump', path[r.id], 1, 20, ['mOverlappingTracks']);
      for (const p of dd.mOverlappingTracks || []) {
        const other = byPath[p] || short(p);
        const rr = plan.rails.find((x) => x.id === other);
        const shared = rr && [r.from, r.to].some((j) => j === rr.from || j === rr.to);
        if (!shared) contacts.push(r.id + '/' + other);
      }
    } catch (e) { contacts.push(r.id + '/?'); }
  }
  console.log((bad ? bad + ' ecart(s)' : 'joints conformes au plan') + ' ; bouts raccordes a 2 rails (aiguillages, vus de chaque branche) : '
    + switches + ' ; contacts hors joint commun : ' + (contacts.join(' ') || 'aucun'));
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
