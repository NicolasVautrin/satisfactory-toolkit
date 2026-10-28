// Bloc de fonderies de lingots d'acier compacte, au-dessus des generateurs du module 1 de carburant pour fusees
// (utilisateur, 27/10/2026 : « je ferais bien les fonderies au dessus des generateurs », « tu fais un bloc fonderie pas
// un bloc par module rocket fuel », « essaye de compacter au maximum comme on a fait pour le rocket fuel », « fais les
// 200 fonderies, mais on les fera pas toutes tourner, au moins la place sera reservee »).
// Recette de l'optimiseur (sinkAnalysis_163330) : Compacted Steel Ingot (fonderie), 5 minerais de fer + 2,5 charbons
// compactes -> 10 lingots par fonderie.
//  - Plan global : 200 fonderies (1 000 minerais + 500 charbons compactes -> 2 000 lingots/min). Elles tournent a la
//    mesure du charbon compacte arrive (part du nucleaire : 605 lingots, 151 charbons compactes).
//  - 2 rangees est-ouest de 10 piles de 10 posees en l'air par pile.js, pied a +92 m (au-dessus des generateurs de
//    +64 m et des boites de 72 a 90,6 m sous leur centre), au bord sud du champ de generateurs du module 1, cote gares
//    (utilisateur : « le bord sud, cote gares ») : arrivees de la rangee S a y -271 600, centre (64 400 ; -276 800).
//  - Fonderie lue en jeu : entrees 8 m derriere le centre, sortie 8 m devant ; arrivees 28 m derriere l'axe, collecteur
//    20 m devant. Les rangees se font face, axes a 24 m du milieu : collecteurs au milieu, 8 m l'un de l'autre, vers
//    l'est (gare N266 E126 h3, q3 « lingots d'acier ») ; arrivees a l'exterieur : minerai a +3 m depuis l'est (gare
//    N266 E102 h0), charbon compacte a +7 m depuis l'ouest (sorties des modules de carburant, x 52 800).
//  - Charbon compacte (phase charbon) : tronc a -16 m le long de x 51 700 (sortie du module 2 au nord, puis du module 1 ;
//    entree nord du premier relais libre pour les modules 3 a 5) -> repartiteur intelligent (utilisateur : « un smart
//    splitter sur l'arrivee du charbon compacte qui redirigera l'overflow vers un broyeur ») : centre vers les fonderies,
//    trop-plein a l'ouest vers un broyeur -> colonne au meme point (-16 -> +20 -> +56 -> +92 -> +99 m) -> repartiteur :
//    est vers la tete de la rangee N, sud vers celle de la rangee S.
//  - Minerai (phase minerai) : quai q1 de N266 E102 h0 -> tampon (conteneur, comme au q3) -> ses deux sorties reunies et
//    montees au meme point (100 301 ; -268 900 : 4,5 -> 8,5 -> 56,5 -> 97 m) -> couloir le long des gares (y -268 000,
//    +97 m) vers l'ouest -> x 74 500 vers le nord : repartiteur vers la tete de S, puis tete de N.
//  - Lingots (phase lingots) : sorties des deux collecteurs reunies a l'est du bloc (+93 m ; une ligne Mk6, 1 200/min,
//    l'entree basse du tampon reste libre pour une seconde) -> x 76 000 vers le sud -> couloir vers l'est (+93 m, 4 m sous
//    le minerai) -> descente en (122 456 ; -269 300) -> tampon du quai q3 de N266 E126 h3 (comme au q4) -> quai.
//    Couloir releve libre au-dessus de 30 m entre y -267 200 et -268 800 (scratch bande-gares.js, 27/10/2026).
// Usage : node acier-compacte.js piles [etapes,separees,par,virgules] [--rangee=N|S] [--dry]
//         node acier-compacte.js charbon|minerai|lingots [--dry]
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { call, short } = require('./client');

