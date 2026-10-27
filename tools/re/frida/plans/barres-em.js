// Bloc des barres EM du site nucleaire (utilisateur, 25/10/2026 : « on s'occupe des barres EM maintenant », plan valide
// par « on fait tout ») : 240 barres EM/min, bornees par les 360 stators/min de la metallurgie, et 50 limiteurs IA/min pour
// les oscillateurs (« il y a 2 gisements cat + cu a exploiter pres de la cote, ca suffira pour les limiteurs IA »).
// Meme montage que le bloc cuivre 1 (module-cuivre.js), juste a l'est de la zone nucleaire, au nord des gares N211 O119
// et N211 O96. Recettes lues en jeu, toutes en raffinerie : lingot de cuivre pur (L : 15 minerai + 10 eau -> 37,5),
// tole de cuivre a la vapeur (T : 22,5 lingots + 22,5 eau -> 22,5), lingot de caterium pur (C : 24 minerai + 24 eau -> 12).
//  - 4 bandes, rangees d'ouest en est a partir de x -134 000 (pas de 12 m), 2 etages (0 et +32 m) :
//    b1 (axe y -219 000) et b2 (y -225 400) : cuivre, 36 raffineries par rangee (22 L + 14 T ; T si k <= 1 ou
//    (k - 2) % 8 dans {2, 5, 7} : le bout est est un L, les deux T cote a cote au bout ouest) ;
//    b3 (y -231 800) : caterium, 18 C par rangee ;
//    b4 (y -238 200) : limiteurs IA des oscillateurs, 30 en bas (18 L + 12 T, meme regle), 7 C en haut au bout ouest.
//    L et C face au sud (cap 0 : minerai et eau au sud, lingots au nord), T face au nord (cap 180).
//  - lignes : au nord lingots a +1 m (vers l'ouest : fusionneurs devant les L et C, repartiteurs devant les T) et eau des
//    T a +5 m ; au sud toles a +1 m (vers l'ouest), eau des L et C a +5 m, minerai a +11 m. Lingots et toles sortent
//    libres au bout ouest, pour l'atelier.
//  - minerai : il entre au bout ouest de la rangee du bas ; b1, b2, b3 : il file vers l'est, monte de 32 m au bout est et
//    revient vers l'ouest en haut ; b4 : cuivre en bas, caterium en haut, chacun vers l'est.
//  - eau : extracteurs sous la rangee du bas (100 %), un reseau par etage et par cote ; bas : colonne directe (pompe Mk1) ;
//    haut : relais A a -7 m, colonne, relais B a +37 m (pompe Mk2), comme le bloc cuivre.
// usage : node barres-em.js <phase> [--dry]
//   phases : raffineries | recettes | extracteurs | eau | colonnes | pompes | minerai | lingots | toles | tampons |
//            troncs | cote | piles [etapes pile.js] [Q1,A1,...] | liaisons | sorties | arrivees | courant | verifie
// Etat : barres-em-state.json (non versionne).
'use strict';

const fs = require('fs');
const path = require('path');
const { call, short } = require('./client');

const DRY = process.argv.includes('--dry');
const PREFIX = '/Game/FactoryGame/Map/GameLevel01/Persistent_Level.Persistent_Level:PersistentLevel.';
// Volumes d'eau de la mer du nord (bornes lues en jeu, echelle 55) : FGWaterVolume_7 couvre x >= -110 000,
// FGWaterVolume105 l'ouest (x -307 600 .. -109 600), tous deux au nord de y -206 000
const WATER = (x) => PREFIX + (x < -110000 ? 'FGWaterVolume105' : 'FGWaterVolume_7');
const AIR = { ignore: ['FGCDInvalidFloor'] };
const SOFT = 'FGCDEncroachingSoftClearance';
const REC = {
  refinery: 'Recipe_OilRefinery_C', extractor: 'Recipe_WaterPump_C',
  junction: 'Recipe_PipelineJunction_Cross_C', pipe: 'Recipe_PipelineMK2_C',
  pump1: 'Recipe_PipelinePump_C', pump2: 'Recipe_PipelinePumpMk2_C',
  splitter: 'Recipe_ConveyorAttachmentSplitter_C', merger: 'Recipe_ConveyorAttachmentMerger_C',
  belt: 'Recipe_ConveyorBeltMk6_C', lift: 'Recipe_ConveyorLiftMk6_C',
  L: 'Recipe_Alternate_PureCopperIngot_C', T: 'Recipe_Alternate_SteamedCopperSheet_C',
  C: 'Recipe_Alternate_PureCateriumIngot_C',
};

// --- Geometrie --------------------------------------------------------------------------------------------
const XW = -134000;
const X = (k) => XW + 1200 * k;               // k = 0 a l'ouest
const T_CU = (k) => (k <= 1 || [2, 5, 7].includes((k - 2) % 8) ? 'T' : 'L');
const BANDES = { 1: -219000, 2: -225400, 3: -231800, 4: -238200 };
const ETAGES = { bas: 0, haut: 3200 };
// [id, bande, etage, nature, nombre, sens du minerai]
const ROWS = [
  ['b1 bas', 1, 'bas', 'cu', 36, 'est'], ['b1 haut', 1, 'haut', 'cu', 36, 'ouest'],
  ['b2 bas', 2, 'bas', 'cu', 36, 'est'], ['b2 haut', 2, 'haut', 'cu', 36, 'ouest'],
  ['b3 bas', 3, 'bas', 'cat', 18, 'est'], ['b3 haut', 3, 'haut', 'cat', 18, 'ouest'],
  ['b4 bas', 4, 'bas', 'cu', 30, 'est'], ['b4 haut', 4, 'haut', 'cat', 7, 'est'],
].map(([id, b, e, kind, n, flux]) => ({ id, b, e, kind, n, flux, Y: BANDES[b], Z: ETAGES[e], K: [...Array(n).keys()] }));
const TYPE = (row, k) => (row.kind === 'cat' ? 'C' : T_CU(k));
const YAW = { L: 0, T: 180, C: 0 };
const MONTEE = { 1: true, 2: true, 3: true, 4: false }; // minerai commun aux deux etages, monte au bout est
const rowOf = (b, e) => ROWS.find((r) => r.b === b && r.e === e);
// Extracteurs sous la rangee du bas : [k, etage alimente, cote de la ligne] ; x = X(k) - 600 (entre deux raffineries),
// 3 m vers leur cote, sortie vers ce cote. Reseaux : L 10 m3 et C 24 m3 au sud, T 22,5 m3 au nord, par raffinerie ;
// extracteur 120 m3/min. Jonction d'un extracteur du bas a 4 m au moins de celles des raffineries ; celle d'un extracteur
// du haut (8 m a l'ouest) peut etre celle d'une raffinerie (branche opposee).
const EXT_CU = [[2, 'bas', 'nord'], [6, 'haut', 'nord'], [9, 'bas', 'sud'], [13, 'haut', 'sud'], [16, 'bas', 'nord'],
  [20, 'haut', 'nord'], [23, 'bas', 'sud'], [27, 'haut', 'sud'], [30, 'bas', 'nord'], [34, 'haut', 'nord']];
