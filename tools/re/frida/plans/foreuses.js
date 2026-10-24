// Pose de foreuses Mk3 sur des gisements, sortie orientee automatiquement (utilisateur, 23/10/2026 : outils pour etre
// plus efficace ; gare des mines : la foreuse 427 sortait face a une bosse, plus haute que sa sortie, et le premier
// poteau n'y tenait pas). Pour chaque gisement :
//  - cap de sortie : impose (<gisement>@<cap>) ou automatique (@auto, par defaut) parmi les 8 directions (la grille du
//    traceur de convoyeurs a 8 directions) : sol a 4, 8 et 12 m devant la sortie (relief de tracer.js, surplombs
//    compris) assez bas pour un premier poteau (1 m sous la sortie au moins a 4 m, pente de 0,3 au plus ensuite), sans
//    batiment devant ; parmi celles-la, la plus proche de la direction visee (--vers) ;
//  - visee verticale sur le gisement (buildAim), a blanc puis pour de vrai ; bete trop pres (FGCDEncroachingCreature) :
//    nouvel essai 3 s plus tard ; decor simplifie d'une zone non chargee au-dessus du gisement (StaticMeshProxy) :
//    signale, il faut rapprocher le joueur ;
//  - 3 eclats et 250 % (regle de l'utilisateur), sauf --cadence <fraction>.
// node foreuses.js <gisement>[@<cap>|@auto] [...] [--vers x,y|<acteur>] [--nom <etat>] [--cadence 2.5] [--dry]
//   <gisement> : numero apres BP_ResourceNode (430, 435_26, 487_UAID_...) ; etat : plans/foreuses-<nom>-state.json
'use strict';
const fs = require('fs');
const path = require('path');
const { call, short } = require('./client');
const T = require('./tracer');

const PRE = '/Game/FactoryGame/Map/GameLevel01/Persistent_Level.Persistent_Level:PersistentLevel.';
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i < 0 ? d : argv[i + 1]; };
const DRY = argv.includes('--dry');
const NOM = opt('nom', 'divers');
const SF = path.join(__dirname, 'foreuses-' + NOM + '-state.json');
const st = fs.existsSync(SF) ? JSON.parse(fs.readFileSync(SF, 'utf8')) : {};
const save = () => { if (!DRY) fs.writeFileSync(SF, JSON.stringify(st, null, 1)); };
const OUT = 800; // sortie de la Mk3 a 8 m du centre, dans l'axe du cap de sortie (releve aux 8 foreuses des mines)
const OUT_DZ = 130; // et 1,3 m au-dessus du gisement
const rad = (d) => (d * Math.PI) / 180;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const angDiff = (a, b) => { const d = ((a - b) % 360 + 540) % 360 - 180; return Math.abs(d); };

async function where(s) {
  const m = /^(-?[\d.]+),(-?[\d.]+)$/.exec(s || '');
  if (m) return { x: +m[1], y: +m[2] };
  return (await call('pose', s.includes('/') ? s : PRE + s)).location;
}

// Directions possibles de la sortie, notees : sol devant (m sous la sortie), batiment, ecart a la direction visee
async function directions(N, vers) {
  const box = { x0: N.x - 2400, x1: N.x + 2400, y0: N.y - 2400, y1: N.y + 2400 };
  const W = { box, width: 0, height: 0, relief: await T.relief(box, 400) };
  W.near = T.index(await T.obstacles(box, new Set()));
  const zo = N.z + OUT_DZ;
  const want = vers ? (Math.atan2(vers.y - N.y, vers.x - N.x) * 180) / Math.PI : null;
  const out = [];
  for (let cap = 0; cap < 360; cap += 45) {
    const a = rad(cap), gs = [], hits = [];
    for (const d of [400, 800, 1200]) {
      const x = N.x + Math.cos(a) * (OUT + d), y = N.y + Math.sin(a) * (OUT + d), g = T.hAt(W.relief, x, y);
      gs.push(g);
      const h = T.hitColumn(W, x, y, g + 50, zo + 100, Infinity);
      if (h) hits.push(h);
    }
    const ok = gs[0] <= zo - 100 && gs[1] <= zo + 0.3 * 800 && gs[2] <= zo + 0.3 * 1200 && !hits.length;
    out.push({ cap, ok, devant: gs.map((g) => Math.round((g - zo) / 10) / 10), hits, ecart: want == null ? 0 : angDiff(cap, want) });
  }
  return out;
}