const DRY = process.argv.includes('--dry');
const AIR = { ignore: ['FGCDInvalidFloor'] };
const REC = {
  belt: 'Recipe_ConveyorBeltMk6_C', lift: 'Recipe_ConveyorLiftMk6_C', merger: 'Recipe_ConveyorAttachmentMerger_C',
  splitter: 'Recipe_ConveyorAttachmentSplitter_C', smart: 'Recipe_ConveyorAttachmentSplitterSmart_C', sink: 'Recipe_ResourceSink_C',
};
// Etat des lignes (non versionne) ; les piles ont le leur (acier-compacte-<rangee>-pile-state.json)
const FILE = path.join(__dirname, 'acier-compacte-state.json');
const st = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : { actors: {}, links: {}, wires: {} };
const save = () => { if (!DRY) fs.writeFileSync(FILE, JSON.stringify(st, null, 1) + '\n'); };
function report(key, r) {
  const what = r.built ? 'construit ' + short(r.actor) : DRY ? 'valide (essai)' : 'NON construit';
  console.log(key.padEnd(34), what + (r.blocking && r.blocking.length ? ' BLOQUANT=' + JSON.stringify(r.blocking) : ''));
  if (!DRY && !r.built) throw new Error(key + ' : non construit');
}
async function build(key, recipe, at, yaw) {
  if (st.actors[key]) return st.actors[key];
  const r = await call('build', recipe, at, yaw, Object.assign({ dryRun: DRY }, AIR));
  report(key, r);
  if (r.built) { st.actors[key] = r.actor; save(); }
  return st.actors[key] || (DRY ? 'PLAN:' + key : null);
}
async function link(key, recipe, from, fromName, to, toName, opts) {
  if (st.links[key]) return st.links[key];
  if (String(from).startsWith('PLAN:') || String(to).startsWith('PLAN:')) { console.log(key.padEnd(34), 'a construire (bouts planifies)'); return null; }
  const r = await call('belt', recipe, from, fromName, { path: to, name: toName }, Object.assign({ dryRun: DRY }, opts || {}));
  report(key, r);
  if (r.built) {
    if (!r.snapped || r.snapped.some((s) => s === null)) throw new Error(key + ' : bout non accroche ' + JSON.stringify(r.snapped));
    st.links[key] = r.actor; save();
  }
  return st.links[key];
}
const pileState = (k) => JSON.parse(fs.readFileSync(path.join(__dirname, 'acier-compacte-' + k + '-pile-state.json'), 'utf8'));
const fuelState = (m) => JSON.parse(fs.readFileSync(path.join(__dirname, 'carburant-fusee-m' + m + '-state.json'), 'utf8'));
// Tete d'une ligne d'arrivee de pile.js (arrivee 0 = minerai, 1 = charbon compacte ; Input1 libre) et sortie de l'atelier
// (dernier fusionneur du collecteur, Output1 libre) : pile 0 en tete d'un flux vers +lx, pile 9 vers -lx
const endPile = (sens, first) => ((sens === '+lx') === first ? 0 : PILES.length - 1);
const feedHead = (k, i) => pileState(k).parts['arrivee ' + i + ' pile ' + endPile(i === 0 ? ouest(RANGEES[k]) : RANGEES[k].est, true)];
const collectorEnd = (k) => pileState(k).parts['collecteur pile ' + endPile(RANGEES[k].est, false)];
const ONLY = (process.argv.find((a) => a.startsWith('--rangee=')) || '').split('=')[1];
const CX = 64400, CY = -276800;              // centre du bloc (arrivees de S au bord sud du champ, y -271 600)
const TOP = 9200;                            // pied des piles (+92 m)
const HALF = 2400;                           // axe des machines a 24 m du milieu
const PILES = [-72, -56, -40, -24, -8, 8, 24, 40, 56, 72]; // lx des 10 piles (pas de 16 m), repere de la rangee
// Rangees : N regarde le sud (dos au nord), S regarde le nord. Repere de la rangee : ly vers l'avant, lx a -90 de ly
// (N : +lx = est ; S : +lx = ouest)
// reseau : poteau du module 1 a +64 m au plus pres du premier poteau de la rangee (pile 0 : ouest pour N, est pour S ;
// carburant-fusee-m1-state.json : GR haut 1 a 66 m, G haut 0 0 a 37 m)
const LV = '/Game/FactoryGame/Map/GameLevel01/Persistent_Level.Persistent_Level:PersistentLevel.';
const RANGEES = {
  N: { y: CY - HALF, dos: '-y', est: '+lx', reseau: LV + 'Build_PowerPoleMk3_C_2144561346' },
  S: { y: CY + HALF, dos: 'y', est: '-lx', reseau: LV + 'Build_PowerPoleMk3_C_2144561818' },
};
const ouest = (r) => (r.est === '+lx' ? '-lx' : '+lx');