const EXT = {
  1: EXT_CU, 2: EXT_CU,
  3: [2, 4, 6, 8, 10, 12, 14, 16].map((k, i) => [k, i % 2 ? 'haut' : 'bas', 'sud']),
  4: [[2, 'haut', 'sud'], [5, 'haut', 'sud'], [9, 'bas', 'nord'], [13, 'bas', 'sud'], [17, 'bas', 'nord'],
    [21, 'bas', 'sud'], [25, 'bas', 'nord']],
};
const exts = (b) => EXT[b].map(([k, e, c]) => ({ b, k, e, c, x: X(k) - 600, s: c === 'sud' ? 1 : -1 }));
// Haut : la ligne recoit la colonne par une jonction 8 m a l'ouest de l'extracteur (relais B -> Connection0)
const XJ = (e) => (e.e === 'bas' ? e.x : e.x - 800);
const ZB = 100, ZF = 500, ZM = 1100;            // convoyeurs, fluides, minerai (au-dessus de la base de la rangee)
const SIDE = 1400;                               // lignes 5 m devant les connecteurs (+-9 m)
// Tampons en sortie des quais (dechargement) : conteneur au cap du quai, 0,3 m a l'ouest et 23 m au nord de son axe,
// entrees a 3 m des sorties du quai (comme ceux de N266 O40)
const QUAIS = {
  'O119 q4': { quai: PREFIX + 'Build_TrainDockingStation_C_2146099607', x: -125779 }, // cuivre 1 200/min -> b1
  'O96 q2': { quai: PREFIX + 'Build_TrainDockingStation_C_2147159392', x: -99124 },   // cuivre 900/min -> b2
  'O119 q3': { quai: PREFIX + 'Build_TrainDockingStation_C_2146099716', x: -124179 }, // caterium 1 200/min -> b3
  'O143 q2': { quai: PREFIX + 'Build_TrainDockingStation_C_2146069961', x: -146034 }, // stators 360/min -> atelier
};
const TAMPON = (q) => ({ x: QUAIS[q].x - 300, y: -213770, z: 349 });
// Troncs du minerai : sortie du bas du tampon -> P (cap -90, 8 m au nord) -> ascenseur -> Ph a la hauteur du tronc ->
// relais vers l'ouest (40 m au plus) le long de la gare -> colonne x -137 400 vers le nord (relais empiles, un par
// tronc ; une bande quittee plus tot = un tronc plus bas) -> sortie vers l'est a Y + 26 m -> coin x -135 400 -> tete
// a Y + 14 m (cap 0) -> premier repartiteur de la rangee du bas. b2 longe la gare 7 m plus au nord (y -215 700) : elle
// passe a +16 m entre les ascenseurs des tampons de N211 O119 (jusqu'a +11 et +21 m).
const XC = -137400, XH = XW - 1400;
const spread = (x0, x1, max) => { const n = Math.ceil(Math.abs(x1 - x0) / max); return [...Array(n - 1).keys()].map((i) => Math.round(x0 + (x1 - x0) * (i + 1) / n)); };
const TRONCS = [
  { b: 1, quai: 'O119 q4', z: 1100, y: -215000, col: [], sortie: -216400, coin: 1100 },
  { b: 2, quai: 'O96 q2', z: 1600, y: -215700, col: [-219300], sortie: -222800, coin: 1600 },
  { b: 3, quai: 'O119 q3', z: 2100, y: -215000, col: [-219300, -223600, -226400], sortie: -229200, coin: 1600 },
].map((t) => Object.assign(t, { xs: spread(TAMPON(t.quai).x, XC, 4000) }));
const E = { x: 1, y: 0 }, W = { x: -1, y: 0 }, N = { x: 0, y: -1 }, S = { x: 0, y: 1 };
// Bande 4, gisements de la cote (foreuses Mk3 a 250 %, 3 eclats : foreuses.js --nom bloc-em) : lignes a plat sur des
// relais en l'air (40 m au plus), changements de hauteur par des ascenseurs (« pour les convoyeurs et pipes privilegier
// les verticales pour les grandes hauteurs », utilisateur, 25/10/2026) : point marque 'lift' = ascenseur depuis le point
// precedent, 4 m plus loin. Relief et plafonds releves en jeu le 25/10/2026 (scratchpad profil-ligne.js, tunnel-cat.js).
// Arrivee a y -210 600 au-dessus des voies, puis la colonne x -137 400 par le sud a partir de y -215 000. Sortie vers
// l'est a Y + 26 m (cuivre) et Y + 34 m (caterium) ; au coin x -135 400, un ascenseur ramene le minerai a la hauteur de
// la tete.
const FOREUSES = { cu: PREFIX + 'Build_MinerMk3_C_2147219593', cat: PREFIX + 'Build_MinerMk3_C_2147219490' };
const COL4 = [-219300, -223600, -227900, -232200];
const COTE = {
  // Cuivre : vers le nord jusqu'au bord de la falaise (pilier rocheux de 280 m sur la droite), deux ascenseurs au-dessus
  // de la plage (114 -> 67 -> 26 m), puis a plat a 26 m
  cu: { z: 2600, sortie: -235600, row: 'b4 bas', pts: [[-162694, -195231, 12100], [-162600, -197800, 11400],
    [-162243, -197981, 6700, 'lift'], [-161886, -198162, 2600, 'lift'], [-158825, -199717, 2600],
    [-155765, -201272, 2600], [-152704, -202826, 2600], [-149643, -204381, 2600], [-146582, -205936, 2600],
    [-143522, -207491, 2600], [-140461, -209045, 2600], [XC, -210600, 2600]] },
  // Caterium : gisement sous un surplomb (sol 78 m, plafond 156 m) : a plat a 80 m, ascenseur -> 61,5 m, puis le chemin
  // trouve par l'utilisateur (« j'ai trouve un autre chemin », 25/10/2026 ; le tunnel sous l'arche, trop etroit, est
  // abandonne) : ses deux poteaux empilables vers le nord-ouest, sortie du surplomb a 60 m, ascenseur -> 31 m des que le
  // sol tombe a la mer, 18 m apres le dernier poteau (« mets-toi de niveau le plus tot possible avant d'arriver sur les
  // gares »), puis a plat jusqu'a la colonne. { pole } = poteau empilable : le convoyeur s'accroche a son
  // point SnapOnly0 et le suivant part de son bout (pile-convoyeurs.js).
  cat: { z: 3100, sortie: -234800, row: 'b4 haut', pts: [[-133701, -176565, 8150], [-132100, -178300, 8200],
    [-130900, -179500, 8000], [-128366, -181317, 8000], [-128007, -181493, 6150, 'lift'], [-123900, -183500, 6150],
    { pole: 'Build_ConveyorPoleStackable_C_2147188242' }, { pole: 'Build_ConveyorPoleStackable_C_2147191816' },
    [-126435, -191380, 6000], [-126525, -191770, 3100, 'lift'], [-127419, -195659, 3100], [-128313, -199548, 3100],
    [-129206, -203436, 3100], [-130100, -207325, 3100], [-133750, -208963, 3100], [XC, -210600, 3100]] },
};
const unit = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy); return { x: dx / l, y: dy / l }; };
const bearing = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
// Atelier a +64 m au-dessus des bandes (pile.js, en l'air) : trois rangees de piles, entrees au nord et sorties au sud
// (dos -y : arrivees 26 m au nord de l'axe, collecteur 17 m au sud, +lx = est) ; Q filactif fusionne (axe y -232 000),
// A limiteurs IA (y -226 000), E barres EM (y -220 000). Unites cote a cote : 1 (cuivre de b1) a x -126 000, 2 (b2) a
// x -117 600, 3 (b4, limiteurs des oscillateurs : Q et A seulement, 2 piles) a x -109 200. Arrivees vers l'est (tete a
// l'ouest), collecteurs vers l'ouest (sortie a l'ouest). Entrees : Q Input0 cuivre (+3 m) / Input1 caterium (+7 m) ;
// A Input0 filactif (+3 m) / Input1 toles (+7 m) ; E Input0 limiteurs (+3 m) / Input1 stators (+7 m).
const TOP = 6400;
const UNITES = { 1: -126000, 2: -117600, 3: -109200 };
const ETAPES = {
  Q: { y: -232000, recette: 'Recipe_Alternate_Quickwire_C', piles: { 1: 3, 2: 3, 3: 2 }, etages: { 1: 9, 2: 9, 3: 6 } },
  A: { y: -226000, recette: 'Recipe_AILimiter_C', piles: { 1: 3, 2: 3, 3: 2 }, etages: { 1: 8, 2: 8, 3: 5 } },
  E: { y: -220000, recette: 'Recipe_ElectromagneticControlRod_C', piles: { 1: 3, 2: 3 }, etages: { 1: 10, 2: 10 } },
};
const pileNom = (e, u) => 'barres-em-' + e + u;
const pileState = (e, u) => JSON.parse(fs.readFileSync(path.join(__dirname, pileNom(e, u) + '-pile-state.json'), 'utf8'));
// tete (repartiteur de l'arrivee de la pile ouest, Input1 face a l'ouest) et queue (Output1 de la pile est) d'une arrivee
// (0 : Input0, 1 : Input1) ; sortie du collecteur (pile ouest) et sa tete (pile est, entree face a l'est)
const pilesOf = (e, u) => ETAPES[e].piles[u];
const tete = (e, u, f) => pileState(e, u).parts['arrivee ' + f + ' pile 0'];
const queue = (e, u, f) => pileState(e, u).parts['arrivee ' + f + ' pile ' + (pilesOf(e, u) - 1)];
const collecteur = (e, u, s) => pileState(e, u).parts['collecteur pile ' + s];
const XW_PILE = (u, e) => UNITES[u] - 800 * (ETAPES[e].piles[u] - 1); // pile ouest de l'unite
const Y_ARR = (e) => ETAPES[e].y - 2600, Y_COL = (e) => ETAPES[e].y + 1700;
// Colonnes de sortie des bandes, dans le couloir ouest : les lignes du bas (+1 m) et du haut (+33 m) arrivent de l'est ;
// montee a la verticale par ascenseurs jusqu'a la hauteur propre de chaque ligne d'arrivee (une hauteur par ligne : elles
// ne se croisent jamais a la meme hauteur). Couloirs nord-sud : x -135 400 (cuivre b1, +67 m), x -137 400 (toles +71 /
// +79 / +83 m, stators +75 m), x -133 000 (cuivre b2, +75 m). Les lignes qui passent au-dessus de l'unite 1 redescendent
// par un ascenseur entre deux unites.
const L1 = XH, L2 = XC, L3 = -133000;
const YQA = Y_ARR('Q'), YAA = Y_ARR('A'), YEA = Y_ARR('E');
// [nom, x, y, sorties (bas, haut : cles d'etat), montage, hauteur, sens de sortie]
const COLONNES = [
  ['lingots b1', -134800, -220400, ['b1 bas lingots 0', 'b1 haut lingots 0'], 'double', 6700, 'W'],
  ['lingots b2', -134800, -226800, ['b2 bas lingots 0', 'b2 haut lingots 0'], 'double', 7500, 'E'],
  ['caterium b3', -134800, -233200, ['b3 bas lingots 0', 'b3 haut lingots 0'], 'nord', 7100, 'N'],
  ['caterium b4', -134800, -239600, [null, 'b4 haut lingots 0'], 'haut', 7100, 'S'],
  ['lingots b4', -135600, -239600, ['b4 bas lingots 0', null], 'bas', 6700, 'S'],
  ['toles b1', -136200, -217600, ['b1 bas toles 0', 'b1 haut toles 0'], 'double', 7100, 'W'],
  ['toles b2', -136200, -224000, ['b2 bas toles 0', 'b2 haut toles 0'], 'double', 7900, 'W'],
  ['toles b4', -136200, -236800, ['b4 bas toles 0', null], 'bas', 8300, 'W'],
];
// Courant (circuit 4, poteaux Mk3 en l'air, poses en dernier dans la place qui reste ; cables de 100 m au plus, 10
// connexions par poteau) : source = poteau Mk1 du circuit 4 sous la voie basse ; G au nord des voies ; W au bout ouest
// de chaque bande (24 m au nord de son axe), enchaines du sud au nord ; P au nord de chaque rangee, a sa hauteur, un par
// groupe de 6 a 8 raffineries, enchaines le long de la rangee ; Q a 32 m au nord de l'axe, au ras de l'eau, pour les
// extracteurs et pompes d'un groupe, relie au P du bas le plus proche. Atelier : poteaux de pile.js (2 par pile, devant
// le collecteur), chaque etape reliee a la precedente ; foreuses de la cote sur les poteaux du circuit 4 les plus proches.
const POLE = 'Recipe_PowerPoleMk3_C';
const SOURCE = PREFIX + 'Build_PowerPoleMk1_C_2146724104'; // (-138 902 ; -207 545 ; -17 m), circuit 4
const G = { x: -136400, y: -213000, z: 0 };
const GROUPES_P = {
  'cu 36': [[0, 6], [7, 13], [14, 20], [21, 27], [28, 35]], 'cat 18': [[0, 5], [6, 11], [12, 17]],
  'cu 30': [[0, 7], [8, 14], [15, 21], [22, 29]], 'cat 7': [[0, 6]],
};
const GROUPES_Q = {
  1: [[2, 6, 9, 13], [16, 20, 23], [27, 30, 34]], 2: [[2, 6, 9, 13], [16, 20, 23], [27, 30, 34]],
  3: [[2, 4, 6, 8], [10, 12, 14, 16]], 4: [[2, 5, 9, 13], [17, 21, 25]],
};
// P du bas impose pour un Q (sinon le plus proche) : bande 4, P0 a deja 8 raffineries, W4 et P1 (10 connexions)
const Q_SUR_P = { 4: [1, 2] };
const FOREUSES_POTEAUX = { cu: PREFIX + 'Build_PowerPoleWall_C_2147436632', cat: PREFIX + 'Build_PowerPoleMk1_C_2146213457' };
// poteaux de l'atelier (m, repere de la rangee : lx vers l'est, ly vers le sud) : un premier rang 20 m devant les
// machines (3 m au sud du collecteur), un second a 24 m ; 8 m a l'est de chaque pile, loin des relais a l'ouest
const POTEAUX_PILE = { 3: [[-8, 20], [8, 20], [24, 20], [-8, 24], [8, 24], [24, 24]], 2: [[0, 20], [16, 20], [0, 24], [16, 24]] };
// reseau de chaque etape : [etape precedente, son poteau] (E1 : poteau P1 du haut de la bande 1)
const RESEAU_PILE = { E1: null, A1: ['E1', 5], Q1: ['A1', 5], E2: ['E1', 5], A2: ['E2', 5], Q2: ['A2', 5], A3: ['A2', 5], Q3: ['A3', 3] };
// Lignes d'arrivee : [nom, depart (sommet de colonne ou acteur), points, arrivee (fonction -> [acteur, connecteur])]
const ARRIVEES = [
  ['cuivre Q1', 'lingots b1', [[L1, -220400, 6700], [L1, -224000, 6700], [L1, -227600, 6700], [L1, -231100, 6700],
    [L1, YQA, 6700], [-131400, YQA, 6700]], () => [tete('Q', 1, 0), 'Input1']],
  ['cuivre Q2', 'lingots b2', [[L3, -226800, 7500], [L3, -231100, 7500], [L3, -235400, 7500], [-129000, -235400, 7500],
    [-125000, -235400, 7500], [-121400, -235400, 7500], [-121000, -235400, 6700, 'lift']], () => [tete('Q', 2, 0), 'Input1']],
  ['cuivre Q3', 'lingots b4', [[-135600, -236200, 6700], [-131600, -236200, 6700], [-127600, -236200, 6700],
    [-123600, -236200, 6700], [-119600, -236200, 6700], [-115600, -236200, 6700], [-111800, -236200, 6700]],
  () => [tete('Q', 3, 0), 'Input1']],
  // caterium : b3 par le relais J (x -134 800, sur la ligne d'arrivee de Q), ou b4 (7 C du haut) le rejoint par le nord
  ['caterium Q1', 'caterium b3', [[-134800, YQA, 7100], [-131300, YQA, 7100]], () => [tete('Q', 1, 1), 'Input1']],
  ['caterium b4', 'caterium b4', [], () => [st.actors['arrivee caterium Q1 relais 0'], N]],
  ['toles A1', 'toles b1', [[L2, -217600, 7100], [L2, -221100, 7100], [L2, -224850, 7100], [L2, YAA, 7100],
    [-133400, YAA, 7100], [-129600, YAA, 7100]], () => [tete('A', 1, 1), 'Input1']],
  ['toles A2', 'toles b2', [[L2, -224000, 7900], [L2, YAA, 7900], [-133400, YAA, 7900], [-129400, YAA, 7900],
    [-125400, YAA, 7900], [-121800, YAA, 7900], [-121400, YAA, 7100, 'lift']], () => [tete('A', 2, 1), 'Input1']],
  ['toles A3', 'toles b4', [[L2, -236800, 8300], [L2, -232700, 8300], [L2, YAA, 8300], [-133400, YAA, 8300],
    [-129400, YAA, 8300], [-125400, YAA, 8300], [-120600, YAA, 8300], [-116600, YAA, 8300], [-113600, YAA, 8300],
    [-113200, YAA, 7100, 'lift']], () => [tete('A', 3, 1), 'Input1']],
  // stators : tampon de N211 O143 q2 -> P (8 m au nord) -> deux ascenseurs face a face jusqu'a +75 m -> vers l'est le long
  // des gares, nord par x -137 400, est vers E1 (ascenseur -> +71 m)
  ['stators', 'tampon O143 q2', [[-146334, -215000, 449], [-146334, -215400, 5200, 'lift'], [-146334, -215800, 7500, 'lift'],
    [-141900, -215800, 7500], [L2, -215800, 7500], [L2, -219200, 7500], [L2, YEA, 7500], [-134000, YEA, 7500],
    [-131000, YEA, 7500], [-130600, YEA, 7100, 'lift']], () => [tete('E', 1, 1), 'Input1']],
];

