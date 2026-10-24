// Convoyeurs de la bauxite du quai 1 de la gare S13 E101 (G15 du solveur ; utilisateur, 24/10/2026 : « ok on va chercher
// la bauxite »), d'apres convoyeurs-mines.js. Tampon du quai pose en l'air au niveau des rails (tampons-quais.js
// s13e101-gare : entrees Input0 a 162 m et Input1 a 166 m, superposees, face au sud-sud-est, cap 72), sol ~125-130 m.
// Deux lignes de 1 200/min (Mk6 plein) :
//  - 634 (pure) : au bord ouest d'un plateau a 175 m, falaise de 75 m a 16 m du gisement ; sortie a l'ouest, relais en
//    l'air au-dela du bord, deux ascenseurs bout a bout jusqu'au sol (48 m au plus chacun) ;
//  - 633 + 635 + 636 : deux fusionneurs dans la cuvette (le premier au sol, sortie au nord ; le second pose sur la ligne
//    de la 635, ou entre la 636), sortie du premier.
// Phases :
//  haut     : pour chaque entree du tampon, relais en l'air (fusionneur) au-dessus de la banquette sud-est, convoyeur
//             suspendu du relais a l'entree, ascenseur accroche a l'entree arriere du relais jusqu'au pied (1 m au-dessus
//             du plus haut des deux sols : sous la colonne et 5 m devant), pied tourne vers l'est ;
//  descente : 634 -> relais au-dela du bord de la falaise -> ascenseur -> ascenseur jusqu'au sol ;
//  trace    : ligne au sol (tracer.js convoyeur --frais) du depart (pied de la descente, sortie du fusionneur) au pied de
//             l'ascenseur de son entree ;
//  pose     : beltline.js build du fichier de ligne (teleporte le joueur le long de la ligne).
// node convoyeurs-s13e101.js <ligne|tout> haut|descente|trace|pose [--dry] [--scroll=<deg>] [--marge <m>] [--releve <m>]
//   etat : plans/convoyeurs-s13e101-state.json
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { call, short } = require('./client');

const P = '/Game/FactoryGame/Map/GameLevel01/Persistent_Level.Persistent_Level:PersistentLevel.';
const DRY = process.argv.includes('--dry');
const REC = { merger: 'Recipe_ConveyorAttachmentMerger_C', belt: 'Recipe_ConveyorBeltMk6_C', lift: 'Recipe_ConveyorLiftMk6_C' };
const AIR = { ignore: ['FGCDInvalidFloor'] };
const TAMPON = 'Build_StorageContainerMk2_C_2146262335';
// Sous le tampon, le sol (132 m) est une poche fermee par la roche a l'ouest, au sud et a l'est (ouverte au nord, sous la
// gare) : aucune ligne venue de la cuvette n'y descend (marche de 12 m a pic au sud ; 24/10/2026, deux essais de pied au
// fond de la poche : « troncon de bout trop raide », puis grille fermee). Les relais sont donc poses a la hauteur des
// entrees au-dessus de la banquette a 141-144 m au sud-est (convoyeur suspendu de 45 a 48 m jusqu'au tampon, 56 m au plus
// pour le jeu), les ascenseurs descendent sur cette banquette, pieds tournes vers l'est, sur le plat (couloirs a 5,5 m).
// relais : position (sortie a l'ouest, entree arriere a l'est), pied : sens de la colonne et du pied
const LIGNES = {
  // depart : connecteur de depart de la ligne au sol (pour la 634 : pied de la descente, connu apres la phase descente)
  'q1-634': { entree: 'Input0', relais: { x: 107000, y: 17700 }, pied: { x: 1, y: 0 }, foreuse: 'Build_MinerMk3_C_2146250172', descente: true },
  // fusionneur repose 1,2 m au-dessus du sol (au ras du sol, le premier troncon vers la gare etait trop raide)
  'q1-fusion': { entree: 'Input1', relais: { x: 107000, y: 18250 }, pied: { x: 1, y: 0 }, depart: 'Build_ConveyorAttachmentMerger_C_2146193747.Output1' },
};
// descente de la 634 : sortie (116 078 ; 51 511 ; 174,7 m) a l'ouest, bord de la falaise a x ~115 280
const DESCENTE = { relaisX: 114900 };
const SF = path.join(__dirname, 'convoyeurs-s13e101-state.json');
const st = fs.existsSync(SF) ? JSON.parse(fs.readFileSync(SF, 'utf8')) : {};
const save = () => { if (!DRY) fs.writeFileSync(SF, JSON.stringify(st, null, 1)); };
const node = (args) => execFileSync(process.execPath, args, { cwd: __dirname, encoding: 'utf8', maxBuffer: 1 << 26 });
const r0 = (p) => `(${Math.round(p.x)} ; ${Math.round(p.y)} ; ${(p.z / 100).toFixed(1)} m)`;
const reliefAt = async (x, y) => (await call('relief', x, y, 1, 1, 100, 30000, -5000)).z[0];
const scrollArg = () => { const a = process.argv.find((x) => x.startsWith('--scroll=')); return a ? Number(a.split('=')[1]) : null; };
const freeEnd = async (a) => (await call('connections', a)).filter((c) => !c.connected && /ConveyorAny/.test(c.name)).reduce((x, y) => (x && x.location.z < y.location.z ? x : y), null);

