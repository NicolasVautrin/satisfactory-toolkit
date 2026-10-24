// Convoyeurs des foreuses de l'ancien Venray aux tampons du terminus (gare en l'air a 111,9 m, layouts/terminus-ici.js ;
// utilisateur, 23/10/2026 : « etends le traceur aux convoyeurs et pose-les »). Pour chaque ligne, du haut vers le bas
// (un ascenseur montant accroche au bout d'un convoyeur se pose a l'envers : references/convoyeurs.md) :
//  1. haut : convoyeur court de l'entree du tampon (Input0 a 112,9 m ou Input1 a 116,9 m) au bord de la bande de
//     fondations, sur un poteau de 1 ou 5 m pose sur la bande, decale de 3 m vers le nord (Input0) ou le sud (Input1) :
//     les deux ascenseurs d'un tampon ne tiennent pas dans la meme colonne ; puis ascenseur du bout de ce convoyeur
//     jusqu'a 1 m du sol (80 m), hors de la bande ; pied tourne vers l'ouest (fer, arrive de l'ouest sous la gare) ou vers
//     l'est (cuivre, caterium, arrivent de l'est : pas de croisement avec le fer) ;
//  2. trace : ligne au sol par tracer.js convoyeur, de la sortie de la foreuse au pied de l'ascenseur (les lignes deja
//     posees sont des obstacles) ;
//  3. pose : beltline.js build du fichier de ligne.
// Fer : les deux foreuses de l'est au quai 4 (nord), les deux de l'ouest au quai 3, dont les lignes passent a l'ouest.
// node convoyeurs-ici.js <ligne|tout> haut|trace|pose|tout [--dry]
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { call, short } = require('./client');

const P = '/Game/FactoryGame/Map/GameLevel01/Persistent_Level.Persistent_Level:PersistentLevel.';
const DRY = process.argv.includes('--dry');
const tampons = JSON.parse(fs.readFileSync(path.join(__dirname, 'terminus-ici-tampons-state.json'), 'utf8')).conteneurs;
const BAND_EDGE = -35786; // x du poteau sur la bande (bord est de la bande a -35 686)
// recette, foreuse, tampon, entree, decalage en y du bout sur la bande, molette du pied de l'ascenseur
const LIGNES = {
  fe2: { foreuse: 'Build_MinerMk3_C_2147056815', tampon: 'q4-fer', entree: 'Input0', dy: -300, pied: 0 },
  fe1: { foreuse: 'Build_MinerMk3_C_2145937634', tampon: 'q4-fer', entree: 'Input1', dy: 300, pied: 0 },
  // quai 3 : la colline sous la gare remonte a 92 m juste a l'ouest de ses ascenseurs : pied tourne vers l'est
  fe3: { foreuse: 'Build_MinerMk3_C_2145941723', tampon: 'q3-fer', entree: 'Input0', dy: -300, pied: 180 },
  fe4: { foreuse: 'Build_MinerMk3_C_2145936114', tampon: 'q3-fer', entree: 'Input1', dy: 300, pied: 180 },
  cu1: { foreuse: 'Build_MinerMk3_C_2145085533', tampon: 'q2-cuivre', entree: 'Input0', dy: -300, pied: 180 },
  cu2: { foreuse: 'Build_MinerMk3_C_2145085934', tampon: 'q2-cuivre', entree: 'Input1', dy: 300, pied: 180 },
  cat: { foreuse: 'Build_MinerMk3_C_2144707923', tampon: 'q1-caterium', entree: 'Input0', dy: -300, pied: 180 },
};
// hauteur de poteau demandee : le jeu en donne 1 m de moins (references/convoyeurs.md)
const POLE = { Input0: 200, Input1: 600 };
const SF = path.join(__dirname, 'convoyeurs-ici-state.json');
const st = fs.existsSync(SF) ? JSON.parse(fs.readFileSync(SF, 'utf8')) : {};
const save = () => { if (!DRY) fs.writeFileSync(SF, JSON.stringify(st, null, 1)); };
const node = (args) => execFileSync(process.execPath, args, { cwd: __dirname, encoding: 'utf8', maxBuffer: 1 << 26 });