// --- Etat -------------------------------------------------------------------------------------------------
const FILE = path.join(__dirname, 'barres-em-state.json');
const st = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : {};
for (const k of ['actors', 'links', 'wires']) st[k] = st[k] || {};
const save = () => { if (!DRY) fs.writeFileSync(FILE, JSON.stringify(st, null, 1) + '\n'); };

function report(key, r) {
  const what = r.built ? 'construit ' + short(r.actor) : DRY ? 'valide (essai)' : 'NON construit';
  const extra = (r.blocking && r.blocking.length ? ' BLOQUANT=' + JSON.stringify(r.blocking) : '') + (r.snapped ? ' accroches=' + JSON.stringify(r.snapped) : '');
  console.log(key.padEnd(44), what + extra);
  if (!DRY && !r.built) throw new Error(key + ' : non construit');
}
async function build(key, recipe, at, yaw, opts) {
  if (st.actors[key]) return st.actors[key];
  const r = await call('build', recipe, at, yaw, Object.assign({ dryRun: DRY }, opts || {}));
  report(key, r);
  if (r.built) { st.actors[key] = r.actor; save(); }
  return st.actors[key];
}
async function link(key, recipe, from, fromName, to, toName, opts) {
  if (st.links[key]) return st.links[key];
  if (!from || !to) { if (!DRY) console.log(key.padEnd(44), 'saute (bout absent)'); return null; }
  let r = await call('belt', recipe, from, fromName, { path: to, name: toName }, Object.assign({ dryRun: DRY }, opts || {}));
  // degagement souple seul en cause (ligne du caterium a 7 m d'un poteau de la grotte) : accepte apres un essai a blanc
  // sans lui (atelier-dissipateurs.js, references/convoyeurs.md)
  if (!r.built && r.blocking && r.blocking.length === 1 && r.blocking[0] === SOFT) {
    const o = Object.assign({}, opts || {}, { ignore: [SOFT] });
    const t = await call('belt', recipe, from, fromName, { path: to, name: toName }, Object.assign({}, o, { dryRun: true }));
    if (!(t.blocking && t.blocking.length)) {
      console.log(key.padEnd(44), 'degagement souple seul en cause, accepte');
      r = DRY ? t : await call('belt', recipe, from, fromName, { path: to, name: toName }, o);
    }
  }
  report(key, r);
  if (r.built) {
    if (!r.snapped || r.snapped.some((s) => s === null)) throw new Error(key + ' : bout non accroche ' + JSON.stringify(r.snapped));
    st.links[key] = r.actor; save();
  }
  return st.links[key];
}
// Connecteur libre de `actor` (input / output) dont la normale est la plus proche de `dir` ({x, y}), ou nom donne
async function conn(actor, direction, dir) {
  if (typeof dir === 'string') return dir;
  const list = (await call('connections', actor)).filter((c) => c.direction === direction && !c.connected);
  const score = (c) => c.normal.x * dir.x + c.normal.y * dir.y;
  list.sort((a, b) => score(b) - score(a));
  if (!list.length || score(list[0]) < 0.7) throw new Error('aucun connecteur ' + direction + ' libre vers ' + JSON.stringify(dir) + ' sur ' + short(actor));
  return list[0].name;
}
// Liaison par sens des connecteurs (normale de la sortie, normale de l'entree)
async function linkDir(key, recipe, from, fromDir, to, toDir, opts) {
  if (st.links[key]) return st.links[key];
  if (!from || !to) { if (!DRY) console.log(key.padEnd(44), 'saute (bout absent)'); return null; }
  return link(key, recipe, from, await conn(from, 'output', fromDir), to, await conn(to, 'input', toDir), opts);
}
// Convoyeur vers ou depuis un poteau empilable (pile-convoyeurs.js) : arrivee a 30 cm avant le point d'accroche, du cote
// d'ou l'on vient, accrochee au poteau (endOnActor) ; depart du bout libre du convoyeur precedent. Degagement souple des
// poteaux accepte seul, apres un essai a blanc.
async function poleLink(key, pts, rel, i, n) {
  if (st.links[key]) return st.links[key];
  const d = unit(pts[i - 1], pts[i]);
  const prev = st.links[n + ' ' + (i - 2) + ' > ' + (i - 1)];
  const fromPole = pts[i - 1][3] === 'poteau';
  if (!(fromPole ? prev : rel[i - 1]) || !(pts[i][3] === 'poteau' || rel[i])) { if (!DRY) console.log(key.padEnd(44), 'saute (bout absent)'); return null; }
  const from = fromPole ? { path: prev, name: 'ConveyorAny1' } : { path: rel[i - 1], name: await conn(rel[i - 1], 'output', d) };
  let to, o = {};
  if (pts[i][3] === 'poteau') { to = { x: pts[i][0] - d.x * 30, y: pts[i][1] - d.y * 30, z: pts[i][2] }; o = { endOnActor: pts[i][4] }; }
  else to = { path: rel[i], name: await conn(rel[i], 'input', unit(pts[i], pts[i - 1])) };
  const pre = await call('belt', REC.belt, from.path, from.name, to, Object.assign({ dryRun: true }, o));
  const other = (pre.blocking || []).filter((b) => b !== SOFT);
  if (other.length || DRY) { report(key, pre); return null; }
  const r = await call('belt', REC.belt, from.path, from.name, to, Object.assign({ ignore: [SOFT] }, o));
  report(key, r);
  if (r.built) { st.links[key] = r.actor; save(); }
  return st.links[key];
}
async function pipePoints(pipe) {
  const pose = await call('pose', pipe);
  const pts = (await call('dump', pipe, 3, 30, ['mSplineData'])).mSplineData;
  const yaw = pose.rotation.yaw * Math.PI / 180, c = Math.cos(yaw), s = Math.sin(yaw), o = pose.location;
  return pts.map((p) => ({ x: o.x + p.Location.X * c - p.Location.Y * s, y: o.y + p.Location.X * s + p.Location.Y * c, z: o.z + p.Location.Z }));
}
// Pompe sur la partie verticale d'une colonne : premier point accepte a blanc entre zmin et zmax (module-alu.js)
async function pompe(key, recipe, pipe, zmin, zmax) {
  if (st.actors[key]) return;
  if (!pipe) { console.log(key.padEnd(44), 'saute (colonne absente)'); return; }
  const w = await pipePoints(pipe), cand = [];
  for (let i = 0; i < w.length - 1; i++) for (let t = 0.05; t < 1; t += 0.05) cand.push({ x: w[i].x + (w[i + 1].x - w[i].x) * t, y: w[i].y + (w[i + 1].y - w[i].y) * t, z: w[i].z + (w[i + 1].z - w[i].z) * t });
  let r = null;
  for (const p of cand.filter((q) => q.z >= zmin && q.z <= zmax)) {
    const aim = [{ x: p.x, y: p.y + 300, z: p.z + 300 }, p];
    const t = await call('buildAim', recipe, aim[0], aim[1], { dryRun: true, onActor: pipe });
    if (t.blocking && t.blocking.length) continue;
    r = DRY ? t : await call('buildAim', recipe, aim[0], aim[1], { onActor: pipe });
    console.log(key.padEnd(44), 'a', (p.z / 100).toFixed(1), 'm');
    break;
  }
  if (!r) throw new Error(key + ' : aucun point accepte entre ' + zmin / 100 + ' et ' + zmax / 100 + ' m');
  report(key, r);
  if (r.built) { st.actors[key] = r.actor; save(); }
}
// Ligne de jonctions d'est en ouest (Connection0 -> Connection1 de voisine en voisine)
async function junctionLine(prefix, xs, y, z) {
  const sorted = [...new Set(xs)].sort((a, b) => b - a);
  for (const x of sorted) await build(prefix + ' ' + x, REC.junction, { x, y, z }, 0, AIR);
  for (let i = 1; i < sorted.length; i++) await link(prefix + ' ' + sorted[i - 1] + ' > ' + sorted[i], REC.pipe, st.actors[prefix + ' ' + sorted[i - 1]], 'Connection0', st.actors[prefix + ' ' + sorted[i]], 'Connection1');
  return (x) => st.actors[prefix + ' ' + x];
}
const refKey = (row, k) => row.id + ' raffinerie ' + k + ' ' + TYPE(row, k);
const ref = (row, k) => st.actors[refKey(row, k)];
const extKey = (e) => 'b' + e.b + ' extracteur ' + e.k;
const OF = (row, types) => row.K.filter((k) => types.includes(TYPE(row, k)));
// cote sud : L et C (jonction a x-2, branche Connection3) ; cote nord : T (x+2, branche Connection2)
const COTES = [['sud', ['L', 'C'], -200, 'Connection3'], ['nord', ['T'], 200, 'Connection2']];