// Charbon compacte : tronc le long de XT a ZB, tri et colonne en (XT, YT)
const XT = 51700, ZB = -1600, YT = -281500;
const TRONC = [-300240, -294840, -289440, -284040]; // relais (fusionneurs au cap 90, flux vers le sud) ; 1er : module 2, dernier : module 1
const COLONNE = [2000, 5600, 9200];                 // relais de la colonne entre le tri (ZB) et la tete (TOP + 7 m)

// Minerai et lingots : quais (noms des acteurs en jeu), couloir, voies nord-sud a l'est du bloc
const QUAI_FER = LV + 'Build_TrainDockingStation_C_2145789834';     // N266 E102 h0 <- N85 E78, q1 « fer 2400/min »
const QUAI_LINGOTS = LV + 'Build_TrainDockingStation_C_2145822358'; // N266 E126 h3 -> N211 O143, q3 « lingots d'acier »
const YC = -268000, ZORE = 9700, ZING = 9300;                       // couloir ; minerai a +97 m, lingots a +93 m
const XORE = 74500, XING = 76000;                                    // voies nord-sud du minerai et des lingots
const at = (x, y, z) => ({ x, y, z });

const PHASES = {
  async minerai() {
    // colonne a 8,4 m au nord du tampon : sa boite (+-5,5 m) et la boite douce d'un fusionneur (+-2 m) ne se touchent pas
    const q = (await call('pose', QUAI_FER)).location, X0 = q.x - 300, Y0 = -269000;
    // tampon 8 m derriere le quai, au cap du quai (entrees face a ses sorties, sorties au nord a +1 et +5 m)
    const T = await build('minerai tampon', 'Recipe_StorageContainerMk2_C', at(X0, q.y - 2400, q.z), 180);
    await link('quai fer > tampon (bas)', REC.belt, QUAI_FER, 'Output0', T, 'Input0');
    await link('quai fer > tampon (haut)', REC.belt, QUAI_FER, 'Output1', T, 'Input1');
    // reunion et montee au meme point : L (cap 0, la sortie basse par le sud) -> M (cap -90, la sortie haute par
    // l'arriere, L par l'est) -> W (cap 90, 47 m plus haut : ascenseurs de 48 m au plus) -> X (cap 180, par le sud,
    // sortie a l'ouest)
    const L = await build('minerai L', REC.merger, at(X0, Y0, q.z + 100), 0);
    const M = await build('minerai M', REC.merger, at(X0, Y0, q.z + 500), -90);
    const W = await build('minerai W', REC.merger, at(X0, Y0, q.z + 5200), 90);
    const X = await build('minerai X', REC.merger, at(X0, Y0, ZORE), 180);
    await link('tampon > minerai L', REC.belt, T, 'Output1', L, 'Input2');
    await link('tampon > minerai M', REC.belt, T, 'Output2', M, 'Input1');
    await link('minerai L > M', REC.lift, L, 'Output1', M, 'Input2', { snapTolerance: 400 });
    await link('minerai M > W', REC.lift, M, 'Output1', W, 'Input1', { snapTolerance: 400 });
    await link('minerai W > X', REC.lift, W, 'Output1', X, 'Input3', { snapTolerance: 400 });
    // couloir vers l'ouest (relais au cap 180), coude vers le nord en XORE (cap -90, par l'est)
    let prev = X;
    for (const x of [95500, 90200, 84900, 79600]) {
      const r = await build('minerai couloir ' + x, REC.merger, at(x, YC, ZORE), 180);
      await link('minerai > couloir ' + x, REC.belt, prev, 'Output1', r, 'Input1');
      prev = r;
    }
    const C = await build('minerai coude', REC.merger, at(XORE, YC, ZORE), -90);
    await link('minerai > coude', REC.belt, prev, 'Output1', C, 'Input2');
    // repartiteur a la hauteur de la tete de S (ouest : Output3), relais, coude vers l'ouest a la hauteur de celle de N
    const yS = (await call('connections', feedHead('S', 0))).find((c) => c.name === 'Input1').location.y;
    const yN = (await call('connections', feedHead('N', 0))).find((c) => c.name === 'Input1').location.y;
    const S = await build('minerai S', REC.splitter, at(XORE, yS, ZORE), -90);
    await link('minerai coude > S', REC.belt, C, 'Output1', S, 'Input1');
    await link('minerai S > tete S', REC.belt, S, 'Output3', feedHead('S', 0), 'Input1');
    const R = await build('minerai N relais', REC.merger, at(XORE, -277000, ZORE), -90);
    const N = await build('minerai N coude', REC.merger, at(XORE, yN, ZORE), 180);
    await link('minerai S > N relais', REC.belt, S, 'Output1', R, 'Input1');
    await link('minerai N relais > coude', REC.belt, R, 'Output1', N, 'Input3');
    await link('minerai N coude > tete N', REC.belt, N, 'Output1', feedHead('N', 0), 'Input1');
  },

  async lingots() {
    const q = (await call('pose', QUAI_LINGOTS)).location;
    // reunion des deux collecteurs a l'est du bloc, au milieu (cap 0 : S par le sud, N par le nord)
    const J = await build('lingots jonction', REC.merger, at(73300, CY, ZING), 0);
    await link('collecteur S > jonction', REC.belt, collectorEnd('S'), 'Output1', J, 'Input2');
    await link('collecteur N > jonction', REC.belt, collectorEnd('N'), 'Output1', J, 'Input3');
    // voie XING vers le sud (coude cap 90 par l'ouest, relais), coude vers l'est dans le couloir (cap 0, par le nord)
    const A = await build('lingots coude nord', REC.merger, at(XING, CY, ZING), 90);
    await link('jonction > coude nord', REC.belt, J, 'Output1', A, 'Input2');
    const B = await build('lingots relais voie', REC.merger, at(XING, (CY + YC) / 2, ZING), 90);
    await link('coude nord > relais voie', REC.belt, A, 'Output1', B, 'Input1');
    const C = await build('lingots coude couloir', REC.merger, at(XING, YC, ZING), 0);
    await link('relais voie > coude couloir', REC.belt, B, 'Output1', C, 'Input3');
    // couloir vers l'est (relais au cap 0)
    let prev = C;
    for (const x of [81300, 86600, 91900, 97200, 102500, 107800, 113100, 118400]) {
      const r = await build('lingots couloir ' + x, REC.merger, at(x, YC, ZING), 0);
      await link('lingots > couloir ' + x, REC.belt, prev, 'Output1', r, 'Input1');
      prev = r;
    }
    // descente au nord du tampon : D1 (cap 90, par l'ouest) -> ascenseur au sud -> D2 (cap -90) -> ascenseur au nord ->
    // D3 (cap 90, sortie au sud vers le tampon). Ascenseurs au sud et au nord de la colonne : a l'est, un fusionneur
    // existant (123 000 ; -269 200 ; +64 m) gene
    const XT2 = q.x + 300, YD = -269300;
    const D1 = await build('lingots descente 1', REC.merger, at(XT2, YD, ZING), 90);
    await link('lingots > descente', REC.belt, prev, 'Output1', D1, 'Input2');
    const T = await build('lingots tampon', 'Recipe_StorageContainerMk2_C', at(XT2, q.y - 2300, q.z), 0);
    const D2 = await build('lingots descente 2', REC.merger, at(XT2, YD, 4500), -90);
    const D3 = await build('lingots descente 3', REC.merger, at(XT2, YD, q.z + 500), 90);
    await link('lingots descente 1 > 2', REC.lift, D1, 'Output1', D2, 'Input1', { snapTolerance: 400 });
    await link('lingots descente 2 > 3', REC.lift, D2, 'Output1', D3, 'Input1', { snapTolerance: 400 });
    await link('lingots > tampon', REC.belt, D3, 'Output1', T, 'Input1');
    await link('tampon > quai lingots (bas)', REC.belt, T, 'Output1', QUAI_LINGOTS, 'Input0');
    await link('tampon > quai lingots (haut)', REC.belt, T, 'Output2', QUAI_LINGOTS, 'Input1');
  },

  async charbon() {
    const m1 = fuelState(1).actors['compacte sortie'], m2 = fuelState(2).actors['compacte sortie'];
    // tronc : sortie du module 2 sur le 1er relais, du module 1 sur le dernier (entrees est) ; relais chaines vers le sud
    const R = [];
    for (const [i, y] of TRONC.entries()) R.push(await build('charbon tronc ' + i, REC.merger, { x: XT, y, z: ZB }, 90));
    await link('charbon m2 > tronc', REC.belt, m2, 'Output1', R[0], 'Input3');
    for (let i = 1; i < R.length; i++) await link('charbon tronc ' + (i - 1) + ' > ' + i, REC.belt, R[i - 1], 'Output1', R[i], 'Input1');
    await link('charbon m1 > tronc', REC.belt, m1, 'Output1', R[R.length - 1], 'Input3');
    // tri : centre (Output1, sud) vers la colonne, trop-plein (Output2, ouest) vers le broyeur (entree a l'est, cap -90)
    const T = await build('charbon tri', REC.smart, { x: XT, y: YT, z: ZB }, 90);
    await link('charbon tronc > tri', REC.belt, R[R.length - 1], 'Output1', T, 'Input1');
    const B = await build('charbon broyeur', REC.sink, { x: XT - 2100, y: YT, z: ZB }, -90);
    await link('charbon tri > broyeur', REC.belt, T, 'Output2', B, 'Input0');
    if (!DRY && !st.rules) { const r = await call('smartRules', T, [{ item: 'any', output: 0 }, { item: 'overflow', output: 1 }]); console.log('regles du tri'.padEnd(34), JSON.stringify(r).slice(0, 120)); st.rules = true; save(); }
    // colonne au meme point : fusionneurs aux caps alternes (-90 / 90), ascenseurs du cote de la sortie du precedent
    let prev = T, yaw = 90;
    for (const [i, z] of COLONNE.entries()) {
      yaw = -yaw;
      const c = await build('charbon colonne ' + i, REC.merger, { x: XT, y: YT, z }, yaw);
      await link('charbon colonne ' + i + ' ascenseur', REC.lift, prev, 'Output1', c, 'Input1', { snapTolerance: 400 });
      prev = c;
    }
    // tete (+99 m, cap 90) : est (Output3) vers la rangee N, sud (Output1) vers la rangee S par deux relais
    const H = await build('charbon tete', REC.splitter, { x: XT, y: YT, z: TOP + 700 }, -yaw);
    await link('charbon tete ascenseur', REC.lift, prev, 'Output1', H, 'Input1', { snapTolerance: 400 });
    await link('charbon tete > N', REC.belt, H, 'Output3', feedHead('N', 1), 'Input1');
    const yS = (await call('connections', feedHead('S', 1))).find((c) => c.name === 'Input1').location.y;
    const S1 = await build('charbon S relais', REC.merger, { x: XT, y: (YT + yS) / 2, z: TOP + 700 }, 90);
    const S2 = await build('charbon S coude', REC.merger, { x: XT, y: yS, z: TOP + 700 }, 0);
    await link('charbon tete > S relais', REC.belt, H, 'Output1', S1, 'Input1');
    await link('charbon S relais > coude', REC.belt, S1, 'Output1', S2, 'Input3');
    await link('charbon S coude > S', REC.belt, S2, 'Output1', feedHead('S', 1), 'Input1');
    // courant du broyeur : poteau du module 1 le plus proche ayant une connexion libre
    if (!st.wires['broyeur'] && !String(B).startsWith('PLAN:')) {
      const bl = (await call('pose', B)).location, cands = [];
      for (const [k, a] of Object.entries(fuelState(1).actors)) {
        if (!/^poteau/.test(k)) continue;
        const l = (await call('pose', a)).location, info = await call('power', a);
        if (info.wires < info.maxWires) cands.push({ a, d: Math.hypot(l.x - bl.x, l.y - bl.y, l.z - bl.z) });
      }
      cands.sort((p, q) => p.d - q.d);
      if (!cands.length || cands[0].d > 9500) throw new Error('broyeur : aucun poteau libre a moins de 95 m (' + (cands[0] ? Math.round(cands[0].d / 100) + ' m' : '-') + ')');
      const r = await call('wire', cands[0].a, B, { dryRun: DRY });
      report('cable broyeur (' + Math.round(cands[0].d / 100) + ' m)', r);
      if (r.built) { st.wires['broyeur'] = r.actor || true; save(); }
    }
  },

  // Piles de fonderies (configuration ecrite ici, etat acier-compacte-<rangee>-pile-state.json)
  async piles() {
    const steps = (process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : 'machines,raccords,branches,ascenseurs,arrivees,collecteur,recettes').split(',');
    for (const [k, r] of Object.entries(RANGEES)) {
      if (ONLY && ONLY !== k) continue;
      const nom = 'acier-compacte-' + k, file = path.join(__dirname, nom + '-config-state.json');
      const cfg = {
        nom, recette: 'Recipe_Alternate_IngotSteel_2_C',
        plateforme: { origine: { x: CX, y: r.y }, cap: 0, dessus: TOP },
        dos: r.dos, centre: [0, 0], piles: PILES.length, etages: 10, pas: 16, espacement: 10,
        // minerai depuis l'est (flux vers l'ouest), charbon compacte depuis l'ouest (flux vers l'est)
        arrivees: [{ entree: 'Input0', hauteur: 3, sens: ouest(r) }, { entree: 'Input1', hauteur: 7, sens: r.est }],
        collecteur: { sens: r.est }, enLAir: true, reseau: r.reseau,
        // deux poteaux par pile (5 etages chacun), entre les fusionneurs du pied (14 m) et le collecteur (20 m) et juste
        // devant lui, comme les piles de fonderies du module alu ; cables de 92 m au plus jusqu'a l'etage du haut. Ordre de
        // pile.js : un poteau par pile (etages du bas), puis le second de chaque pile (etages du haut)
        poteaux: PILES.map((lx) => [lx, 17]).concat(PILES.map((lx) => [lx, 21])),
      };
      fs.writeFileSync(file, JSON.stringify(cfg, null, 1) + '\n');
      for (const s of steps) {
        const out = execFileSync(process.execPath, [path.join(__dirname, 'pile.js'), s, '--config', file].concat(DRY ? ['--dry'] : []), { encoding: 'utf8', maxBuffer: 64 << 20 });
        const bad = out.split('\n').filter((l) => /NON|ECHEC|BLOQUANT/.test(l));
        console.log(('piles ' + k + ' ' + s).padEnd(30), bad.length ? bad.length + ' : ' + bad.slice(0, 3).join(' / ') : 'ok');
        if (s === 'plan') process.stdout.write(out);
      }
    }
  },
};

const phase = process.argv[2];
if (!PHASES[phase]) {
  console.error('usage : node acier-compacte.js <' + Object.keys(PHASES).join('|') + '> [etapes] [--rangee=N|S] [--dry]');
  process.exit(2);
}
PHASES[phase]().catch((e) => { console.error('ECHEC :', e.message); process.exitCode = 1; });
