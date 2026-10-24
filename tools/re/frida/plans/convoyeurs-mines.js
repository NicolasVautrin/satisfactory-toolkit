// Convoyeurs des 8 foreuses de la gare des mines (couple -> 33, gare en l'air a 138 m, layouts/terminus-ici.js --bouts
// terminus-mines-bouts ; utilisateur, 23/10/2026 : « exploiter ces gisements ») vers les tampons des quais, poses en
// l'air sans fondations (tampons-quais.js terminus-mines : entrees Input0 a 139 m et Input1 a 143 m, superposees, face
// a l'est a x 80 700). Pas de bande de fondations pour porter les bouts hauts : pour chaque entree, du haut vers le bas
// (un ascenseur montant accroche au bout d'un convoyeur se pose a l'envers : references/convoyeurs.md) :
//  1. haut : relais en l'air (fusionneur, cap 180 : sortie vers l'ouest) 11 m a l'est des entrees, decale de 4 m vers
//     le sud (Input0) ou le nord (Input1) : les deux ascenseurs d'un tampon ne tiennent pas dans la meme colonne ;
//     convoyeur du relais a l'entree ; ascenseur accroche a l'entree est du relais, jusqu'au pied (1 m au-dessus du sol,
//     ou a la hauteur de la sortie de la foreuse pour une ligne courte), pied tourne vers l'arrivee de la ligne ;
//  2. trace : ligne au sol par tracer.js convoyeur, de la sortie de la foreuse au pied de l'ascenseur (--frais : les
//     lignes deja posees sont des obstacles) ; ligne courte (foreuse juste en face de sa colonne) : un seul convoyeur ;
//  3. pose : beltline.js build du fichier de ligne.
// Affectation : fer 431 + 435_26 au quai 1, cuivre 445 + caterium 487 au quai 2 (trie au dechargement a la 33), fer 427
// + 430 au quai 3, fer 437_30 + 426 au quai 4 ; foreuses de l'ouest pied a l'ouest, de l'est pied a l'est. Les lignes de
// l'ouest arrivent dans l'ordre de leur direction (du sud au nord : 431, 427, 430, 426) pour ne pas se croiser ; le
// cuivre, qui vient plein ouest et doit aller au quai 2, croise par-dessus celles des quais 3 et 4 (posees apres lui).
// Le caterium est sur un plateau borde d'une falaise (bord a x ~85 300, 30 m au-dessus de la cuvette) : ligne sur le
// plateau jusqu'a un ascenseur qui descend la falaise, fusionneur au pied, convoyeur jusqu'au pied de sa colonne.
// node convoyeurs-mines.js <ligne|tout> haut|trace|pose|tout [--dry]       etat : plans/convoyeurs-mines-state.json
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { call, short } = require('./client');

const P = '/Game/FactoryGame/Map/GameLevel01/Persistent_Level.Persistent_Level:PersistentLevel.';
const DRY = process.argv.includes('--dry');
const tampons = JSON.parse(fs.readFileSync(path.join(__dirname, 'terminus-mines-tampons-state.json'), 'utf8')).conteneurs;
const RELAY_X = 81800; // relais 11 m a l'est des entrees (x 80 700) : convoyeur de 10 m pour un decalage de 4 m
const DY = { Input0: 400, Input1: -400 }; // Input0 au sud (+y), Input1 au nord
const REC = { merger: 'Recipe_ConveyorAttachmentMerger_C', belt: 'Recipe_ConveyorBeltMk6_C', lift: 'Recipe_ConveyorLiftMk6_C' };
const AIR = { ignore: ['FGCDInvalidFloor'] };
// foreuse, tampon, entree, cote d'arrivee de la ligne au sol (pied de l'ascenseur), ligne courte (un seul convoyeur)
const LIGNES = {
  'q1-431': { foreuse: 'Build_MinerMk3_C_2147185658', tampon: 'q1-fer', entree: 'Input0', pied: 'ouest' },
  'q1-435': { foreuse: 'Build_MinerMk3_C_2147193270', tampon: 'q1-fer', entree: 'Input1', pied: 'est', court: true },
  // cuivre sur poteaux de 6 m : les lignes des quais 3 et 4 passent dessous a hauteur normale (franchissements par-dessus
  // refuses en pente, 23/10/2026)
  'q2-cu': { foreuse: 'Build_MinerMk3_C_2147185423', tampon: 'q2-cuivre+caterium', entree: 'Input0', pied: 'ouest', poteau: 6 },
  'q2-cat': { foreuse: 'Build_MinerMk3_C_2147167764', tampon: 'q2-cuivre+caterium', entree: 'Input1', pied: 'est', falaise: true },
  // 427 reposee sortie au nord (23/10/2026) : vers le nord-est, le sol devant sa sortie etait plus haut qu'elle
  'q3-427': { foreuse: 'Build_MinerMk3_C_2147116521', tampon: 'q3-fer', entree: 'Input0', pied: 'ouest' },
  'q3-430': { foreuse: 'Build_MinerMk3_C_2147185513', tampon: 'q3-fer', entree: 'Input1', pied: 'ouest' },
  'q4-437': { foreuse: 'Build_MinerMk3_C_2147193927', tampon: 'q4-fer', entree: 'Input0', pied: 'est', court: true },
  'q4-426': { foreuse: 'Build_MinerMk3_C_2147185785', tampon: 'q4-fer', entree: 'Input1', pied: 'ouest' },
};
// descente de la falaise (caterium) : fusionneur au pied de la falaise, a la hauteur du pied de la colonne, ascenseur
// jusqu'au bord du plateau (sol ~118 m a x 85 900 ; bord a x ~85 300)
const FALAISE = { x: 84100, top: 12100 };
const SF = path.join(__dirname, 'convoyeurs-mines-state.json');
const st = fs.existsSync(SF) ? JSON.parse(fs.readFileSync(SF, 'utf8')) : {};
const save = () => { if (!DRY) fs.writeFileSync(SF, JSON.stringify(st, null, 1)); };
const node = (args) => execFileSync(process.execPath, args, { cwd: __dirname, encoding: 'utf8', maxBuffer: 1 << 26 });
const r0 = (p) => `(${Math.round(p.x)} ; ${Math.round(p.y)} ; ${(p.z / 100).toFixed(1)} m)`;
const reliefAt = async (x, y) => (await call('relief', x, y, 1, 1, 100, 30000, -5000)).z[0];

