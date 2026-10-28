// Veille des dechets en sortie des centrales du module nucleaire 1 (utilisateur, 28/10/2026 : « oui surveille les
// dechets » ; regle : alerter des ~10 dechets dans la sortie d'une centrale, jamais attendre 300). Releve, toutes les
// periode s, de l'inventaire de sortie (mOutputInventory), du combustible (mFuelInventory) et du reste de dechets du
// combustible en cours de chaque centrale ; une ligne par releve dans le journal ; s'arrete au premier seuil atteint (ou a
// la duree maximale) en disant quelles centrales. L'hote ne traite qu'un appel a la fois : un appel refuse est repris.
// usage : node veille-dechets.js [seuil=10] [periode_s=120] [duree_max_h=6] [--une-fois]
const fs = require('fs');
const path = require('path');
const { call } = require('./client');
const st = JSON.parse(fs.readFileSync(path.join(__dirname, 'module1-state.json'), 'utf8'));
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const SEUIL = Number(args[0] || 10), PERIODE = Number(args[1] || 120) * 1000, MAX = Number(args[2] || 6) * 3600e3;
const UNE = process.argv.includes('--une-fois');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function retry(...a) {
  for (let i = 0; ; i++) {
    try { return await call(...a); } catch (e) { if (i >= 5) throw e; await sleep(2000); }
  }
}
async function compte(inv) {
  const s = await retry('dump', inv, 4, 60, ['mInventoryStacks']);
  const out = {};
  for (const x of s.mInventoryStacks || []) {
    if (!x.NumItems) continue;
    const c = String(x.Item && x.Item.ItemClass).split('.').pop().replace(/^Desc_|_C$/g, '');
    out[c] = (out[c] || 0) + x.NumItems;
  }
  return out;
}
(async () => {
  const plants = Object.entries(st.actors).filter(([k]) => /^R\d \d+ centrale$/.test(k));
  const t0 = Date.now();
  for (;;) {
    let dechets = 0, barres = 0, enMarche = 0, sansEau = 0;
    const alertes = [];
    for (const [k, p] of plants) {
      const d = await retry('dump', p, 1, 1, ['mOutputInventory', 'mFuelInventory', 'mWasteLeftFromCurrentFuel', 'mCurrentFuelAmount']);
      const w = Object.values(await compte(d.mOutputInventory)).reduce((a, b) => a + b, 0);
      // reservoir : emplacement 0 = barres, emplacement 1 = eau (en litres, 50 000 = plein)
      const fuel = await compte(d.mFuelInventory), eau = fuel.Water || 0;
      delete fuel.Water;
      dechets += w; barres += Object.values(fuel).reduce((a, b) => a + b, 0);
      if (eau < 25000) sansEau++;
      if (d.mCurrentFuelAmount > 0) enMarche++;
      if (w >= SEUIL) alertes.push(k.replace(' centrale', '') + ' : ' + w);
    }
    console.log(new Date().toLocaleTimeString('fr-FR'), '|', plants.length, 'centrales,', enMarche, 'en marche,', sansEau, 'a moins de moitie d\'eau | barres en attente', barres, '| dechets en sortie', dechets);
    if (alertes.length) { console.log('ALERTE dechets >=', SEUIL, ':', alertes.join(', ')); return; }
    if (UNE || Date.now() - t0 > MAX) return;
    await sleep(PERIODE);
  }
})().catch((e) => { console.log('ERREUR', e.message); process.exitCode = 1; });
