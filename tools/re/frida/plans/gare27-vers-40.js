// Gare 27 en dechargement du couple 40 -> 27 (utilisateur 23/10/2026 : option 1, « vas-y ») : quais depuis le batiment
// comme la 40 : q1 caterium, q2 cuivre, q3 fer, q4 fer. Les tampons restent devant leurs quais ; on refait les raccords
// en SORTIE des tampons (les entrees regardent leur quai) :
//  - T1 (quai 3, fer) : L1 et M12 (L2), inchanges ;
//  - T4 (quai 4, fer) : nouveau tampon en l'air (pas de fondations) ; Output2 -> relais F3a / F3b a 11 m -> M23.Input1
//    (L3) ; Output1 -> ascenseur jusqu'a 14 m -> relais F4b / F4m / F4c -> relais 0 de L4 (Input1). Lignes a 11 et 14 m :
//    au-dessus de la conduite d'eau des modules (5 m) et du convoyeur T1 -> M12 (de 8,5 a 4,5 m) ;
//  - T3 (quai 1, caterium) : Output2 -> ascenseur jusqu'a l'entree basse du tampon du quai 1 de la gare 29 ;
//  - T2 (quai 2, cuivre) : sorties liberees (ligne vers les rotors : phase a venir) ;
//  - branche morte des anciens stators (fusionneur D2 et son convoyeur vers le quai 4) retiree ; quai 4 en dechargement.
//   node gare27-vers-40.js nettoyage|tampon4|caterium|fer|verifie [--dry]
// Etat : plans/gare27-vers-40-state.json
'use strict';
const fs = require('fs');
const path = require('path');
const { call, short } = require('./client');

const DRY = process.argv.includes('--dry');
const P = '/Game/FactoryGame/Map/GameLevel01/Persistent_Level.Persistent_Level:PersistentLevel.';
const A = JSON.parse(fs.readFileSync(path.join(__dirname, 'arrivee-minerai-stators-state.json'), 'utf8'));
const T29 = JSON.parse(fs.readFileSync(path.join(__dirname, 'hub1-est1-tampons-state.json'), 'utf8')).conteneurs;
const Q4 = P + 'Build_TrainDockingStation_C_2144911315';
const T1 = A.actors['tampon 1'], T2 = A.actors['tampon 2'], T3 = A.actors['tampon 3'];
const M23 = A.actors['fusion M23'], L4R0 = A.actors['L4 relais 0'];
const REC = { container: 'Recipe_StorageContainerMk2_C', merger: 'Recipe_ConveyorAttachmentMerger_C', belt: 'Recipe_ConveyorBeltMk6_C', lift: 'Recipe_ConveyorLiftMk6_C' };
const AIR = { ignore: ['FGCDInvalidFloor'] };
// Relais : [x, y, z, cap] (cap 0 : Input1 a l'ouest, Input2 au sud, Output1 a l'est ; cap -90 : Input1 au sud,
// Input3 a l'ouest, Output1 au nord)
const R = {
  // 9,5 m et non 11 : de T4.Output2 (8,5 m) a 4,4 m de distance, monter a 11 m etait trop raide (FGCDConveyorTooSteep) ;
  // 9,5 m reste au-dessus du convoyeur T1 -> M12 (7,4 m la ou la ligne le croise)
  F3a: [119656, -269100, 950, 0], F3b: [124456, -269100, 950, -90],
  // F4m : F4b -> F4c faisait 63 m (FGCDConveyorTooLong, 56 m au plus)
  F4b: [119256, -269300, 1400, 0], F4m: [122400, -269300, 1400, 0], F4c: [125600, -269300, 1300, -90],
};
const SF = path.join(__dirname, 'gare27-vers-40-state.json');
const st = fs.existsSync(SF) ? JSON.parse(fs.readFileSync(SF, 'utf8')) : { actors: {}, links: {}, removed: {} };
const save = () => { if (!DRY) fs.writeFileSync(SF, JSON.stringify(st, null, 1)); };
const r0 = (p) => `(${Math.round(p.x)} ; ${Math.round(p.y)} ; ${(p.z / 100).toFixed(1)} m)`;

function report(key, r) {
  console.log(key.padEnd(26), r.built ? 'construit ' + short(r.actor) : DRY ? 'essai' : 'NON construit',
    r.blocking && r.blocking.length ? 'BLOQUANT ' + JSON.stringify(r.blocking) : '');
  if (!DRY && !r.built) throw new Error(key + ' : non construit');
}
async function relay(key) {
  if (st.actors[key]) return st.actors[key];
  const [x, y, z, cap] = R[key];
  const r = await call('build', REC.merger, { x, y, z }, cap, Object.assign({ dryRun: DRY }, AIR));
  report(key, r);
  if (r.built) { st.actors[key] = r.actor; save(); }
  return st.actors[key];
}
async function link(key, from, fromName, to, toName, recipe, opts) {
  if (st.links[key]) return;
  if (!from || !to) { console.log(key.padEnd(26), 'saute (bout absent, essai)'); return; }
  const r = await call('belt', recipe || REC.belt, from, fromName, { path: to, name: toName }, Object.assign({ dryRun: DRY }, opts || {}));
  report(key, r);
  if (r.built) {
    if (!r.snapped || r.snapped.some((s) => s === null)) throw new Error(key + ' : bout non accroche ' + JSON.stringify(r.snapped));
    st.links[key] = r.actor; save();
  }
}
// Ascenseur pose depuis son haut, accroche a une entree (bras du bas tourne par endScroll) ; rend le connecteur libre du bas
async function liftDown(key, to, toName, at, endZ, scroll, wantNormal) {
  if (!st.actors[key]) {
    const r = await call('belt', REC.lift, to, toName, at, { endZ, snapTolerance: 400, endScroll: scroll, dryRun: DRY });
    report(key, r);
    if (r.hologram) console.log('   hologramme', r0(r.hologram.location));
    if (!r.built) return null;
    st.actors[key] = r.actor; save();
  }
  const foot = (await call('connections', st.actors[key])).find((c) => !c.connected);
  if (!foot) return null; // deja raccorde par ses deux bouts (reprise)
  console.log('   pied', foot.name, r0(foot.location), 'normale', JSON.stringify(foot.normal, (k, v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v)));
  if (wantNormal && (foot.normal.x * wantNormal.x + foot.normal.y * wantNormal.y) < 0.9) {
    throw new Error(key + ' : bras du bas mal tourne (demonter l\'ascenseur et changer endScroll)');
  }
  return foot;
}