function report(key, r) {
  console.log(key.padEnd(26), r.built ? 'construit ' + short(r.actor) : DRY ? 'essai' : 'NON construit',
    r.blocking && r.blocking.length ? 'BLOQUANT ' + JSON.stringify(r.blocking) : '');
  if (!DRY && !r.built) throw new Error(key + ' : non construit');
}

// Pied de falaise : fusionneur (sortie vers l'ouest) a la hauteur du pied de la colonne, convoyeur jusqu'a ce pied, puis
// ascenseur accroche a l'entree est du fusionneur, montant au bord du plateau, bras du haut tourne vers l'est (plateau)
async function falaise(k, s) {
  // pied de la colonne : le plus bas de ses deux bouts
  const foot = (await call('connections', s.ascenseur)).filter((c) => /ConveyorAny/.test(c.name)).reduce((a, b) => (a.location.z < b.location.z ? a : b));
  const y = foot.location.y;
  if (!s.pied) {
    const r = await call('build', REC.merger, { x: FALAISE.x, y, z: foot.location.z }, 180, Object.assign({ dryRun: DRY }, AIR));
    report(k + ' pied de falaise', r);
    if (!r.built) return;
    s.pied = r.actor; save();
  }
  if (!s.vers) {
    const r = await call('belt', REC.belt, s.pied, 'Output1', { path: s.ascenseur, name: foot.name }, { dryRun: DRY });
    report(k + ' falaise > colonne', r);
    if (!r.built) return;
    if (!r.snapped || r.snapped.some((q) => q === null)) throw new Error(k + ' : bout non accroche ' + JSON.stringify(r.snapped));
    s.vers = r.actor; s.sol = r.actor; save();
  }
  if (!s.falaise) {
    const inp = (await call('connections', s.pied)).find((c) => c.name === 'Input1');
    const r = await call('belt', REC.lift, s.pied, 'Input1', { x: inp.location.x + 300, y, z: FALAISE.top }, { endZ: FALAISE.top, snapTolerance: 400, endScroll: 180, dryRun: DRY });
    report(k + ' ascenseur de falaise ' + ((FALAISE.top - inp.location.z) / 100).toFixed(1) + ' m', r);
    if (r.hologram) console.log('   hologramme', r0(r.hologram.location), 'cap', Math.round(r.hologram.rotation.yaw));
    if (!r.built) return;
    s.falaise = r.actor; save();
    const top = (await call('connections', s.falaise)).find((c) => !c.connected && /ConveyorAny/.test(c.name));
    console.log('   haut', top.name, r0(top.location), 'normale x', Math.round(top.normal.x * 100) / 100);
    if (top.normal.x < 0.9) throw new Error(k + ' : haut de l\'ascenseur de falaise pas tourne vers l\'est');
  }
}