function report(key, r) {
  console.log(key.padEnd(28), r.built ? 'construit ' + short(r.actor) : DRY ? 'essai' : 'NON construit',
    r.blocking && r.blocking.length ? 'BLOQUANT ' + JSON.stringify(r.blocking) : '');
  if (!DRY && !r.built) throw new Error(key + ' : non construit');
}

const PH = {
  async haut(k, L) {
    const s = (st[k] = st[k] || {});
    const inp = (await call('connections', P + TAMPON)).find((c) => c.name === L.entree);
    const ene = L.pied; // sens de l'entree arriere du relais, de la colonne et du pied
    const yaw = (Math.atan2(-ene.y, -ene.x) * 180) / Math.PI; // sortie du relais a l'oppose
    const at = { x: L.relais.x, y: L.relais.y, z: inp.location.z };
    const span = Math.hypot(at.x - 100 * ene.x - inp.location.x, at.y - 100 * ene.y - inp.location.y);
    if (span > 5400) throw new Error(k + ' : convoyeur suspendu de ' + Math.round(span / 100) + ' m (56 m au plus pour le jeu)');
    if (!s.relais) {
      const r = await call('build', REC.merger, at, yaw, Object.assign({ dryRun: DRY }, AIR));
      report(k + ' relais', r);
      if (!r.built) return;
      s.relais = r.actor; save();
    }
    if (!s.court) {
      const r = await call('belt', REC.belt, s.relais, 'Output1', { path: P + TAMPON, name: L.entree }, { dryRun: DRY });
      report(k + ' relais > ' + L.entree, r);
      if (!r.built) return;
      if (!r.snapped || r.snapped.some((q) => q === null)) throw new Error(k + ' : bout non accroche ' + JSON.stringify(r.snapped));
      s.court = r.actor; save();
    }
    if (!s.ascenseur) {
      const top = (await call('connections', s.relais)).find((c) => c.name === 'Input1');
      const col = { x: top.location.x + ene.x * 300, y: top.location.y + ene.y * 300 }; // colonne a la longueur du bras
      let foot = Math.max(await reliefAt(col.x, col.y), await reliefAt(col.x + ene.x * 500, col.y + ene.y * 500)) + 100;
      foot = Math.max(foot, top.location.z - 4700); // 48 m au plus pour un ascenseur
      const scroll = scrollArg() != null ? scrollArg() : 180;
      const r = await call('belt', REC.lift, s.relais, 'Input1', { x: col.x, y: col.y, z: foot }, { endZ: foot, snapTolerance: 400, endScroll: scroll, dryRun: DRY });
      report(k + ' ascenseur ' + ((top.location.z - foot) / 100).toFixed(1) + ' m', r);
      if (r.hologram) console.log('   hologramme', r0(r.hologram.location), 'cap', Math.round(r.hologram.rotation.yaw));
      if (!r.built) return;
      s.ascenseur = r.actor; save();
      const free = await freeEnd(s.ascenseur);
      const dot = free.normal.x * ene.x + free.normal.y * ene.y;
      console.log('   pied', free.name, r0(free.location), 'dans le sens voulu :', dot.toFixed(2));
      if (dot < 0.9) throw new Error(k + ' : pied de l\'ascenseur pas tourne dans le sens voulu (demonter et reprendre avec --scroll=' + (scroll + 180) % 360 + ')');
    }
  },
  async descente(k, L) {
    if (!L.descente) return;
    const s = (st[k] = st[k] || {});
    const out = (await call('connections', P + L.foreuse)).find((c) => /Output/.test(c.name));
    if (!s.relaisBas) {
      const r = await call('build', REC.merger, { x: DESCENTE.relaisX, y: out.location.y, z: out.location.z }, 180, Object.assign({ dryRun: DRY }, AIR));
      report(k + ' relais de falaise', r);
      if (!r.built) return;
      s.relaisBas = r.actor; save();
    }
    if (!s.sortie) {
      const r = await call('belt', REC.belt, P + L.foreuse, out.name, { path: s.relaisBas, name: 'Input1' }, { dryRun: DRY });
      report(k + ' foreuse > relais', r);
      if (!r.built) return;
      if (!r.snapped || r.snapped.some((q) => q === null)) throw new Error(k + ' : bout non accroche ' + JSON.stringify(r.snapped));
      s.sortie = r.actor; save();
    }
    if (!s.chute1) {
      const o = (await call('connections', s.relaisBas)).find((c) => c.name === 'Output1');
      const z = o.location.z - 4700;
      const r = await call('belt', REC.lift, s.relaisBas, 'Output1', { x: o.location.x - 300, y: o.location.y, z }, { endZ: z, snapTolerance: 400, endScroll: 0, dryRun: DRY });
      report(k + ' ascenseur de falaise 1 (47 m)', r);
      if (r.hologram) console.log('   hologramme', r0(r.hologram.location), 'cap', Math.round(r.hologram.rotation.yaw));
      if (!r.built) return;
      s.chute1 = r.actor; save();
      console.log('   bas', r0((await freeEnd(s.chute1)).location));
    }
    if (!s.chute2) {
      const b = await freeEnd(s.chute1);
      const ground = Math.max(await reliefAt(b.location.x - 400, b.location.y), await reliefAt(b.location.x - 900, b.location.y));
      const z = ground + 100;
      const scroll = scrollArg() != null ? scrollArg() : 0;
      const r = await call('belt', REC.lift, s.chute1, b.name, { x: b.location.x - 400, y: b.location.y, z }, { endZ: z, snapTolerance: 1000, endScroll: scroll, dryRun: DRY });
      report(k + ' ascenseur de falaise 2 (' + ((b.location.z - z) / 100).toFixed(1) + ' m)', r);
      if (r.hologram) console.log('   hologramme', r0(r.hologram.location), 'cap', Math.round(r.hologram.rotation.yaw));
      if (!r.built) return;
      s.chute2 = r.actor; save();
      const f = await freeEnd(s.chute2);
      console.log('   pied', f.name, r0(f.location), 'normale x', Math.round(f.normal.x * 100) / 100);
    }
  },
  async trace(k, L) {
    const s = st[k];
    if (!s || !s.ascenseur) throw new Error(k + ' : pas d\'ascenseur de gare (phase haut)');
    let de = L.depart;
    if (L.descente) {
      if (!s.chute2) throw new Error(k + ' : pas de descente (phase descente)');
      de = short(s.chute2) + '.' + (await freeEnd(s.chute2)).name;
    }
    const foot = await freeEnd(s.ascenseur);
    console.log(k, 'de', de, 'a', short(s.ascenseur) + '.' + foot.name, r0(foot.location));
    // --marge <m> : zone de recherche autour des deux bouts (60 m par defaut dans tracer.js) ; la ligne de la 634 doit
    // aller chercher le passage ouest de la cuvette, hors de la zone par defaut
    // --releve <m> : pas du releve du relief (2 m pour le passage sous l'arche de la cuvette, couloir de 4 a 6 m)
    const pass = ['--marge', '--releve'].flatMap((o) => { const i = process.argv.indexOf(o); return i > 0 ? [o, process.argv[i + 1]] : []; });
    // sortie du traceur laissee passer (progression du releve visible dans le journal)
    const r = spawnSync(process.execPath, ['tracer.js', 'convoyeur', '--de', de, '--a', short(s.ascenseur) + '.' + foot.name, '--nom', 's13e101-' + k, '--frais'].concat(pass), { cwd: __dirname, stdio: 'inherit' });
    if (r.status !== 0) throw new Error(k + ' : trace echoue (code ' + r.status + ')');
    s.ligne = 'traces/s13e101-' + k + '-ligne.json'; save();
  },
  async pose(k) {
    const s = st[k];
    if (!s || !s.ligne) throw new Error(k + ' : pas de ligne (phase trace)');
    const out = node(['beltline.js', s.ligne, DRY ? 'check' : 'build', '--nom', 's13e101-' + k + '-sol']);
    console.log(out.trim().split('\n').slice(-4).join('\n'));
    if (!DRY) { s.pose = true; save(); }
  },
};

(async () => {
  const [which, phase] = process.argv.slice(2);
  const keys = which === 'tout' ? Object.keys(LIGNES) : [which];
  if (!PH[phase] || keys.some((k) => !LIGNES[k])) throw new Error('usage : node convoyeurs-s13e101.js <' + Object.keys(LIGNES).join('|') + '|tout> ' + Object.keys(PH).join('|') + ' [--dry]');
  for (const k of keys) await PH[phase](k, LIGNES[k]);
})().catch((e) => { console.error('ECHEC :', e.message); process.exitCode = 1; });
