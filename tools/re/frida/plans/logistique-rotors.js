// Logistique des rotors a la gare hub0-est2 (rotors deplaces au nord de cette gare, accord utilisateur 22/10/2026) :
//  - quai 95 201 : CHARGEMENT des rotors, sans tampon (faible debit, comme les stators) ; quais 96 801 (fer) et 98 401
//    (cuivre) : DECHARGEMENT, tampon = conteneur industriel au niveau du quai, entrees face aux sorties du quai ;
//  - fer : couloir y -268 800 vers l'ouest (emplacement 1 a +4,5 m, emplacement 2 a +8,5 m), remontee par x 76 500,
//    entree dans la tete de fer par l'ouest ; cuivre : emplacement 1 par le couloir y -269 400 (6 m du fer), puis sa tete ;
//    emplacement 2 par le couloir x 97 100 (entre rotors et stators) puis y -274 900, arrivee par l'est ;
//  - rotors : A (+65 m) et C (+65 m, par un tronc a x 92 000) -> relais VA -> ascenseur de 47 m -> D2 (+17,5 m) ->
//    entree basse du quai ; B (+125 m) -> 3 ascenseurs a x 93 600 -> VB4 (+17,5 m) -> entree haute du quai.
// Relais = fusionneurs (une entree utilisee), tous les 40 m au plus (convoyeurs de 56 m au plus).
// usage : node logistique-rotors.js [--dry]       Etat : logistique-rotors-state.json (non versionne)
'use strict';

const fs = require('fs');
const path = require('path');
const { call, short } = require('./client');

const DRY = process.argv.includes('--dry');
const AIR = { ignore: ['FGCDInvalidFloor'] };
const REC = { container: 'Recipe_StorageContainerMk2_C', merger: 'Recipe_ConveyorAttachmentMerger_C', belt: 'Recipe_ConveyorBeltMk6_C', lift: 'Recipe_ConveyorLiftMk6_C' };
const NORD = -90, SUD = 90, OUEST = 180, EST = 0;
const LIFT = { snapTolerance: 400 };

const FILE = path.join(__dirname, 'logistique-rotors-state.json');
const st = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : {};
for (const k of ['actors', 'links']) st[k] = st[k] || {};
const save = () => fs.writeFileSync(FILE, JSON.stringify(st, null, 1) + '\n');
const js = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, f), 'utf8'));

function report(key, r) {
  const what = r.built ? 'construit ' + short(r.actor) : DRY ? 'valide (essai)' : 'NON construit';
  console.log(key.padEnd(30), what + (r.blocking && r.blocking.length ? ' BLOQUANT=' + JSON.stringify(r.blocking) : ''));
  if (!DRY && !r.built) throw new Error(key + ' : non construit');
}
async function build(key, recipe, at, yaw) {
  if (st.actors[key]) return st.actors[key];
  const r = await call('build', recipe, { x: at[0], y: at[1], z: at[2] }, yaw, Object.assign({ dryRun: DRY }, AIR));
  report(key, r);
  if (r.built) { st.actors[key] = r.actor; save(); }
  return st.actors[key];
}
async function link(key, recipe, from, fromName, to, toName, opts) {
  if (st.links[key]) return;
  if (!from || !to) { console.log(key.padEnd(30), 'saute (bout absent)'); return; }
  const r = await call('belt', recipe, from, fromName, { path: to, name: toName }, Object.assign({ dryRun: DRY }, opts || {}));
  report(key, r);
  if (r.built) {
    if (!r.snapped || r.snapped.some((s) => s === null)) throw new Error(key + ' : bout non accroche ' + JSON.stringify(r.snapped));
    st.links[key] = r.actor; save();
  }
}
// Ligne : depart -> relais [x, y, z, cap] -> arrivee (acteur, connecteur)
async function line(name, from, fromName, points, to, toName) {
  let prev = { a: from, c: fromName };
  for (const [i, p] of points.entries()) {
    const r = await build(name + ' relais ' + i, REC.merger, p, p[3]);
    await link(name + ' ' + i, REC.belt, prev.a, prev.c, r, 'Input1');
    prev = { a: r, c: 'Output1' };
  }
  await link(name + ' > arrivee', REC.belt, prev.a, prev.c, to, toName);
}

