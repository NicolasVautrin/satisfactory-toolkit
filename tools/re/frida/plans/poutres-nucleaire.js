// Poutres d'acier du nucleaire (utilisateur, 27/10/2026 : « ou les poutres ? », « on amene le beton ») : recette de
// l'optimiseur Molded Beam (fonderie, lue en jeu : 120 lingots d'acier + 80 betons -> 45 poutres/min). Part du nucleaire :
// 227 poutres/min (barres de plutonium) -> 5 fonderies (605 acier + 403 beton).
//  - Pile de 5 fonderies (pile.js, en l'air, pied a +64 m comme les piles des complexes sur l'eau) a l'ouest du trieur du
//    quai q3 de N211 O143 ; dos a l'est (arrivees cote conteneurs du trieur), sortie des poutres a l'ouest (vers les
//    futurs modules, libre).
//  - Acier : conteneur 1 du trieur (sorties a l'ouest) -> colonne -> tete d'arrivee de l'acier.
//  - Beton : sortie haute de l'usine de beton (fusionneur « haut beton 0 ») -> ligne principale a -5 m le long du charbon
//    puis de la conduite d'azote -> colonne -> tete d'arrivee du beton ; elle servira aussi les modules.
//  - Courant : poteau Mk3 relais au-dessus du quai q4 (35 m), relie au Mk1 2146723648 (-17 m, sud de la gare), puis
//    poteaux de la pile.
// Usage : node poutres-nucleaire.js piles [etapes] [--dry]
//         node poutres-nucleaire.js acier|colonneBeton|beton|courant [--dry]
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { call, short } = require('./client');

const DRY = process.argv.includes('--dry');
const PILE = { x: -153000, y: -214600, dessus: 6400 }; // axe de la pile (5 m a l'ouest de la tete des arrivees + 23 m)
const LV = '/Game/FactoryGame/Map/GameLevel01/Persistent_Level.Persistent_Level:PersistentLevel.';
const CONTENEUR_ACIER = LV + 'Build_StorageContainerMk2_C_2144004555'; // trieur du quai q3 de N211 O143 (sorties ouest)
const RESEAU = LV + 'Build_PowerPoleMk1_C_2146723648';                // Mk1 alimente (-148 552 ; -207 545 ; -17 m)
const REC = { belt: 'Recipe_ConveyorBeltMk6_C', lift: 'Recipe_ConveyorLiftMk6_C', merger: 'Recipe_ConveyorAttachmentMerger_C', pole: 'Recipe_PowerPoleMk3_C' };
const AIR = { ignore: ['FGCDInvalidFloor'] };
const FILE = path.join(__dirname, 'poutres-nucleaire-state.json');
const st = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : { actors: {}, links: {}, wires: {} };
const save = () => { if (!DRY) fs.writeFileSync(FILE, JSON.stringify(st, null, 1) + '\n'); };
function report(key, r) {
  console.log(key.padEnd(30), r.built ? 'construit ' + short(r.actor) : DRY ? 'valide (essai)' : 'NON construit', r.blocking && r.blocking.length ? 'BLOQUANT=' + JSON.stringify(r.blocking) : '');
  if (!DRY && !r.built) throw new Error(key + ' : non construit');
}
async function build(key, recipe, at, yaw) {
  if (st.actors[key]) return st.actors[key];
  const r = await call('build', recipe, at, yaw, Object.assign({ dryRun: DRY }, AIR));
  report(key, r);
  if (r.built) { st.actors[key] = r.actor; save(); }
  return st.actors[key] || 'PLAN:' + key;
}
async function link(key, recipe, from, fromName, to, toName) {
  if (st.links[key]) return;
  if (String(from).startsWith('PLAN:') || String(to).startsWith('PLAN:')) { console.log(key.padEnd(30), 'a construire'); return; }
  const r = await call('belt', recipe, from, fromName, { path: to, name: toName }, Object.assign({ dryRun: DRY }, recipe === REC.lift ? { snapTolerance: 400 } : {}));
  report(key, r);
  if (r.built) { if (!r.snapped || r.snapped.includes(null)) throw new Error(key + ' : bout non accroche'); st.links[key] = r.actor; save(); }
}
const pileState = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'poutres-nucleaire-pile-state.json'), 'utf8'));
const at = (x, y, z) => ({ x, y, z });