const PHASES = {
  async raffineries() {
    for (const row of ROWS) for (const k of row.K) await build(refKey(row, k), REC.refinery, { x: X(k), y: row.Y, z: row.Z }, YAW[TYPE(row, k)], AIR);
  },

  async recettes() {
    for (const row of ROWS) for (const k of row.K) {
      const key = refKey(row, k), a = st.actors[key];
      if (!a || DRY) { console.log(key.padEnd(44), DRY ? REC[TYPE(row, k)] : 'absente'); continue; }
      const r = await call('setRecipe', a, REC[TYPE(row, k)]);
      console.log(key.padEnd(44), r.recipe);
    }
  },

  // poses par un point touche fabrique sur le volume d'eau (module-alu.js)
  async extracteurs() {
    for (const b of [1, 2, 3, 4]) for (const e of exts(b)) {
      const key = extKey(e);
      if (st.actors[key]) continue;
      const y = BANDES[b] + 300 * e.s;
      const r = await call('buildAim', REC.extractor, { x: e.x, y, z: 1000 }, { x: e.x, y, z: -1815 }, { dryRun: DRY, onActor: WATER(e.x), scrollRotation: e.s > 0 ? 180 : 0 });
      report(key, r);
      if (r.built) { st.actors[key] = r.actor; save(); }
    }
  },

  // Lignes d'eau a +5 m de chaque rangee, par cote ; jonctions des extracteurs de l'etage ; colonnes directes pour le bas
  async eau() {
    for (const row of ROWS) {
      const es = exts(row.b).filter((e) => e.e === row.e);
      for (const [cote, types, dx, branch] of COTES) {
        const ks = OF(row, types);
        if (!ks.length) continue;
        const ec = es.filter((e) => e.c === cote), y = row.Y + (cote === 'sud' ? SIDE : -SIDE);
        const J = await junctionLine(row.id + ' eau ' + cote, ks.map((k) => X(k) + dx).concat(ec.map(XJ)), y, row.Z + ZF);
        for (const k of ks) await link(row.id + ' eau > raffinerie ' + k, REC.pipe, J(X(k) + dx), branch, ref(row, k), 'PipeInputFactory');
        if (row.e === 'bas') for (const e of ec) await link('b' + row.b + ' colonne ' + e.k, REC.pipe, st.actors[extKey(e)], 'FGPipeConnectionFactory', J(e.x), branch);
      }
    }
  },

  // Colonnes de l'etage du haut : extracteur -> relais A (-7 m, 17 m devant l'axe) -> colonne -> relais B (+37 m, 26 m
  // devant) -> par l'ouest jusqu'a la jonction de la ligne (14 m devant, 8 m a l'ouest)
  async colonnes() {
    for (const b of [1, 2, 3, 4]) for (const e of exts(b).filter((q) => q.e === 'haut')) {
      const Y = BANDES[b], s = e.s, row = rowOf(b, 'haut');
      const [toward, away] = s > 0 ? ['Connection3', 'Connection2'] : ['Connection2', 'Connection3'];
      const A = await build('b' + b + ' relais A ' + e.k, REC.junction, { x: e.x, y: Y + 1700 * s, z: -700 }, 0, AIR);
      const B = await build('b' + b + ' relais B ' + e.k, REC.junction, { x: e.x, y: Y + 2600 * s, z: row.Z + ZF }, 0, AIR);
      const J = st.actors[row.id + ' eau ' + e.c + ' ' + XJ(e)];
      await link('b' + b + ' extracteur ' + e.k + ' > A', REC.pipe, st.actors[extKey(e)], 'FGPipeConnectionFactory', A, toward);
      await link('b' + b + ' colonne haute ' + e.k, REC.pipe, A, away, B, toward);
      await link('b' + b + ' B ' + e.k + ' > ligne', REC.pipe, B, 'Connection0', J, away);
    }
  },

  async pompes() {
    for (const b of [1, 2, 3, 4]) for (const e of exts(b)) {
      if (e.e === 'bas') await pompe('b' + b + ' pompe ' + e.k, REC.pump1, st.links['b' + b + ' colonne ' + e.k], -1300, -600);
      else await pompe('b' + b + ' pompe ' + e.k, REC.pump2, st.links['b' + b + ' colonne haute ' + e.k], 0, 2500);
    }
  },

  // Minerai a +11 m au sud : repartiteurs devant les L et C (x+2) et ascenseur direct jusqu'a l'entree ; vers l'est
  // (cap 0, branche Output3 au nord) ou l'ouest (cap 180, branche Output2) ; montee de 32 m au bout est (b1, b2, b3)
  async minerai() {
    for (const row of ROWS) {
      const y = row.Y + SIDE, ks = OF(row, ['L', 'C']), est = row.flux === 'est';
      for (const k of ks) await build(row.id + ' minerai ' + k, REC.splitter, { x: X(k) + 200, y, z: row.Z + ZM }, est ? 0 : 180, AIR);
      const S = (k) => st.actors[row.id + ' minerai ' + k];
      const chain = est ? ks : [...ks].reverse();
      for (let i = 1; i < chain.length; i++) await link(row.id + ' minerai ' + chain[i - 1] + ' > ' + chain[i], REC.belt, S(chain[i - 1]), 'Output1', S(chain[i]), 'Input1');
      for (const k of ks) await link(row.id + ' minerai > raffinerie ' + k, REC.lift, S(k), est ? 'Output3' : 'Output2', ref(row, k), 'Input0', { snapTolerance: 400 });
    }
    for (const b of [1, 2, 3].filter((q) => MONTEE[q])) {
      const bas = rowOf(b, 'bas'), haut = rowOf(b, 'haut'), y = BANDES[b] + SIDE;
      const last = OF(bas, ['L', 'C']).slice(-1)[0], xb = X(last) + 1400;
      const U = await build('b' + b + ' minerai bout bas', REC.merger, { x: xb, y, z: ETAGES.bas + ZM }, 0, AIR);
      const V = await build('b' + b + ' minerai bout haut', REC.merger, { x: xb, y, z: ETAGES.haut + ZM }, 180, AIR);
      await link('b' + b + ' minerai bas > bout', REC.belt, st.actors[bas.id + ' minerai ' + last], 'Output1', U, 'Input1');
      await link('b' + b + ' minerai montee', REC.lift, U, 'Output1', V, 'Input1', { snapTolerance: 400 });
      await link('b' + b + ' minerai bout > haut', REC.belt, V, 'Output1', st.actors[haut.id + ' minerai ' + last], 'Input1');
    }
  },

  // Lingots, au nord a +1 m, d'est en ouest : fusionneurs devant les L et C (x+2, Input3), repartiteurs devant les T
  // (x-2, Output3) ; sortie au bout ouest (Output1 de l'element 0), libre
  async lingots() {
    for (const row of ROWS) {
      const y = row.Y - SIDE, z = row.Z + ZB, A = (k) => st.actors[row.id + ' lingots ' + k];
      const prod = (k) => TYPE(row, k) !== 'T';
      for (const k of row.K) await build(row.id + ' lingots ' + k, prod(k) ? REC.merger : REC.splitter, { x: X(k) + (prod(k) ? 200 : -200), y, z }, 180, AIR);
      for (const k of row.K.filter(prod)) await link(row.id + ' raffinerie ' + k + ' > lingots', REC.belt, ref(row, k), 'Output1', A(k), 'Input3');
      for (const k of OF(row, ['T'])) await link(row.id + ' lingots > raffinerie ' + k, REC.belt, A(k), 'Output3', ref(row, k), 'Input0');
      for (let k = row.n - 1; k > 0; k--) await link(row.id + ' lingots ' + k + ' > ' + (k - 1), REC.belt, A(k), 'Output1', A(k - 1), 'Input1');
    }
  },

  // Toles, au sud a +1 m, vers l'ouest : fusionneurs devant les T (x-2, Input2 au nord) ; sortie au bout ouest, libre
  async toles() {
    for (const row of ROWS.filter((r) => r.kind === 'cu')) {
      const y = row.Y + SIDE, z = row.Z + ZB, ts = OF(row, ['T']), M = (k) => st.actors[row.id + ' toles ' + k];
      for (const k of ts) await build(row.id + ' toles ' + k, REC.merger, { x: X(k) - 200, y, z }, 180, AIR);
      for (const k of ts) await link(row.id + ' raffinerie ' + k + ' > toles', REC.belt, ref(row, k), 'Output1', M(k), 'Input2');
      const chain = [...ts].reverse(); // d'est en ouest
      for (let i = 1; i < chain.length; i++) await link(row.id + ' toles ' + chain[i - 1] + ' > ' + chain[i], REC.belt, M(chain[i - 1]), 'Output1', M(chain[i]), 'Input1');
    }
  },

  // Tampon en sortie de chaque quai (« il faut des tampons en sortie de quai »)
  async tampons() {
    for (const q of Object.keys(QUAIS)) {
      const t = await build('tampon ' + q, 'Recipe_StorageContainerMk2_C', TAMPON(q), 180, AIR);
      await link(q + ' > tampon (bas)', REC.belt, QUAIS[q].quai, 'Output0', t, 'Input0');
      await link(q + ' > tampon (haut)', REC.belt, QUAIS[q].quai, 'Output1', t, 'Input1');
    }
  },

  async troncs() {
    for (const t of TRONCS) {
      const n = 'tronc b' + t.b, tp = TAMPON(t.quai), row = rowOf(t.b, 'bas');
      const P = await build(n + ' P', REC.merger, { x: tp.x, y: -215000, z: 449 }, -90, AIR);
      const Ph = await build(n + ' Ph', REC.merger, { x: tp.x, y: -215000, z: t.z }, 180, AIR);
      const rel = [];
      for (const x of t.xs) rel.push(await build(n + ' relais ' + x, REC.merger, { x, y: t.y, z: t.z }, 180, AIR));
      const C0 = await build(n + ' coin colonne', REC.merger, { x: XC, y: t.y, z: t.z }, -90, AIR);
      const col = [];
      for (const y of t.col) col.push(await build(n + ' colonne ' + y, REC.merger, { x: XC, y, z: t.z }, -90, AIR));
      const Sx = await build(n + ' sortie', REC.merger, { x: XC, y: t.sortie, z: t.z }, 0, AIR);
      const Co = await build(n + ' coin tete', REC.merger, { x: XH, y: t.sortie, z: t.coin }, -90, AIR);
      const H = await build(n + ' tete', REC.merger, { x: XH, y: row.Y + SIDE, z: ZM }, 0, AIR);
      await linkDir(n + ' tampon > P', REC.belt, st.actors['tampon ' + t.quai], 'Output1', P, S);
      await linkDir(n + ' montee', REC.lift, P, N, Ph, N, { snapTolerance: 400 });
      const ew = [Ph, ...rel, C0];
      for (let i = 1; i < ew.length; i++) await linkDir(n + ' ouest ' + i, REC.belt, ew[i - 1], W, ew[i], E);
      const ns = [C0, ...col, Sx];
      for (let i = 1; i < ns.length; i++) await linkDir(n + ' nord ' + i, REC.belt, ns[i - 1], N, ns[i], S);
      await linkDir(n + ' sortie > coin', REC.belt, Sx, E, Co, W);
      await linkDir(n + ' coin > tete', REC.belt, Co, N, H, S);
      const first = OF(row, ['L', 'C'])[0];
      await linkDir(n + ' tete > rangee', REC.belt, H, E, st.actors[row.id + ' minerai ' + first], 'Input1');
    }
  },

  // Colonne, sortie et tete de la bande 4 (cuivre et caterium), puis la ligne en l'air depuis la foreuse
  async cote() {
    for (const [m, c] of Object.entries(COTE)) {
      const n = 'cote ' + m, row = ROWS.find((r) => r.id === c.row), zt = row.Z + ZM;
      const ys = [-215000, ...COL4];
      const col = [];
      for (const y of ys) col.push(await build(n + ' colonne ' + y, REC.merger, { x: XC, y, z: c.z }, -90, AIR));
      const Sx = await build(n + ' sortie', REC.merger, { x: XC, y: c.sortie, z: c.z }, 0, AIR);
      const A = await build(n + ' coin', REC.merger, { x: XH, y: c.sortie, z: c.z }, 0, AIR);
      const B = await build(n + ' coin tete', REC.merger, { x: XH, y: c.sortie, z: zt }, -90, AIR);
      const H = await build(n + ' tete', REC.merger, { x: XH, y: row.Y + SIDE, z: zt }, 0, AIR);
      const ns = [...col, Sx];
      for (let i = 1; i < ns.length; i++) await linkDir(n + ' nord ' + i, REC.belt, ns[i - 1], N, ns[i], S);
      await linkDir(n + ' sortie > coin', REC.belt, Sx, E, A, W);
      await linkDir(n + ' ascenseur', REC.lift, A, E, B, E, { snapTolerance: 400 });
      await linkDir(n + ' coin > tete', REC.belt, B, N, H, S);
      await linkDir(n + ' tete > rangee', REC.belt, H, E, st.actors[row.id + ' minerai ' + OF(row, ['L', 'C'])[0]], 'Input1');
      if (!c.pts) { console.log(n.padEnd(44), 'ligne de la foreuse : trace a faire'); continue; }
      // ligne en l'air : relais tournes vers le point suivant (le dernier vers l'entree de la colonne) ; poteaux de
      // l'utilisateur pris a leur point d'accroche
      const pts = [];
      for (const p of c.pts) {
        if (!p.pole) { pts.push(p); continue; }
        const s = (await call('connections', PREFIX + p.pole)).find((k) => k.name === 'SnapOnly0').location;
        pts.push([s.x, s.y, s.z, 'poteau', PREFIX + p.pole]);
      }
      pts.push([XC, -215000, c.z]);
      const rel = [], pole = (i) => pts[i][3] === 'poteau';
      for (let i = 0; i < c.pts.length; i++) rel.push(pole(i) ? null : await build(n + ' relais ' + i, REC.merger, { x: pts[i][0], y: pts[i][1], z: pts[i][2] }, bearing(pts[i], pts[i + 1]), AIR));
      const o = (await call('connections', FOREUSES[m])).find((k) => k.name === 'Output0').location;
      await linkDir(n + ' foreuse > 0', REC.belt, FOREUSES[m], 'Output0', rel[0], unit(pts[0], [o.x, o.y]));
      for (let i = 1; i < rel.length; i++) {
        const key = n + ' ' + (i - 1) + ' > ' + i;
        if (pole(i) || pole(i - 1)) { await poleLink(key, pts, rel, i, n); continue; }
        const lift = pts[i][3] === 'lift';
        await linkDir(key, lift ? REC.lift : REC.belt, rel[i - 1], unit(pts[i - 1], pts[i]), rel[i], unit(pts[i], pts[i - 1]), lift ? { snapTolerance: 400 } : undefined);
      }
      await linkDir(n + ' > colonne', REC.belt, rel[rel.length - 1], N, col[0], S);
    }
  },

  // Piles de l'atelier (pile.js) : etapes au choix (node barres-em.js piles machines,raccords,... [Q1,A1,...])
  async piles() {
    const { execFileSync } = require('child_process');
    const args = process.argv.slice(3).filter((a) => !a.startsWith('--'));
    const steps = (args[0] || 'machines,raccords,branches,ascenseurs,arrivees,collecteur,recettes').split(',');
    const only = args[1] ? args[1].split(',') : null;
    const all = Object.keys(ETAPES).flatMap((e) => Object.keys(ETAPES[e].piles).map((u) => [e, u]));
    const list = only ? only.map((n) => [n[0], n.slice(1)]) : all; // dans l'ordre donne (courant : E1, A1, Q1, E2...)
    for (const [e, u] of list) {
      const nom = pileNom(e, u), file = path.join(__dirname, nom + '-config-state.json');
      const cfg = {
        nom, recette: ETAPES[e].recette, plateforme: { origine: { x: UNITES[u], y: ETAPES[e].y }, cap: 0, dessus: TOP },
        dos: '-y', centre: [0, 0], piles: ETAPES[e].piles[u], etages: ETAPES[e].etages[u], pas: 16, espacement: 10, enLAir: true,
        arrivees: [{ entree: 'Input0', hauteur: 3, sens: '+lx' }, { entree: 'Input1', hauteur: 7, sens: '+lx' }],
        collecteur: { sens: '-lx' }, poteaux: POTEAUX_PILE[ETAPES[e].piles[u]],
      };
      if (steps.includes('courant')) {
        const r = RESEAU_PILE[e + u];
        cfg.reseau = r ? pileState(r[0][0], r[0][1]).poles['poteau ' + r[1]] : st.actors['poteau b1 haut P1'];
        if (!cfg.reseau) throw new Error(e + u + ' : poteau du reseau absent (phase courant, puis etapes dans l\'ordre E1, A1, Q1, E2...)');
      }
      fs.writeFileSync(file, JSON.stringify(cfg, null, 1));
      for (const s of steps) {
        let out;
        try {
          out = execFileSync(process.execPath, [path.join(__dirname, 'pile.js'), s, '--config', file].concat(DRY ? ['--dry'] : []), { encoding: 'utf8', maxBuffer: 64 << 20 });
        } catch (err) { out = String(err.stdout || '') + String(err.stderr || ''); console.log((e + u + ' ' + s).padEnd(24), 'ECHEC', out.split('\n').filter((l) => l.trim()).slice(-3).join(' / ')); throw new Error(e + u + ' ' + s); }
        const bad = out.split('\n').filter((l) => /NON|ECHEC|BLOQUANT/.test(l));
        console.log((e + u + ' ' + s).padEnd(24), bad.length ? bad.slice(0, 3).join(' / ') : 'ok');
      }
    }
  },

  // Courant des bandes et des foreuses de la cote (l'atelier : node barres-em.js piles courant E1,A1,Q1,E2,A2,Q2,A3,Q3)
  async courant() {
    const p = (n) => st.actors['poteau ' + n];
    const plan = [];
    await build('poteau G', POLE, G, 0, AIR);
    plan.push(['G', SOURCE]);
    for (const b of [1, 2, 3, 4]) {
      await build('poteau W' + b, POLE, { x: XW - 2000, y: BANDES[b] - 2400, z: 0 }, 0, AIR);
      plan.push(['W' + b, b === 1 ? p('G') : p('W' + (b - 1))]);
      const rows = ROWS.filter((r) => r.b === b), bas = rows.find((r) => r.e === 'bas');
      for (const row of rows) {
        const groups = GROUPES_P[row.kind + ' ' + row.n];
        for (const [i, [k0, k1]] of groups.entries()) {
          await build('poteau ' + row.id + ' P' + i, POLE, { x: (X(k0) + X(k1)) / 2, y: row.Y - 2400, z: row.Z }, 0, AIR);
          plan.push([row.id + ' P' + i, i ? p(row.id + ' P' + (i - 1)) : p('W' + b)]);
          for (let k = k0; k <= k1; k++) plan.push([row.id + ' P' + i, ref(row, k)]);
        }
      }
      // Q : extracteurs et pompes d'un groupe ; relie au P du bas le plus proche
      const pb = GROUPES_P[bas.kind + ' ' + bas.n].map(([k0, k1], i) => ({ i, x: (X(k0) + X(k1)) / 2 }));
      for (const [j, ks] of GROUPES_Q[b].entries()) {
        const x = Math.round(ks.reduce((s, k) => s + X(k) - 600, 0) / ks.length);
        await build('poteau b' + b + ' Q' + j, POLE, { x, y: BANDES[b] - 3200, z: 0 }, 0, AIR);
        const near = Q_SUR_P[b] ? pb[Q_SUR_P[b][j]] : pb.reduce((a, c) => (Math.abs(c.x - x) < Math.abs(a.x - x) ? c : a));
        plan.push(['b' + b + ' Q' + j, p(bas.id + ' P' + near.i)]);
        for (const k of ks) plan.push(['b' + b + ' Q' + j, st.actors['b' + b + ' extracteur ' + k]], ['b' + b + ' Q' + j, st.actors['b' + b + ' pompe ' + k]]);
      }
    }
    // connexions par poteau (10 au plus pour un Mk3)
    const count = {};
    for (const [a, b] of plan) { count[a] = (count[a] || 0) + 1; const kb = Object.keys(st.actors).find((k) => k.startsWith('poteau ') && st.actors[k] === b); if (kb) count[kb.slice(7)] = (count[kb.slice(7)] || 0) + 1; }
    const over = Object.entries(count).filter(([, n]) => n > 10);
    if (over.length) throw new Error('poteaux trop charges : ' + JSON.stringify(over));
    for (const [a, b] of plan) {
      const key = a + ' > ' + (b ? short(b) : '?');
      if (st.wires[key]) continue;
      if (!p(a) || !b) { if (!DRY) console.log(('cable ' + key).padEnd(44), 'saute (bout absent)'); continue; }
      const r = await call('wire', p(a), b, { dryRun: DRY });
      report('cable ' + key, r);
      if (r.built) { st.wires[key] = r.actor || true; save(); }
    }
    for (const m of ['cu', 'cat']) {
      const key = 'foreuse ' + m;
      if (st.wires[key]) continue;
      const r = await call('wire', FOREUSES_POTEAUX[m], FOREUSES[m], { dryRun: DRY });
      report('cable ' + key, r);
      if (r.built) { st.wires[key] = r.actor || true; save(); }
    }
  },

  // Colonnes de sortie des bandes (lingots, toles) : fusionneurs a la meme verticale relies par des ascenseurs
  //  - double : bas (cap 180, entree a l'est) -> ascenseur ouest -> haut (+33 m, cap -90 : entree ouest depuis le bas,
  //    est depuis la ligne du haut) -> ascenseur nord -> sommet (entree nord) ; montage U / V / W du module 1 ;
  //  - nord (sortie au nord) : bas cap -90 -> ascenseur nord -> haut cap 180 -> ascenseur ouest -> sommet cap -90 ;
  //  - haut (ligne du haut seule) : haut cap 180 -> ascenseur ouest -> sommet ;
  //  - bas (ligne du bas seule) : bas cap 180 -> ascenseur ouest -> relais a +45 m (cap -90) -> ascenseur nord -> sommet.
  async sorties() {
    const CAP = { W: 180, E: 0, N: -90, S: 90 }, LIFT = { snapTolerance: 400 };
    for (const [name, x, y, [kb, kh], kind, zTop, dir] of COLONNES) {
      const n = 'col ' + name, bas = kb && st.actors[kb], haut = kh && st.actors[kh];
      const at = (z) => ({ x, y, z });
      if (kind === 'double' || kind === 'nord') {
        const nord = kind === 'nord';
        const U = await build(n + ' bas', REC.merger, at(100), nord ? -90 : 180, AIR);
        const V = await build(n + ' haut', REC.merger, at(3300), nord ? 180 : -90, AIR);
        const T = await build(n + ' sommet', REC.merger, at(zTop), CAP[dir], AIR);
        await linkDir(n + ' sortie bas', REC.belt, bas, W, U, E);
        await linkDir(n + ' sortie haut', REC.belt, haut, W, V, E);
        await linkDir(n + ' montee 1', REC.lift, U, nord ? N : W, V, nord ? N : W, LIFT);
        await linkDir(n + ' montee 2', REC.lift, V, nord ? W : N, T, nord ? W : N, LIFT);
      } else if (kind === 'haut') {
        const U = await build(n + ' haut', REC.merger, at(3300), 180, AIR);
        const T = await build(n + ' sommet', REC.merger, at(zTop), CAP[dir], AIR);
        await linkDir(n + ' sortie haut', REC.belt, haut, W, U, E);
        await linkDir(n + ' montee', REC.lift, U, W, T, W, LIFT);
      } else {
        const U = await build(n + ' bas', REC.merger, at(100), 180, AIR);
        const V = await build(n + ' relais', REC.merger, at(4500), -90, AIR);
        const T = await build(n + ' sommet', REC.merger, at(zTop), CAP[dir], AIR);
        await linkDir(n + ' sortie bas', REC.belt, bas, W, U, E);
        await linkDir(n + ' montee 1', REC.lift, U, W, V, W, LIFT);
        await linkDir(n + ' montee 2', REC.lift, V, N, T, N, LIFT);
      }
    }
  },

  // Liaisons de l'atelier : collecteur de Q -> relais (cap 90, 12 m a l'ouest de la pile ouest) -> arrivee du filactif de A ;
  // collecteur de A -> relais -> arrivee des limiteurs de E ; collecteur de E2 -> tete du collecteur de E1 (sortie des
  // barres EM a l'ouest de E1, libre) ; caterium Q1 -> Q2 -> Q3 et stators E1 -> E2 de queue en tete. Sortie des
  // limiteurs de A3 (oscillateurs) libre.
  async liaisons() {
    for (const [a, b] of [['Q', 'A'], ['A', 'E']]) for (const u of Object.keys(ETAPES[b].piles)) {
      const x = XW_PILE(u, a) - 1200, y = (Y_COL(a) + Y_ARR(b)) / 2;
      const R = await build('relais ' + a + u + ' > ' + b + u, REC.merger, { x, y, z: TOP + 200 }, 90, AIR);
      await linkDir(a + u + ' > relais', REC.belt, collecteur(a, u, 0), W, R, E);
      await linkDir('relais > ' + b + u, REC.belt, R, S, tete(b, u, 0), 'Input1');
    }
    await linkDir('E2 > E1', REC.belt, collecteur('E', 2, 0), W, collecteur('E', 1, ETAPES.E.piles[1] - 1), E);
    await linkDir('caterium Q1 > Q2', REC.belt, queue('Q', 1, 1), E, tete('Q', 2, 1), 'Input1');
    const Rq = await build('relais caterium Q2 > Q3', REC.merger, { x: -113200, y: YQA, z: TOP + 700 }, 0, AIR);
    await linkDir('caterium Q2 > relais', REC.belt, queue('Q', 2, 1), E, Rq, W);
    await linkDir('caterium relais > Q3', REC.belt, Rq, E, tete('Q', 3, 1), 'Input1');
    await linkDir('stators E1 > E2', REC.belt, queue('E', 1, 1), E, tete('E', 2, 1), 'Input1');
  },

  // Lignes d'arrivee : sommet d'une colonne (ou tampon) -> relais en l'air (tournes vers le point suivant ; 'lift' =
  // ascenseur depuis le point precedent) -> tete d'une arrivee de l'atelier
  async arrivees() {
    for (const [n, de, pts, fin] of ARRIVEES) {
      const k = 'arrivee ' + n;
      let end = null;
      try { end = fin ? fin() : null; } catch (e) { if (!DRY) throw e; }
      let endPos = null;
      if (end && end[0]) endPos = typeof end[1] === 'string' ? (await call('connections', end[0])).find((c) => c.name === end[1]).location : (await call('pose', end[0])).location;
      const rel = [];
      for (let i = 0; i < pts.length; i++) {
        const nx = i + 1 < pts.length ? pts[i + 1] : endPos ? [endPos.x, endPos.y] : null;
        rel.push(await build(k + ' relais ' + i, REC.merger, { x: pts[i][0], y: pts[i][1], z: pts[i][2] }, nx ? bearing(pts[i], nx) : 0, AIR));
      }
      const src = de === 'tampon O143 q2' ? st.actors['tampon ' + 'O143 q2'] : st.actors['col ' + de + ' sommet'];
      const srcName = de === 'tampon O143 q2' ? 'Output1' : null;
      const sp = src ? (await call('pose', src)).location : null;
      const first = pts.length ? pts[0] : endPos ? [endPos.x, endPos.y] : null;
      if (!sp || !first) { console.log(k.padEnd(44), 'saute (bout absent)'); continue; }
      const s0 = [sp.x, sp.y];
      if (pts.length) {
        await linkDir(k + ' depart', REC.belt, src, srcName || unit(s0, first), rel[0], unit(first, s0));
        for (let i = 1; i < rel.length; i++) {
          const lift = pts[i][3] === 'lift';
          await linkDir(k + ' ' + (i - 1) + ' > ' + i, lift ? REC.lift : REC.belt, rel[i - 1], unit(pts[i - 1], pts[i]), rel[i], unit(pts[i], pts[i - 1]), lift ? { snapTolerance: 400 } : undefined);
        }
      }
      if (!end || !end[0]) continue;
      const last = pts.length ? rel[rel.length - 1] : src, lp = pts.length ? pts[pts.length - 1] : s0;
      await linkDir(k + ' arrivee', REC.belt, last, pts.length || !srcName ? unit(lp, [endPos.x, endPos.y]) : srcName, end[0], end[1]);
    }
  },

  async verifie() {
    for (const [key, a] of Object.entries(st.actors)) {
      const conns = await call('connections', a);
      const free = conns.filter((c) => !c.connected).map((c) => c.name);
      if (free.length) console.log(key.padEnd(44), 'libres :', free.join(' '));
    }
  },
};

const phase = process.argv[2];
if (!PHASES[phase]) {
  console.error('usage : node barres-em.js <' + Object.keys(PHASES).join('|') + '> [--dry]');
  process.exit(2);
}
PHASES[phase]().then(() => save()).catch((e) => { console.error('ECHEC :', e.message); process.exitCode = 1; });