const PH = {
  async haut(k, L) {
    const s = (st[k] = st[k] || {});
    const box = P + short(tampons[L.tampon]);
    const inp = (await call('connections', box)).find((c) => c.name === L.entree);
    const y = inp.location.y + DY[L.entree];
    if (!s.relais) {
      const r = await call('build', REC.merger, { x: RELAY_X, y, z: inp.location.z }, 180, Object.assign({ dryRun: DRY }, AIR));
      report(k + ' relais', r);
      if (!r.built) return;
      s.relais = r.actor; save();
      for (const c of await call('connections', s.relais)) console.log('  ', c.name, r0(c.location), 'normale', Math.round(c.normal.x * 100) / 100, Math.round(c.normal.y * 100) / 100);
    }
    if (!s.court) {
      const r = await call('belt', REC.belt, s.relais, 'Output1', { path: box, name: L.entree }, { dryRun: DRY });
      report(k + ' relais > ' + L.entree, r);
      if (!r.built) return;
      if (!r.snapped || r.snapped.some((q) => q === null)) throw new Error(k + ' : bout non accroche ' + JSON.stringify(r.snapped));
      s.court = r.actor; save();
    }
    if (!s.ascenseur) {
      const top = (await call('connections', s.relais)).find((c) => c.name === 'Input1');
      const xc = top.location.x + 300; // colonne de l'ascenseur, a la longueur de son bras
      const sens = L.pied === 'est' ? 1 : -1;
      let foot;
      if (L.court) {
        // ligne courte : pied a la hauteur de la sortie de la foreuse (convoyeur horizontal)
        foot = (await call('connections', P + L.foreuse)).find((c) => /Output/.test(c.name)).location.z;
      } else {
        // pied 1 m au-dessus du plus haut des deux sols : sous l'ascenseur et 5 m devant son pied (point d'approche)
        foot = Math.max(await reliefAt(xc, y), await reliefAt(xc + sens * 500, y)) + 100;
      }
      foot = Math.max(foot, top.location.z - 4700); // 48 m au plus pour un ascenseur
      const scroll = Number((process.argv.find((a) => a.startsWith('--scroll=')) || '--scroll=' + (L.pied === 'est' ? 180 : 0)).split('=')[1]);
      const r = await call('belt', REC.lift, s.relais, 'Input1', { x: xc, y, z: foot }, { endZ: foot, snapTolerance: 400, endScroll: scroll, dryRun: DRY });
      report(k + ' ascenseur ' + ((top.location.z - foot) / 100).toFixed(1) + ' m', r);
      if (r.hologram) console.log('   hologramme', r0(r.hologram.location), 'cap', Math.round(r.hologram.rotation.yaw));
      if (!r.built) return;
      s.ascenseur = r.actor; save();
      const free = (await call('connections', s.ascenseur)).find((c) => !c.connected && /ConveyorAny/.test(c.name));
      console.log('   pied', free.name, r0(free.location), 'normale x', Math.round(free.normal.x * 100) / 100);
      if (free.normal.x * sens < 0.9) throw new Error(k + ' : pied de l\'ascenseur pas tourne vers l\'' + L.pied + ' (demonter et reprendre avec --scroll=' + (scroll + 180) % 360 + ')');
    }
    if (L.falaise) await falaise(k, s);
  },
  async trace(k, L) {
    const s = st[k];
    if (!s || !s.ascenseur) throw new Error(k + ' : pas d\'ascenseur (phase haut)');
    if (L.court) return; // un seul convoyeur, pose a la phase pose
    if (L.falaise && !s.falaise) throw new Error(k + ' : pas d\'ascenseur de falaise (phase haut)');
    const to = L.falaise ? s.falaise : s.ascenseur; // ligne du plateau jusqu'au haut de l'ascenseur de falaise
    const foot = (await call('connections', to)).find((c) => !c.connected && /ConveyorAny/.test(c.name));
    console.log(k, 'arrivee', short(to), foot.name, r0(foot.location));
    const out = node(['tracer.js', 'convoyeur', '--de', L.foreuse + '.Output0', '--a', short(to) + '.' + foot.name, '--nom', 'mines-' + k, '--frais'].concat(L.poteau ? ['--poteau', String(L.poteau)] : []));
    console.log(out.split('\n').filter((l) => /ligne|ECHEC/.test(l)).join('\n'));
    s.ligne = 'traces/mines-' + k + '-ligne.json'; save();
  },
  async pose(k, L) {
    const s = st[k];
    if (L.court) {
      if (!s || !s.ascenseur) throw new Error(k + ' : pas d\'ascenseur (phase haut)');
      const foot = (await call('connections', s.ascenseur)).find((c) => !c.connected && /ConveyorAny/.test(c.name));
      const r = await call('belt', REC.belt, P + L.foreuse, 'Output0', { path: s.ascenseur, name: foot.name }, { dryRun: DRY });
      report(k + ' foreuse > ascenseur', r);
      if (r.built) {
        if (!r.snapped || r.snapped.some((q) => q === null)) throw new Error(k + ' : bout non accroche ' + JSON.stringify(r.snapped));
        s.sol = r.actor; s.pose = true; save();
      }
      return;
    }
    if (!s || !s.ligne) throw new Error(k + ' : pas de ligne (phase trace)');
    const out = node(['beltline.js', s.ligne, DRY ? 'check' : 'build', '--nom', 'mines-' + k + '-sol']);
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
