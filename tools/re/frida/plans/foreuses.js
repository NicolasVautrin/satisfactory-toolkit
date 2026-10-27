// Pose de foreuses Mk3 sur des gisements, sortie orientee automatiquement (utilisateur, 23/10/2026 : outils pour etre
// plus efficace ; gare des mines : la foreuse 427 sortait face a une bosse, plus haute que sa sortie, et le premier
// poteau n'y tenait pas). Pour chaque gisement :
//  - cap de sortie : impose (<gisement>@<cap>) ou automatique (@auto, par defaut) parmi les 8 directions (la grille du
//    traceur de convoyeurs a 8 directions) : sol a 4, 8 et 12 m devant la sortie (relief de tracer.js, surplombs
//    compris) assez bas pour un premier poteau (1 m sous la sortie au moins a 4 m, pente de 0,3 au plus ensuite), sans
//    batiment devant ; parmi celles-la, la plus proche de la direction visee (--vers) ;
//  - visee verticale sur le gisement (buildAim), a blanc puis pour de vrai, zone chargee par une source de streaming ;
//    bete trop pres (FGCDEncroachingCreature) : nouvel essai 3 s plus tard ; refus sur un gisement deja exploite : signale ;
//  - 3 eclats et 250 % (regle de l'utilisateur), sauf --cadence <fraction>.
//  - --ligne-vers <acteur>.<connecteur> (utilisateur, 27/10/2026 : « tes foreuses etaient tres mal orientees, peut-etre
//    qu'il faut tracer le chemin avant d'orienter tes foreuses » ; « on trouve le path et seulement ensuite on oriente la
//    foreuse ») : chemin trouve d'abord, par une seule recherche du traceur (tracer.js traceBelt) partie a la fois des
//    sorties des 8 caps, la foreuse a poser comptee a tous ses caps comme obstacle ; le cap est celui de
//    la sortie d'ou part le chemin. Apres la pose, ligne retracee depuis la vraie sortie : traces/<--ligne-nom,
//    foreuse-<gisement>>-ligne.json, a poser par beltline.js.
// node foreuses.js <gisement>[@<cap>|@auto] [...] [--vers x,y|<acteur>] [--nom <etat>] [--cadence 2.5] [--dry]
//   [--ligne-vers <acteur>.<connecteur> [--ligne-nom <nom>] [--poteau m] [--marge m] [--releve m] [--remplace <acteur>.<connecteur>]]
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
const LIGNE = opt('ligne-vers');
const ligneNom = (g) => opt('ligne-nom', 'foreuse-' + g);
const traceOpts = (o) => Object.assign({ H: 100 * Number(opt('poteau', 2)), marge: 100 * Number(opt('marge', 60)), RS: Math.round(100 * Number(opt('releve', 4))), RC: 400, recette: opt('recette', 'Recipe_ConveyorBeltMk6_C'), remplace: opt('remplace') }, o);
const releves = {}; // zone du releve du choix du cap, par gisement : la ligne retracee apres la pose relit le meme releve

// Emprise de la foreuse Mk3 posee au cap donne (data/clearanceData.json, boites dures reunies ; axe local +Y = sortie,
// d'ou la molette a cap - 90) : obstacle du traceur avant qu'elle n'existe
const MINER = require('../../../../data/clearanceData.json').Build_MinerMk3_C.boxes.filter((b) => b.type !== 'CT_Soft');
function minerFootprint(N, cap) {
  const t = (b) => (b.relativeTransform && b.relativeTransform.translation) || { x: 0, y: 0, z: 0 };
  const lo = (k) => Math.min(...MINER.map((b) => b.min[k] + t(b)[k])), hi = (k) => Math.max(...MINER.map((b) => b.max[k] + t(b)[k]));
  const c = { x: (lo('x') + hi('x')) / 2, y: (lo('y') + hi('y')) / 2, z: (lo('z') + hi('z')) / 2 }, a = rad(cap - 90);
  return { kind: 'box', what: 'foreuse prevue', yaw: cap - 90, c: { x: N.x + c.x * Math.cos(a) - c.y * Math.sin(a), y: N.y + c.x * Math.sin(a) + c.y * Math.cos(a), z: N.z + c.z }, h: { x: (hi('x') - lo('x')) / 2, y: (hi('y') - lo('y')) / 2, z: (hi('z') - lo('z')) / 2 } };
}
// Sortie d'une foreuse pas encore posee, au cap donne (depart de traceBelt, sans acteur)
function plannedOut(N, cap) {
  const a = rad(cap), n = { x: Math.cos(a), y: Math.sin(a) };
  return { path: null, name: 'Output0', cap, at: { x: N.x + OUT * n.x, y: N.y + OUT * n.y, z: N.z + OUT_DZ }, n, extra: [minerFootprint(N, cap)] };
}