(async () => {
  const hub = js('hub0-est2-state.json');
  const quais = [];
  for (const p of hub.platforms) quais.push({ p, x: Math.round((await call('pose', p)).location.x) });
  const Q = (x) => quais.find((q) => q.x === x).p;
  const qRot = Q(95201), qFer = Q(96801), qCu = Q(98401);
  if (!DRY) {
    await call('platformLoadMode', qRot, true);
    await call('platformLoadMode', qFer, false);
    await call('platformLoadMode', qCu, false);
    console.log('quais : 95 201 chargement (rotors), 96 801 et 98 401 dechargement (fer, cuivre)');
  }
  // tampons
  const tFer = await build('tampon fer', REC.container, [96501, -268161, 349], 180);
  const tCu = await build('tampon cuivre', REC.container, [98101, -268161, 349], 180);
  await link('quai fer > tampon (bas)', REC.belt, qFer, 'Output0', tFer, 'Input0');
  await link('quai fer > tampon (haut)', REC.belt, qFer, 'Output1', tFer, 'Input1');
  await link('quai cuivre > tampon (bas)', REC.belt, qCu, 'Output0', tCu, 'Input0');
  await link('quai cuivre > tampon (haut)', REC.belt, qCu, 'Output1', tCu, 'Input1');
  const r1 = js('rotors1-state.json'), r2 = js('rotors2-state.json');
  // fer
  const corFer = (z) => [[94000, -268800, z, OUEST], [90000, -268800, z, OUEST], [86000, -268800, z, OUEST], [82000, -268800, z, OUEST], [78000, -268800, z, OUEST]];
  await line('fer 1', tFer, 'Output1', corFer(449).concat([[76500, -268800, 449, NORD], [76500, -270100, 300, EST]]), r1.actors['tete fer bas'], 'Input1');
  await line('fer 2', tFer, 'Output2', corFer(849).concat([[76500, -268800, 849, NORD], [76500, -272500, 849, NORD], [76500, -276100, 500, EST]]), r2.actors['tete fer bas'], 'Input1');
  // cuivre
  await line('cuivre 1', tCu, 'Output1', [[96000, -269400, 449, OUEST], [92000, -269400, 449, OUEST], [88000, -269400, 449, OUEST]], r1.actors['tete cuivre bas'], 'Input1');
  await line('cuivre 2', tCu, 'Output2', [[97100, -270600, 849, NORD], [97100, -274900, 849, OUEST], [93000, -274900, 700, OUEST], [89000, -274900, 500, OUEST]], r2.actors['tete cuivre bas'], 'Input1');
  // rotors : A + C -> VA -> D2 -> entree basse ; B -> VB1..VB4 -> entree haute
  const out = (e, u) => js('rotors' + e + '-' + u + '-R-pile-state.json').parts['collecteur pile 0'];
  const va = await build('VA', REC.merger, [92000, -269200, 6449], EST);
  const d2 = await build('D2', REC.merger, [92000, -269200, 1749], SUD);
  const vc = await build('VC', REC.merger, [92000, -275200, 6449], SUD);
  const k = await build('K', REC.merger, [92000, -272200, 6449], SUD);
  await link('rotors A > VA', REC.belt, out(1, 'A'), 'Output1', va, 'Input1');
  await link('rotors C > VC', REC.belt, out(2, 'C'), 'Output1', vc, 'Input2');
  await link('rotors VC > K', REC.belt, vc, 'Output1', k, 'Input1');
  await link('rotors K > VA', REC.belt, k, 'Output1', va, 'Input3');
  await link('rotors VA > D2', REC.lift, va, 'Output1', d2, 'Input3', LIFT);
  await link('rotors D2 > quai', REC.belt, d2, 'Output1', qRot, 'Input0');
  const vb1 = await build('VB1', REC.merger, [93600, -269200, 12449], EST);
  const vb2 = await build('VB2', REC.merger, [93600, -269200, 7649], NORD);
  const vb3 = await build('VB3', REC.merger, [93600, -269200, 2849], SUD);
  const vb4 = await build('VB4', REC.merger, [93600, -269200, 1749], EST);
  await link('rotors B > VB1', REC.belt, out(1, 'B'), 'Output1', vb1, 'Input1');
  await link('rotors VB1 > VB2', REC.lift, vb1, 'Output1', vb2, 'Input2', LIFT);
  await link('rotors VB2 > VB3', REC.lift, vb2, 'Output1', vb3, 'Input1', LIFT);
  await link('rotors VB3 > VB4', REC.lift, vb3, 'Output1', vb4, 'Input2', LIFT);
  await link('rotors VB4 > quai', REC.belt, vb4, 'Output1', qRot, 'Input1');
  console.log(Object.keys(st.actors).length + ' batiments, ' + Object.keys(st.links).length + ' convoyeurs / ascenseurs');
})().catch((e) => { console.error('ECHEC :', e.message); process.exitCode = 1; });