const PHASES = {
  // Acier : sortie haute du conteneur d'acier du trieur -> relais U (8,5 m, cap -90, entree par le cote est) sous la tete
  // d'arrivee -> ascenseur -> V (40 m, cap 90) -> ascenseur droit dans la tete (67 m, entree au sud). Tout a la verticale
  // de la tete (-150 700 ; -214 400) ; l'entree laterale de U evite un relais de plus (utilisateur : « y'a un ascenseur de
  // trop, le petit le plus en haut », 1re colonne a 4 relais demontee)
  async acier() {
    const head = pileState().parts['arrivee 0 pile 0'];
    const hp = (await call('pose', head)).location;
    const U = await build('acier U2', REC.merger, at(hp.x, hp.y, 850), -90);
    const V = await build('acier V2', REC.merger, at(hp.x, hp.y, 4000), 90);
    await link('conteneur > acier U2', REC.belt, CONTENEUR_ACIER, 'Output2', U, 'Input2');
    await link('acier U2 > V2', REC.lift, U, 'Output1', V, 'Input1');
    await link('acier V2 > tete', REC.lift, V, 'Output1', head, 'Input1');
  },

  // Colonne d'arrivee du beton (-151 700 ; -213 000) : pied CB a +5 m (cap -90, entree au sud : la ligne principale
  // tracee par tracer.js depuis l'usine de beton y arrive), relais CM +50 m (cap 90), sommet CT +71 m (cap -90) -> tete
  // d'arrivee du beton par le sud
  async colonneBeton() {
    const head = pileState().parts['arrivee 1 pile 0'];
    const XC = -151700, YC = -213000;
    const CB = await build('beton pied', REC.merger, at(XC, YC, 500), -90);
    const CM = await build('beton relais', REC.merger, at(XC, YC, 5000), 90);
    const CT = await build('beton sommet', REC.merger, at(XC, YC, 7100), -90);
    await link('beton pied > relais', REC.lift, CB, 'Output1', CM, 'Input1');
    await link('beton relais > sommet', REC.lift, CM, 'Output1', CT, 'Input1');
    await link('beton sommet > tete', REC.belt, CT, 'Output1', head, 'Input1');
  },

  // Ligne principale du beton (utilisateur : « t'as juste a suivre le charbon », puis « t'as qu'a suivre le pipe
  // d'azote » ; tracer.js refusait, grille fermee). Niveau -5 m d'un bout a l'autre :
  //  - depart par la sortie HAUTE de l'usine (+33 m ; devant la sortie basse, l'ascenseur du calcaire et la colonne
  //    d'eau refusent le convoyeur) -> D1 (-88 500 ; -149 200 ; +33), juste au nord du convoyeur de calcaire qui part a
  //    l'ouest le long de y -148 600 (+1 -> -7 m) -> ascenseur -> D2 (-5 m) ;
  //  - nord le long du charbon (x -87 700, -10 m) a x -88 500 ; passe 5 m au-dessus de sa branche ouest (y -197 000) ;
  //  - ouest le long de la conduite d'azote (y -202 300, -12 m) a y -201 600 : au nord de la conduite passe la double voie
  //    de N204 O100 (+3 m, y -203 100 / -203 600) ; rocher a x -140 000 / -143 600 (dalles de -12 a +5 m au-dessus de la
  //    conduite, une seule a -7,6 / -6,5 m sur y -201 600) ;
  //  - nord le long de x -151 700, sous les voies (+3 m), jusqu'au pied de la colonne refaite : pied -5 m (cap -90) ->
  //    C2 +35 m (cap 90) -> sommet existant +71 m (cap -90) ; ancien pied +5 m / relais +50 m demontes.
  async beton() {
    const HAUT0 = LV + 'Build_ConveyorAttachmentMerger_C_2145349864'; // usine de beton, « haut beton 0 », sortie a l'ouest
    const Z = -500, XE = -88500, YO = -201600, XO = -151700, YC = -213000;
    // 1er essai (sortie basse) : relais S0 et D1 poses, convoyeur refuse -> demontes
    if (!DRY) for (const k of ['beton S0', 'beton D1']) if (st.actors[k]) { try { await call('dismantle', st.actors[k], true); } catch (e) { /* */ } delete st.actors[k]; save(); }
    const D1 = await build('beton D1b', REC.merger, at(XE, -149200, 3300), 90);
    const D2 = await build('beton D2b', REC.merger, at(XE, -149200, Z), -90);
    await link('usine > beton D1b', REC.belt, HAUT0, 'Output1', D1, 'Input3');
    await link('beton D1b > D2b', REC.lift, D1, 'Output1', D2, 'Input1');
    // nord : relais cap -90, coude K1 (cap 180, entree au sud)
    let prev = D2;
    for (let k = 1; k < 12; k++) {
      const y = Math.round(-149200 + (k * (YO + 149200)) / 12);
      const r = await build('beton n' + y, REC.merger, at(XE, y, Z), -90);
      await link('beton > n' + y, REC.belt, prev, 'Output1', r, 'Input1');
      prev = r;
    }
    const K1 = await build('beton K1', REC.merger, at(XE, YO, Z), 180);
    await link('beton > K1', REC.belt, prev, 'Output1', K1, 'Input3');
    // ouest : relais cap 180, coude K2 (cap -90, entree a l'est)
    prev = K1;
    for (let k = 1; k < 14; k++) {
      const x = Math.round(XE + (k * (XO - XE)) / 14);
      const r = await build('beton o' + x, REC.merger, at(x, YO, Z), 180);
      await link('beton > o' + x, REC.belt, prev, 'Output1', r, 'Input1');
      prev = r;
    }
    const K2 = await build('beton K2', REC.merger, at(XO, YO, Z), -90);
    await link('beton > K2', REC.belt, prev, 'Output1', K2, 'Input2');
    // nord jusqu'a la colonne : 2 relais (y -205 400, -209 200)
    prev = K2;
    for (const y of [-205400, -209200]) {
      const r = await build('beton c' + y, REC.merger, at(XO, y, Z), -90);
      await link('beton > c' + y, REC.belt, prev, 'Output1', r, 'Input1');
      prev = r;
    }
    // ancienne colonne : pied (+5 m) et relais (+50 m) demontes, sommet (+71 m) garde
    if (!DRY && !st.colonneRefaite) {
      for (const k of ['beton pied > relais', 'beton relais > sommet']) if (st.links[k]) { try { await call('dismantle', st.links[k], true); } catch (e) { /* */ } delete st.links[k]; }
      for (const k of ['beton pied', 'beton relais']) if (st.actors[k]) { try { await call('dismantle', st.actors[k], true); } catch (e) { /* */ } delete st.actors[k]; }
      st.colonneRefaite = true; save();
      await new Promise((r) => setTimeout(r, 2500));
    }
    const CB = await build('beton pied2', REC.merger, at(XO, YC, Z), -90);
    const C2 = await build('beton relais2', REC.merger, at(XO, YC, 3500), 90);
    await link('beton > pied2', REC.belt, prev, 'Output1', CB, 'Input1');
    await link('beton pied2 > relais2', REC.lift, CB, 'Output1', C2, 'Input1');
    await link('beton relais2 > sommet', REC.lift, C2, 'Output1', st.actors['beton sommet'], 'Input1');
  },

  // Courant : poteau relais au-dessus du quai q4, relie au reseau, puis poteaux de la pile (pile.js courant)
  async courant() {
    const P = await build('poteau relais', REC.pole, at(-150000, -212000, 3500), 0);
    if (!DRY && !st.wires.relais) {
      const w = await call('wire', RESEAU, P, {});
      report('cable reseau > relais', w);
      st.wires.relais = w.actor || true; save();
    }
    if (DRY) return;
    const file = path.join(__dirname, 'poutres-nucleaire-config-state.json');
    const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
    cfg.reseau = P;
    fs.writeFileSync(file, JSON.stringify(cfg, null, 1) + '\n');
    const out = execFileSync(process.execPath, [path.join(__dirname, 'pile.js'), 'courant', '--config', file], { encoding: 'utf8', maxBuffer: 64 << 20 });
    const bad = out.split('\n').filter((l) => /NON|ECHEC|BLOQUANT/.test(l));
    console.log('pile courant'.padEnd(30), bad.length ? bad.join(' / ') : 'ok');
  },
  // Pile de fonderies (configuration ecrite ici, etat poutres-nucleaire-pile-state.json)
  async piles() {
    const steps = (process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : 'machines,raccords,branches,ascenseurs,arrivees,collecteur,recettes').split(',');
    const nom = 'poutres-nucleaire', file = path.join(__dirname, nom + '-config-state.json');
    const cfg = {
      nom, recette: 'Recipe_Alternate_SteelBeam_Molded_C',
      plateforme: { origine: { x: PILE.x, y: PILE.y }, cap: 0, dessus: PILE.dessus },
      dos: 'x', centre: [0, 0], piles: 1, etages: 5, pas: 16, espacement: 10,
      // acier a +3 m, beton a +7 m, toutes deux depuis le sud (le beton vient du sud-est)
      arrivees: [{ entree: 'Input0', hauteur: 3, sens: '-lx' }, { entree: 'Input1', hauteur: 7, sens: '-lx' }],
      collecteur: { sens: '-lx' }, enLAir: true,
      poteaux: [[0, 17], [0, 21]],
    };
    fs.writeFileSync(file, JSON.stringify(cfg, null, 1) + '\n');
    for (const s of steps) {
      const out = execFileSync(process.execPath, [path.join(__dirname, 'pile.js'), s, '--config', file].concat(DRY ? ['--dry'] : []), { encoding: 'utf8', maxBuffer: 64 << 20 });
      const bad = out.split('\n').filter((l) => /NON|ECHEC|BLOQUANT/.test(l));
      console.log(('pile ' + s).padEnd(24), bad.length ? bad.length + ' : ' + bad.slice(0, 3).join(' / ') : 'ok');
      if (s === 'plan') process.stdout.write(out);
    }
  },
};

const phase = process.argv[2];
if (!PHASES[phase]) {
  console.error('usage : node poutres-nucleaire.js <' + Object.keys(PHASES).join('|') + '> [etapes] [--dry]');
  process.exit(2);
}
PHASES[phase]().catch((e) => { console.error('ECHEC :', e.message); process.exitCode = 1; });
