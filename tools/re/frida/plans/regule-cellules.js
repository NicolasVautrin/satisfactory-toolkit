// Regulation du rapport des accelerateurs du module nucleaire 1 (utilisateur, 28/10/2026 : « le moins de matiere
// radioactive possible dans tous les batiments », « si y'a 300 non fissile on doit aussi etre a 75 waste »). La recette
// prend 100 non fissile pour 25 dechets : dans chaque accelerateur, l'ecart e = dechets - non fissile / 4 (en dechets)
// doit rester nul, sinon le surplus reste coince. Le partage normal de la cellule (SA : moitie vers l'accelerateur, moitie
// vers les melangeurs, soit 1/4 des dechets de la cellule pour l'accelerateur) garde l'ecart constant ; pour le resorber,
// le SA de la cellule passe :
//  - e > +seuil (dechets en trop) : tout vers les melangeurs, l'accelerateur ne recoit plus de dechets et les melangeurs
//    font plus de non fissile ;
//  - e < -seuil (non fissile en trop) : tout vers l'accelerateur (la moitie des dechets de la cellule) ;
//  - retour au partage normal des que |e| <= retour.
// Jamais de regle de debordement (utilisateur : « si on atteint l'overflow c'est vraiment la catastrophe »).
// A lancer apres un incident (utilisateur : « pas besoin de le faire tourner pendant des heures, c'est souvent a la suite
// d'un incident » : les dechets saturent accelerateur et melangeurs, et les melangeurs en consomment 3 fois plus, d'ou un
// accelerateur qui garde des dechets en trop) : s'arrete seul quand les 8 cellules sont au partage normal depuis
// stable_s, ou a la duree maximale. Releve toutes les periode s, une ligne a chaque bascule et un bilan toutes les 2 min ;
// partage normal remis partout a la fin.
// usage : node regule-cellules.js [seuil=25] [retour=8] [periode_s=15] [duree_min=30] [stable_s=60] | --remettre
'use strict';
const fs = require('fs');
const path = require('path');
const { call } = require('./client');
const st = JSON.parse(fs.readFileSync(path.join(__dirname, 'module1-state.json'), 'utf8'));
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const SEUIL = Number(args[0] || 25), RETOUR = Number(args[1] || 8), PERIODE = Number(args[2] || 15) * 1000;
const MAX = Number(args[3] || 30) * 60e3, STABLE = Number(args[4] || 60) * 1000;
const CELLS = ['A0', 'A1', 'A2', 'A3', 'B0', 'B1', 'B2', 'B3'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function rpc(...a) { for (let i = 0; ; i++) { try { return await call(...a); } catch (e) { if (i >= 6) throw e; await sleep(1500); } } }
// sorties du SA : vers le relais de l'accelerateur (MA) = 0 ; vers les melangeurs (F) = 2 en colonne A, 1 en colonne B
const REGLES = (C, mode) => {
  const F = C[0] === 'A' ? 2 : 1;
  return { normal: [{ item: 'any', output: 0 }, { item: 'any', output: F }], acc: [{ item: 'any', output: 0 }], mel: [{ item: 'any', output: F }] }[mode];
};
const mode = {};
async function poser(C, m) {
  await rpc('smartRules', st.actors['dechets cellule ' + C + ' SA'], REGLES(C, m));
  mode[C] = m;
}
async function remettre() { for (const C of CELLS) await poser(C, 'normal'); console.log(new Date().toTimeString().slice(0, 8), 'partage normal remis sur les 8 cellules'); }
async function stock(C) {
  const d = await rpc('dump', st.actors[C + ' accelerateur'], 1, 1, ['mInputInventory']);
  const s = await rpc('dump', d.mInputInventory, 4, 30, ['mInventoryStacks']);
  const n = (re) => (s.mInventoryStacks || []).filter((x) => re.test(String(x.Item && x.Item.ItemClass))).reduce((a, x) => a + x.NumItems, 0);
  // classe du jeu : Desc_NonFissibleUranium_C (avec un b)
  return { nf: n(/NonFissibleUranium/), w: n(/NuclearWaste/) };
}
(async () => {
  if (process.argv.includes('--remettre')) return remettre();
  await remettre();
  const t0 = Date.now();
  let bilan = 0, normalDepuis = null;
  while (Date.now() - t0 < MAX) {
    const l = [];
    for (const C of CELLS) {
      const { nf, w } = await stock(C), e = w - nf / 4;
      let m = mode[C];
      if (e > SEUIL) m = 'mel';
      else if (e < -SEUIL) m = 'acc';
      else if (Math.abs(e) <= RETOUR) m = 'normal';
      if (m !== mode[C]) { await poser(C, m); console.log(new Date().toTimeString().slice(0, 8), C, 'NF', nf, 'dechets', w, 'ecart', Math.round(e), '->', m); }
      l.push(C + ' ' + nf + '/' + w + (m === 'normal' ? '' : ' ' + m));
    }
    if (Date.now() - bilan >= 120e3) { bilan = Date.now(); console.log(new Date().toTimeString().slice(0, 8), 'bilan NF/dechets :', l.join(', ')); }
    if (CELLS.every((C) => mode[C] === 'normal')) {
      normalDepuis = normalDepuis || Date.now();
      if (Date.now() - normalDepuis >= STABLE) { console.log(new Date().toTimeString().slice(0, 8), 'equilibre : 8 cellules au partage normal, fin ; NF/dechets :', l.join(', ')); return; }
    } else normalDepuis = null;
    await sleep(PERIODE);
  }
  console.log(new Date().toTimeString().slice(0, 8), 'duree maximale atteinte');
  await remettre();
})().catch(async (e) => { console.log('ERREUR', e.message); process.exitCode = 1; try { await remettre(); } catch (e2) { console.log('ERREUR remise', e2.message); } });