// Cap donne par le chemin (--ligne-vers) : une recherche partie a la fois des sorties des 8 caps (un batiment devant une
// sortie ferme ce depart dans la recherche elle-meme, qui sait aussi ignorer la ligne remplacee)
async function capByTrace(g, N, ds) {
  const A = await T.beltEnd(LIGNE);
  const r = await T.traceBelt(ds.map((d) => plannedOut(N, d.cap)), A, traceOpts({ nom: ligneNom(g), write: false }));
  if (!r.best) { console.log(g, ': pas de ligne vers', LIGNE, ':', r.tries[0].fail); return null; }
  const b = r.best;
  console.log('  ', g, ': chemin de', Math.round(b.len / 100), 'm' + (b.lifts ? ', ' + b.lifts + ' ascenseur(s)' : '') + ', part de la sortie au cap', b.D.cap);
  releves[g] = r.box0;
  return b.D.cap;
}

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
    if (LIGNE) {
      cap = await capByTrace(g, N, ds);
      if (cap == null) return;
    } else {
      const best = ds.filter((d) => d.ok).sort((a, b) => a.ecart - b.ecart)[0] || ds.slice().sort((a, b) => a.devant[0] - b.devant[0])[0];
      if (!best.ok) console.log('  ', g, ': aucune direction degagee, la moins mauvaise : cap', best.cap);
      cap = best.cap;
    }
  }
  const aim = (z) => [{ x: N.x, y: N.y, z: N.z + z }, { x: N.x, y: N.y, z: N.z - 1000 }];
  // zone chargee par une source de streaming le temps de la visee et de la pose (utilisateur, 27/10/2026 : « tu as le
  // streaming maintenant » ; avant : decor simplifie d'une zone non chargee au-dessus du gisement, il fallait rapprocher
  // le joueur)
  const src = await T.loadArea({ x0: N.x - 3000, y0: N.y - 3000, x1: N.x + 3000, y1: N.y + 3000 });
  let r;
  try {
    for (let t = 0; t < 4; t++) {
      r = await call('buildAim', 'Recipe_MinerMk3_C', ...aim(1000), { dryRun: true, scrollRotation: cap - 90 });
      const bl = r.blocking || r.disqualifiers || [];
      if (!bl.includes('FGCDEncroachingCreature')) break;
      console.log('  ', g, ': bete trop pres, nouvel essai dans 3 s'); await sleep(3000);
    }
    const bl = r.blocking || r.disqualifiers || [];
    if (bl.length) {
      // gisement deja exploite : un extracteur a moins de 10 m
      let occ = [];
      try { occ = (await call('scan', 'FGBuildableResourceExtractor', N, 1000, 5, {})).items || []; } catch (e) { occ = []; }
      console.log(g, 'cap', cap, ': REFUS', JSON.stringify(bl), occ.length ? '- gisement deja exploite par ' + occ.map((it) => short(it.path)).join(', ') : '');
      return;
    }
    if (DRY) { console.log(g, 'cap', cap, ': pose a blanc possible'); return; }
    r = await call('buildAim', 'Recipe_MinerMk3_C', ...aim(1000), { scrollRotation: cap - 90 });
    if (!r.built) { console.log(g, 'cap', cap, ': NON construite', JSON.stringify(r.blocking || r).slice(0, 200)); return; }
  } finally { await call('streamingSourceRemove', src); }
  await call('addShards', r.actor, 3);
  const s = await call('setClock', r.actor, Number(opt('cadence', 2.5)));
  const o = (await call('connections', r.actor)).find((c) => /Output/.test(c.name));
  st[g] = { foreuse: r.actor, cap, sortie: o.location }; save();
  console.log(g, 'foreuse', short(r.actor), 'cap', cap, '| cadence', s.pendingPotential, 'eclats', s.powerShards, '| sortie', o.name, '(' + Math.round(o.location.x) + ' ; ' + Math.round(o.location.y) + ' ; ' + (o.location.z / 100).toFixed(1) + ' m)');
  if (LIGNE) {
    // ligne retracee depuis la vraie sortie (ecart avec la sortie prevue signale), sur le releve du choix du cap
    const p = plannedOut(N, cap), d = Math.hypot(o.location.x - p.at.x, o.location.y - p.at.y, o.location.z - p.at.z);
    if (d > 50) console.log('  ', g, ': sortie a', Math.round(d), 'uu de la sortie prevue (OUT / OUT_DZ a revoir)');
    const hn = Math.hypot(o.normal.x, o.normal.y) || 1;
    const D = { path: r.actor, name: o.name, at: o.location, n: { x: o.normal.x / hn, y: o.normal.y / hn }, extra: p.extra };
    const t = await T.traceBelt([D], await T.beltEnd(LIGNE), traceOpts({ nom: ligneNom(g), box0: releves[g] }));
    if (!t.best) { console.log(g, ': pas de ligne depuis la sortie posee :', t.tries[0].fail); return; }
    st[g].ligne = path.relative(__dirname, t.best.file); save();
    console.log(g, ': ligne a poser : node beltline.js', st[g].ligne, 'build --nom', ligneNom(g) + '-sol');
  }
}

(async () => {
  const list = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));
  if (!list.length) throw new Error('usage : node foreuses.js <gisement>[@<cap>|@auto] [...] [--vers x,y|<acteur>] [--nom <etat>] [--cadence 2.5] [--dry]');
  const vers = opt('vers') ? await where(opt('vers')) : null;
  const nodes = (await call('scan', 'FGResourceNode', { x: 0, y: 0, z: 0 }, 1e9, 5000, {})).items;
  for (const a of list) { const [g, cap] = a.split('@'); await poser(nodes, g, cap, vers); }
})().catch((e) => { console.error('ECHEC :', e.message); process.exitCode = 1; });