async function poser(nodes, g, capArg, vers) {
  if (st[g]) { console.log(g, 'deja posee :', short(st[g].foreuse)); return; }
  const n = nodes.find((k) => k.path.endsWith('BP_ResourceNode' + g));
  if (!n) { console.log(g, ': gisement introuvable'); return; }
  const N = n.location;
  let cap = capArg === 'auto' || capArg == null ? null : Number(capArg);
  if (cap == null) {
    const ds = await directions(N, vers);
    for (const d of ds) console.log('  ', g, 'cap', String(d.cap).padStart(3), d.ok ? 'possible' : 'non     ', 'sol devant', JSON.stringify(d.devant), 'm', d.hits.length ? 'batiment ' + d.hits[0] : '', vers ? 'ecart ' + Math.round(d.ecart) + ' deg' : '');
    const best = ds.filter((d) => d.ok).sort((a, b) => a.ecart - b.ecart)[0] || ds.slice().sort((a, b) => a.devant[0] - b.devant[0])[0];
    if (!best.ok) console.log('  ', g, ': aucune direction degagee, la moins mauvaise : cap', best.cap);
    cap = best.cap;
  }
  const aim = (z) => [{ x: N.x, y: N.y, z: N.z + z }, { x: N.x, y: N.y, z: N.z - 1000 }];
  let r;
  for (let t = 0; t < 4; t++) {
    r = await call('buildAim', 'Recipe_MinerMk3_C', ...aim(1000), { dryRun: true, scrollRotation: cap - 90 });
    const bl = r.blocking || r.disqualifiers || [];
    if (!bl.includes('FGCDEncroachingCreature')) break;
    console.log('  ', g, ': bete trop pres, nouvel essai dans 3 s'); await sleep(3000);
  }
  const bl = r.blocking || r.disqualifiers || [];
  if (bl.length) {
    // decor simplifie au-dessus du gisement : zone non chargee, il faut rapprocher le joueur
    const v = (await call('sweeps', [{ from: { x: N.x, y: N.y, z: N.z + 3000 }, to: { x: N.x, y: N.y, z: N.z - 500 }, half: { x: 5, y: 5, z: 5 } }]))[0];
    const proxy = v && v.hit && /Proxy/.test(String((v.component || {}).path || ''));
    console.log(g, 'cap', cap, ': REFUS', JSON.stringify(bl), proxy ? '- decor simplifie au-dessus (zone non chargee) : rapprocher le joueur' : '');
    return;
  }
  if (DRY) { console.log(g, 'cap', cap, ': pose a blanc possible'); return; }
  r = await call('buildAim', 'Recipe_MinerMk3_C', ...aim(1000), { scrollRotation: cap - 90 });
  if (!r.built) { console.log(g, 'cap', cap, ': NON construite', JSON.stringify(r.blocking || r).slice(0, 200)); return; }
  await call('addShards', r.actor, 3);
  const s = await call('setClock', r.actor, Number(opt('cadence', 2.5)));
  const o = (await call('connections', r.actor)).find((c) => /Output/.test(c.name));
  st[g] = { foreuse: r.actor, cap, sortie: o.location }; save();
  console.log(g, 'foreuse', short(r.actor), 'cap', cap, '| cadence', s.pendingPotential, 'eclats', s.powerShards, '| sortie', o.name, '(' + Math.round(o.location.x) + ' ; ' + Math.round(o.location.y) + ' ; ' + (o.location.z / 100).toFixed(1) + ' m)');
}

(async () => {
  const list = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));
  if (!list.length) throw new Error('usage : node foreuses.js <gisement>[@<cap>|@auto] [...] [--vers x,y|<acteur>] [--nom <etat>] [--cadence 2.5] [--dry]');
  const vers = opt('vers') ? await where(opt('vers')) : null;
  const nodes = (await call('scan', 'FGResourceNode', { x: 0, y: 0, z: 0 }, 1e9, 5000, {})).items;
  for (const a of list) { const [g, cap] = a.split('@'); await poser(nodes, g, cap, vers); }
})().catch((e) => { console.error('ECHEC :', e.message); process.exitCode = 1; });