const PH = {
  async nettoyage() {
    const D2 = P + 'Build_ConveyorAttachmentMerger_C_2144504649', D2BELT = P + 'Build_ConveyorBeltMk6_C_2144504307';
    const list = { 'T2 bas > M12': A.links['tampon 2 bas > M12'], 'T2 haut > M23': A.links['tampon 2 haut > M23'],
      'T3 bas > M23': A.links['tampon 3 bas > M23'], 'T3 haut > L4': A.links['L4 0'], 'D2 > quai 4': D2BELT, D2 };
    for (const [k, a] of Object.entries(list)) {
      if (st.removed[k]) continue;
      if (DRY) { console.log('demonterait', k, short(a)); continue; }
      const r = await call('dismantle', a, true);
      console.log('demonte'.padEnd(10), k.padEnd(16), r.dismantled ? 'ok' : JSON.stringify(r));
      st.removed[k] = a; save();
    }
  },
  async tampon4() {
    if (!st.actors.T4) {
      const r = await call('build', REC.container, { x: 119656, y: -268161, z: 349 }, 180, Object.assign({ dryRun: DRY }, AIR));
      report('T4', r);
      if (r.built) { st.actors.T4 = r.actor; save(); }
    }
    await link('quai 4 > T4 (bas)', Q4, 'Output0', st.actors.T4, 'Input0');
    await link('quai 4 > T4 (haut)', Q4, 'Output1', st.actors.T4, 'Input1');
    if (!DRY) console.log('quai 4', JSON.stringify(await call('platformLoadMode', Q4, false)));
  },
  async caterium() {
    const box = T29['q1-caterium'];
    const input = (await call('connections', box)).find((c) => c.name === 'Input0');
    const foot = await liftDown('ascenseur caterium', box, 'Input0', { x: input.location.x, y: input.location.y - 300, z: 849 }, 849, 90, { x: -1, y: 0 });
    if (foot) await link('T3 haut > ascenseur caterium', T3, 'Output2', st.actors['ascenseur caterium'], foot.name);
  },
  async fer() {
    // L3 : T4 haut -> F3a -> F3b -> M23
    await relay('F3a'); await relay('F3b');
    await link('T4 haut > F3a', st.actors.T4, 'Output2', st.actors.F3a, 'Input2');
    await link('F3a > F3b', st.actors.F3a, 'Output1', st.actors.F3b, 'Input3');
    await link('F3b > M23', st.actors.F3b, 'Output1', M23, 'Input1');
    // L4 : T4 bas -> ascenseur (de F4b jusqu'a 4,5 m) -> F4b -> F4c -> relais 0 de L4
    await relay('F4b'); await relay('F4m'); await relay('F4c');
    if (st.actors.F4b) {
      const inp = (await call('connections', st.actors.F4b)).find((c) => c.name === 'Input2');
      const foot = await liftDown('ascenseur L4', st.actors.F4b, 'Input2', { x: inp.location.x, y: inp.location.y + 300, z: 449 }, 449, 90, { x: 1, y: 0 });
      if (foot) await link('T4 bas > ascenseur L4', st.actors.T4, 'Output1', st.actors['ascenseur L4'], foot.name);
    }
    await link('F4b > F4m', st.actors.F4b, 'Output1', st.actors.F4m, 'Input1');
    await link('F4m > F4c', st.actors.F4m, 'Output1', st.actors.F4c, 'Input3');
    await link('F4c > L4', st.actors.F4c, 'Output1', L4R0, 'Input1');
  },
  async verifie() {
    const all = Object.assign({ T1, T2, T3, M23, L4R0, Q4 }, st.actors);
    for (const [k, a] of Object.entries(all)) {
      console.log(k.padEnd(20), short(a), (await call('connections', a)).filter((c) => /Input|Output|ConveyorAny/.test(c.name)).map((c) => c.name + (c.connected ? '+' : '-')).join(' '));
    }
  },
};
if (!PH[process.argv[2]]) { console.error('usage : node gare27-vers-40.js nettoyage|tampon4|caterium|fer|verifie [--dry]'); process.exit(2); }
PH[process.argv[2]]().catch((e) => { console.error('ECHEC :', e.message); process.exitCode = 1; });