const PH = {
  async haut(k, L) {
    const s = (st[k] = st[k] || {});
    const box = tampons[L.tampon];
    const inp = (await call('connections', box)).find((c) => c.name === L.entree);
    if (!s.court) {
      const to = { x: BAND_EDGE, y: inp.location.y + L.dy, z: 11190 };
      const r = await call('belt', 'Recipe_ConveyorBeltMk6_C', box, L.entree, to, { poleHeight: POLE[L.entree], dryRun: DRY });
      console.log(k, 'convoyeur court', L.tampon + '.' + L.entree, '->', JSON.stringify(r.to), r.built ? short(r.actor) : 'essai', JSON.stringify(r.blocking || []));
      if (!r.built) { if (!DRY) throw new Error(k + ' : convoyeur court non construit'); return; }
      s.court = r.actor; save();
    }
    if (!s.ascenseur) {
      const free = (await call('connections', s.court)).find((c) => !c.connected);
      // pied 1 m au-dessus du plus haut des deux sols : sous l'ascenseur et 5 m devant son pied (point d'approche de la
      // ligne au sol) ; sinon le dernier troncon est trop raide (cuivre : sol 2,3 m plus haut devant le pied)
      const xa = BAND_EDGE + 400 + (L.pied === 180 ? 500 : -500);
      const g = Math.max((await call('relief', BAND_EDGE + 400, free.location.y, 1, 1, 100, 30000, -5000)).z[0],
        (await call('relief', xa, free.location.y, 1, 1, 100, 30000, -5000)).z[0]);
      const r = await call('belt', 'Recipe_ConveyorLiftMk6_C', s.court, free.name, { x: BAND_EDGE + 400, y: free.location.y, z: g },
        { endZ: g + 100, snapTolerance: 1000, endScroll: L.pied, dryRun: DRY });
      console.log(k, 'ascenseur de', (free.location.z / 100).toFixed(1), 'm a', ((g + 100) / 100).toFixed(1), 'm', r.built ? short(r.actor) : 'essai', JSON.stringify(r.blocking || []), r.hologram ? JSON.stringify(r.hologram.location) : '');
      if (!r.built) { if (!DRY) throw new Error(k + ' : ascenseur non construit'); return; }
      s.ascenseur = r.actor; save();
    }
  },
  async trace(k, L) {
    const s = st[k];
    if (!s || !s.ascenseur) throw new Error(k + ' : pas d\'ascenseur (phase haut)');
    const foot = (await call('connections', s.ascenseur)).find((c) => !c.connected);
    console.log(k, 'pied de l\'ascenseur', foot.name, Math.round(foot.location.x), Math.round(foot.location.y), (foot.location.z / 100).toFixed(1) + ' m');
    const out = node(['tracer.js', 'convoyeur', '--de', L.foreuse + '.Output0', '--a', short(s.ascenseur) + '.' + foot.name, '--nom', 'ici-' + k, '--frais']);
    console.log(out.split('\n').filter((l) => /ligne|ECHEC/.test(l)).join('\n'));
    s.ligne = 'traces/ici-' + k + '-ligne.json'; save();
  },
  async pose(k) {
    const s = st[k];
    if (!s || !s.ligne) throw new Error(k + ' : pas de ligne (phase trace)');
    const out = node(['beltline.js', s.ligne, DRY ? 'check' : 'build', '--nom', 'ici-' + k + '-sol']);
    console.log(out.trim().split('\n').slice(-4).join('\n'));
    if (!DRY) { s.pose = true; save(); }
  },
};

(async () => {
  const [which, phase] = process.argv.slice(2);
  const keys = which === 'tout' ? Object.keys(LIGNES) : [which];
  for (const k of keys) {
    if (!LIGNES[k]) throw new Error('ligne inconnue : ' + k + ' (' + Object.keys(LIGNES).join(', ') + ')');
    for (const ph of phase === 'tout' ? ['haut', 'trace', 'pose'] : [phase]) {
      if (!PH[ph]) throw new Error('phase inconnue : ' + ph);
      if (ph === 'pose' && st[k] && st[k].pose) continue;
      await PH[ph](k, LIGNES[k]);
    }
  }
})().catch((e) => { console.error('ECHEC :', e.message); process.exitCode = 1; });
