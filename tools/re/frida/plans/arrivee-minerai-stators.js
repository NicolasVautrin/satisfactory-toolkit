// Arrivee du minerai de fer des modules de stators 1 a 4 depuis la gare hub0-est1 (accord utilisateur 22/10/2026 :
// « ok vas-y pour le minerai, avec des tampons ») :
//  - tampon : un conteneur industriel au niveau du quai derriere chacun des 3 quais de dechargement (x 121 556,
//    123 156, 124 756), entrees face aux sorties du quai, sorties au nord ;
//  - 4 lignes Mk6 vers les repartiteurs de tete des modules (x 118 000, y -270 100 - 60 m par module, +1 m) ;
//    L1 <- tampon 1 ; L2 <- tampons 1 et 2 ; L3 <- tampons 2 et 3 ; L4 <- tampon 3 (un fusionneur prend ce qui est
//    disponible : un tampon vide est compense par son voisin) ;
//  - couloirs vers le nord a x 122 856 (L2), 124 456 (L3) et 125 600 (L4), hors des relais et ascenseurs des
//    modules (x 121 800 / 122 200) et du tronc des stators (x 123 000 / 123 400) ; relais (fusionneurs) tous les 40 m.
// usage : node arrivee-minerai-stators.js [--dry]       Etat : arrivee-minerai-stators-state.json (non versionne)
'use strict';

const fs = require('fs');
const path = require('path');
const { call, short } = require('./client');

const DRY = process.argv.includes('--dry');
const AIR = { ignore: ['FGCDInvalidFloor'] };
const REC = { container: 'Recipe_StorageContainerMk2_C', merger: 'Recipe_ConveyorAttachmentMerger_C', belt: 'Recipe_ConveyorBeltMk6_C' };
const Y_ORE = (n) => -270100 - 6000 * (n - 1);   // tete de minerai du module n
const Y_TAMPON = -268161, Z_QUAI = 349;          // conteneurs : sorties a y -268 561, z +1 m (Output1) et +5 m (Output2)
const NORD = -90, OUEST = 180;                   // caps des relais (sortie dans le sens du flux)

const FILE = path.join(__dirname, 'arrivee-minerai-stators-state.json');
const st = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : {};
for (const k of ['actors', 'links']) st[k] = st[k] || {};
const save = () => fs.writeFileSync(FILE, JSON.stringify(st, null, 1) + '\n');

function report(key, r) {
  const what = r.built ? 'construit ' + short(r.actor) : DRY ? 'valide (essai)' : 'NON construit';
  console.log(key.padEnd(30), what + (r.blocking && r.blocking.length ? ' BLOQUANT=' + JSON.stringify(r.blocking) : ''));
  if (!DRY && !r.built) throw new Error(key + ' : non construit');
}
async function build(key, recipe, at, yaw) {
  if (st.actors[key]) return st.actors[key];
  const r = await call('build', recipe, at, yaw, Object.assign({ dryRun: DRY }, AIR));
  report(key, r);
  if (r.built) { st.actors[key] = r.actor; save(); }
  return st.actors[key];
}
async function link(key, from, fromName, to, toName) {
  if (st.links[key]) return;
  if (!from || !to) { console.log(key.padEnd(30), 'saute (bout absent)'); return; }
  const r = await call('belt', REC.belt, from, fromName, { path: to, name: toName }, { dryRun: DRY });
  report(key, r);
  if (r.built) {
    if (!r.snapped || r.snapped.some((s) => s === null)) throw new Error(key + ' : bout non accroche ' + JSON.stringify(r.snapped));
    st.links[key] = r.actor; save();
  }
}
// Ligne : depart (acteur, connecteur) -> relais aux points donnes (cap = sens du flux) -> tete du module n
async function line(name, from, fromName, points, n) {
  let prev = { a: from, c: fromName };
  for (const [i, p] of points.entries()) {
    const r = await build(name + ' relais ' + i, REC.merger, { x: p[0], y: p[1], z: p[2] }, p[3]);
    await link(name + ' ' + i, prev.a, prev.c, r, 'Input1');
    prev = { a: r, c: 'Output1' };
  }
  const head = JSON.parse(fs.readFileSync(path.join(__dirname, 'module' + n + '-stators-state.json'), 'utf8')).actors['repartiteur tete bas'];
  await link(name + ' > tete module ' + n, prev.a, prev.c, head, 'Input1');
}

(async () => {
  const hub = JSON.parse(fs.readFileSync(path.join(__dirname, 'hub0-est1-state.json'), 'utf8'));
  const quais = [];
  for (const p of hub.platforms) quais.push({ p, x: (await call('pose', p)).location.x });
  quais.sort((a, b) => a.x - b.x);
  const ore = quais.slice(1);                        // le plus a l'ouest charge les stators
  const T = [];
  for (const [i, q] of ore.entries()) {
    if (!DRY && (await call('platformLoadMode', q.p)).load) throw new Error('quai x ' + Math.round(q.x) + ' en chargement');
    const c = await build('tampon ' + (i + 1), REC.container, { x: Math.round(q.x) - 300, y: Y_TAMPON, z: Z_QUAI }, 180);
    await link('quai ' + (i + 1) + ' > tampon (bas)', q.p, 'Output0', c, 'Input0');
    await link('quai ' + (i + 1) + ' > tampon (haut)', q.p, 'Output1', c, 'Input1');
    T.push(c);
  }
  // Fusionneurs de reunion (sortie au nord) : M12 au couloir de L2, M23 au couloir de L3
  const m12 = await build('fusion M12', REC.merger, { x: 122856, y: -270600, z: 449 }, NORD);
  const m23 = await build('fusion M23', REC.merger, { x: 124456, y: -270600, z: 849 }, NORD);
  await link('tampon 2 bas > M12', T[1], 'Output1', m12, 'Input1');
  await link('tampon 1 haut > M12', T[0], 'Output2', m12, 'Input3');
  await link('tampon 3 bas > M23', T[2], 'Output1', m23, 'Input1');
  await link('tampon 2 haut > M23', T[1], 'Output2', m23, 'Input3');
  // L1 : tampon 1 (bas) directement vers la tete du module 1
  await line('L1', T[0], 'Output1', [], 1);
  await line('L2', m12, 'Output1', [[122856, -273600, 449, NORD], [122856, Y_ORE(2), 449, OUEST]], 2);
  await line('L3', m23, 'Output1', [[124456, -274600, 849, NORD], [124456, -278600, 849, NORD], [124456, Y_ORE(3), 849, OUEST], [121000, Y_ORE(3), 500, OUEST]], 3);
  await line('L4', T[2], 'Output2', [[125600, -270600, 849, NORD], [125600, -274600, 849, NORD], [125600, -278600, 849, NORD], [125600, -282600, 849, NORD], [125600, -286100, 849, NORD], [125600, Y_ORE(4), 849, OUEST], [121800, Y_ORE(4), 500, OUEST]], 4);
  console.log(Object.keys(st.actors).length + ' batiments, ' + Object.keys(st.links).length + ' convoyeurs');
})().catch((e) => { console.error('ECHEC :', e.message); process.exitCode = 1; });
