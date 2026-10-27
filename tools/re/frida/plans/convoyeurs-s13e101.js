// Convoyeurs de la bauxite du quai 1 de la gare S13 E101 (G15 du solveur ; utilisateur, 24/10/2026 : « ok on va chercher
// la bauxite »), d'apres convoyeurs-mines.js. Tampon du quai pose en l'air au niveau des rails (tampons-quais.js
// s13e101-gare : entrees Input0 a 162 m et Input1 a 166 m, superposees, face au sud-sud-est, cap 72), sol ~125-130 m.
// Deux lignes de 1 200/min (Mk6 plein) :
//  - 634 (pure) : au bord ouest d'un plateau a 175 m, falaise de 75 m a 16 m du gisement ; sortie a l'ouest, relais en
//    l'air au-dela du bord, deux ascenseurs bout a bout jusqu'au sol (48 m au plus chacun) ;
//  - 633 + 635 + 636 : deux fusionneurs dans la cuvette (le premier au sol, sortie au nord ; le second pose sur la ligne
//    de la 635, ou entre la 636), sortie du premier.
// Cuivre et fer des quais 2 a 4 (utilisateur, 24/10/2026 : « on passe au cuivre et au fer ») : six gisements purs sur le
// plateau a l'est (155-165 m), une ligne pleine par entree de tampon. La poche sous les tampons (125-135 m) s'ouvre au
// nord, sous la gare, sur la cuvette qui mene au plateau : relais a 6 m devant les entrees des quais 2 et 3, ascenseurs
// dans la poche, pieds tournes vers le quai (lignes vers le nord). Devant le quai 4, une banquette a 158 m (crete a
// l'est) : ses relais sont a 20 m au sud-ouest, convoyeurs suspendus jusqu'a l'entree. Relais q2 a 2 m de l'axe de
// l'entree au plus : les convoyeurs suspendus de la bauxite (q1) passent 13 m au sud.
// Phases :
//  haut     : pour chaque entree du tampon, relais en l'air (fusionneur) au-dessus de la banquette sud-est, convoyeur
//             suspendu du relais a l'entree, ascenseur accroche a l'entree arriere du relais jusqu'au pied (1 m au-dessus
//             du plus haut des deux sols : sous la colonne et 5 m devant), pied tourne vers l'est ;
//  descente : 634 -> relais au-dela du bord de la falaise -> ascenseur -> ascenseur jusqu'au sol ;
//  falaise  : lignes du plateau (f<gisement>) : relais au-dela du bord de la falaise du plateau, ascenseur jusqu'au fond ;
//  trace    : ligne au sol (tracer.js convoyeur --frais) du depart (pied de la descente, sortie du fusionneur, pied de
//             falaise de la ligne du plateau « depuis ») au pied de l'ascenseur de son entree ; lignes du plateau : de la
//             foreuse au relais de falaise ;
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
  // rel : relais dans le repere de l'entree (m ; n le long de sa normale, vers l'exterieur ; t le long du quai, vers le
  // bout de la gare) ; pied absent : de l'entree vers le relais ; sortie 'quai' : connecteur du pied tourne vers le quai
  'q2-a': { tampon: 'Build_StorageContainerMk2_C_2145989477', entree: 'Input0', rel: { t: -2, n: 6 }, sortie: 'quai' },
  'q2-b': { tampon: 'Build_StorageContainerMk2_C_2145989477', entree: 'Input1', rel: { t: 2, n: 6 }, sortie: 'quai' },
  'q3-a': { tampon: 'Build_StorageContainerMk2_C_2145989464', entree: 'Input0', rel: { t: -2, n: 6 }, sortie: 'quai' },
  'q3-b': { tampon: 'Build_StorageContainerMk2_C_2145989464', entree: 'Input1', rel: { t: 2, n: 6 }, sortie: 'quai' },
  'q4-a': { tampon: 'Build_StorageContainerMk2_C_2145989435', entree: 'Input0', rel: { t: -16, n: 20 }, sortie: 'quai' },
  // q4-b : relais d'abord a t -10, pied a 2 m du flanc de la banquette (146-162 m, a l'est) et le couloir c11 -> q4-b
  // longe un surplomb ; repose le 25/10/2026 a l'ouest de q4-a, sur le fond plat de la poche (124-134 m) ouvert au nord,
  // pour la ligne du caterium 169 venue du nord-ouest
  'q4-b': { tampon: 'Build_StorageContainerMk2_C_2145989435', entree: 'Input1', rel: { t: -22, n: 20 }, sortie: 'quai' },
  // Lignes du plateau : foreuse -> relais de falaise. Le plateau tombe sur la cuvette par une falaise de 20 a 30 m a pic,
  // du nord-nord-est (125 000 ; 600) au sud-sud-ouest (118 000 ; 11 000), sans rampe assez douce pour un convoyeur
  // (24/10/2026 : grille fermee, carte des mailles atteintes depuis les deux bouts). Une descente par ligne, du nord au
  // sud dans l'ordre des foreuses sur le plateau (pas de croisement) : falaise.y = ligne du profil, falaise.x0 = point du
  // plateau 20 m a l'est du bord
  'f518': { foreuse: 'Build_MinerMk3_C_2145984846', falaise: { y: 2000, x0: 126000 } },
  'f513': { foreuse: 'Build_MinerMk3_C_2145985181', falaise: { y: 2800, x0: 125600 } },
  // 515 : foreuse reposee le 25/10/2026, sortie au nord-est vers la pile du plateau
  'f515': { foreuse: 'Build_MinerMk3_C_2145855932', falaise: { y: 3600, x0: 124800, pile: { plan: 'layouts/pile-s13e101-cuvette.json', ligne: '515' } } },
  'f517': { foreuse: 'Build_MinerMk3_C_2145984986', falaise: { y: 4800, x0: 124000, pile: { plan: 'layouts/pile-s13e101-cuvette.json', ligne: '517' } } },
  // 514 : descente d'abord a y 6 000, deplacee a y 4 200 (25/10/2026) quand 513, 515 et 514 sont passees en pile sur le
  // plateau (utilisateur : « mets les trois en pile ») : la pile se termine pres des relais 513 et 515
  'f514': { foreuse: 'Build_MinerMk3_C_2145985068', falaise: { y: 4200, x0: 124200, pile: { plan: 'layouts/pile-s13e101-cuvette.json', ligne: '514' } } },
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
    if (L.falaise) return;
    const s = (st[k] = st[k] || {});
    const tampon = P + (L.tampon || TAMPON);
    const inp = (await call('connections', tampon)).find((c) => c.name === L.entree);
    const n = { x: inp.normal.x, y: inp.normal.y }, t = { x: n.y, y: -n.x }; // repere de l'entree
    const relais = L.rel ? { x: inp.location.x + (L.rel.t * t.x + L.rel.n * n.x) * 100, y: inp.location.y + (L.rel.t * t.y + L.rel.n * n.y) * 100 } : L.relais;
    let ene = L.pied; // sens de l'entree arriere du relais et de la colonne
    if (!ene) { const dx = relais.x - inp.location.x, dy = relais.y - inp.location.y, d = Math.hypot(dx, dy); ene = { x: dx / d, y: dy / d }; }
    const want = L.sortie === 'quai' ? { x: -n.x, y: -n.y } : ene; // sens voulu du connecteur du pied
    const yaw = (Math.atan2(-ene.y, -ene.x) * 180) / Math.PI; // sortie du relais a l'oppose
    const at = { x: relais.x, y: relais.y, z: inp.location.z };
    const span = Math.hypot(at.x - 100 * ene.x - inp.location.x, at.y - 100 * ene.y - inp.location.y);
    if (span > 5400) throw new Error(k + ' : convoyeur suspendu de ' + Math.round(span / 100) + ' m (56 m au plus pour le jeu)');
    if (!s.relais) {
      const r = await call('build', REC.merger, at, yaw, Object.assign({ dryRun: DRY }, AIR));
      report(k + ' relais', r);
      if (!r.built) return;
      s.relais = r.actor; save();
    }
    if (!s.court) {
      let r = await call('belt', REC.belt, s.relais, 'Output1', { path: tampon, name: L.entree }, { dryRun: DRY });
      // zone de degagement souple seule en cause (q4-b repose a l'ouest, 25/10/2026 : batiment en cause non trouve, aucun
      // relais voisin a moins de 4 m) : acceptee apres un essai a blanc, comme pour les piles (references/convoyeurs.md)
      const soft = ['FGCDEncroachingSoftClearance'];
      if (!r.built && r.blocking && r.blocking.length === 1 && r.blocking[0] === soft[0]) {
        const t = await call('belt', REC.belt, s.relais, 'Output1', { path: tampon, name: L.entree }, { dryRun: true, ignore: soft });
        if (!(t.blocking && t.blocking.length)) {
          console.log(k + ' relais > ' + L.entree + ' : degagement souple seul en cause, accepte');
          r = await call('belt', REC.belt, s.relais, 'Output1', { path: tampon, name: L.entree }, { dryRun: DRY, ignore: soft });
        }
      }
      report(k + ' relais > ' + L.entree, r);
      if (!r.built) return;
      if (!r.snapped || r.snapped.some((q) => q === null)) throw new Error(k + ' : bout non accroche ' + JSON.stringify(r.snapped));
      s.court = r.actor; save();
    }
    if (!s.ascenseur) {
      const top = (await call('connections', s.relais)).find((c) => c.name === 'Input1');
      const col = { x: top.location.x + ene.x * 300, y: top.location.y + ene.y * 300 }; // colonne a la longueur du bras
      // sol sous la colonne et 5 m devant le pied
      let foot = Math.max(await reliefAt(col.x, col.y), await reliefAt(col.x + want.x * 500, col.y + want.y * 500)) + 100;
      foot = Math.max(foot, top.location.z - 4700); // 48 m au plus pour un ascenseur
      // sens du pied selon la rotation (molette) : pas connu d'avance hors du cas de la bauxite (180 : pied dans le sens de
      // la colonne) ; un ascenseur pose avec le pied dans un autre sens est demonte et repose avec la rotation suivante
      const scrolls = scrollArg() != null ? [scrollArg()] : want === ene ? [180, 0, 90, 270] : [0, 180, 90, 270];
      for (const scroll of scrolls) {
        const r = await call('belt', REC.lift, s.relais, 'Input1', { x: col.x, y: col.y, z: foot }, { endZ: foot, snapTolerance: 400, endScroll: scroll, dryRun: DRY });
        report(k + ' ascenseur ' + ((top.location.z - foot) / 100).toFixed(1) + ' m', r);
        if (r.hologram) console.log('   hologramme', r0(r.hologram.location), 'cap', Math.round(r.hologram.rotation.yaw));
        if (!r.built) return;
        const free = await freeEnd(r.actor);
        const dot = free.normal.x * want.x + free.normal.y * want.y;
        console.log('   pied', free.name, r0(free.location), 'rotation', scroll, ': sens voulu', dot.toFixed(2));
        // le pied reste dans l'axe relais-colonne (rotation 0 : vers le relais) : un relais en biais (quai 4) le laisse a
        // 40 deg du quai, ce qui suffit pour une ligne qui part vers le quai
        if (dot >= (L.sortie === 'quai' ? 0.7 : 0.9)) { s.ascenseur = r.actor; save(); break; }
        await call('dismantle', r.actor, true);
        // sans attendre, l'ascenseur suivant voit encore le precedent (refuse, ou accroche de l'autre cote du relais)
        await new Promise((ok) => setTimeout(ok, 1500));
      }
      if (!s.ascenseur) throw new Error(k + ' : aucun sens de pied convenable');
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
  // descente de la falaise du plateau : relais en l'air juste au-dela du bord (sortie a l'ouest, a 3 m au-dessus du haut
  // du plateau), ascenseur jusqu'au fond de la cuvette, pied tourne a l'ouest (vers la gare)
  async falaise(k, L) {
    if (!L.falaise) return;
    const s = (st[k] = st[k] || {});
    const y = L.falaise.y;
    if (!s.relaisFalaise) {
      // profil au pas de 1 m sur les 60 m a l'ouest de x0 ; bord = premier point, depuis le plateau, a 10 m sous le haut
      const N = 61, xa = L.falaise.x0 - 6000;
      const zs = (await call('relief', xa, y, N, 1, 100, 30000, -5000)).z;
      let i = N - 1;
      while (i > 0 && zs[i] > zs[N - 1] - 1000) i--;
      if (i < 8) throw new Error(k + ' : pas de bord de falaise sur le profil (' + zs.map((z) => Math.round(z / 100)).join(' ') + ')');
      const top = Math.max(...zs.slice(i + 1, i + 9));
      const x = xa + i * 100;
      console.log(k, 'bord en x', x, ': haut', (top / 100).toFixed(1), 'm, a 4 m', (zs[i - 4] / 100).toFixed(1), 'm, a 8 m', (zs[i - 8] / 100).toFixed(1), 'm');
      const r = await call('build', REC.merger, { x, y, z: top + 300 }, 180, Object.assign({ dryRun: DRY }, AIR));
      report(k + ' relais de falaise', r);
      if (!r.built) return;
      s.relaisFalaise = r.actor; save();
    }
    if (!s.chuteFalaise) {
      const o = (await call('connections', s.relaisFalaise)).find((c) => c.name === 'Output1');
      const col = { x: o.location.x - 300, y: o.location.y };
      let z = Math.max(await reliefAt(col.x, col.y), await reliefAt(col.x - 500, col.y)) + 100;
      // falaise.pile : pied a la hauteur de l'etage de la ligne dans une pile de convoyeurs (pile-convoyeurs.js), a sa
      // colonne d'entree : le convoyeur du pied a la pile reste a plat (au sol, il montait de 7 a 11 m en 10 m)
      if (L.falaise.pile) {
        const P = JSON.parse(fs.readFileSync(path.join(__dirname, L.falaise.pile.plan), 'utf8'));
        const l = P.lignes.find((x) => x.id === L.falaise.pile.ligne), c = P.colonnes[l.entree];
        z = (await reliefAt(c.x, c.y)) + 300 + 200 * ((c.socle || 0) + l.etage - 1);
      }
      if (o.location.z - z > 4700 || o.location.z - z < 400) throw new Error(k + ' : ascenseur de ' + ((o.location.z - z) / 100).toFixed(1) + ' m (4 a 47 m)');
      // ascenseur accroche a une sortie : rotation 0, pied dans le sens du haut (vers le relais) ; 180, a l'oppose ; 90 et
      // 270, de cote (essais du 24/10/2026)
      const want = { x: -1, y: 0 };
      for (const scroll of scrollArg() != null ? [scrollArg()] : [180, 0, 90, 270]) {
        const r = await call('belt', REC.lift, s.relaisFalaise, 'Output1', { x: col.x, y: col.y, z }, { endZ: z, snapTolerance: 400, endScroll: scroll, dryRun: DRY });
        report(k + ' ascenseur de falaise ' + ((o.location.z - z) / 100).toFixed(1) + ' m', r);
        if (!r.built) return;
        const free = await freeEnd(r.actor);
        const dot = free.normal.x * want.x + free.normal.y * want.y;
        console.log('   pied', free.name, r0(free.location), 'rotation', scroll, ': vers l\'ouest', dot.toFixed(2));
        if (dot >= 0.9) { s.chuteFalaise = r.actor; save(); break; }
        await call('dismantle', r.actor, true);
        // sans attendre, l'ascenseur suivant voit encore le precedent (refuse, ou accroche de l'autre cote du relais)
        await new Promise((ok) => setTimeout(ok, 1500));
      }
      if (!s.chuteFalaise) throw new Error(k + ' : aucun sens de pied convenable');
    }
  },
  async trace(k, L) {
    const s = st[k];
    let de, a;
    if (L.falaise) {
      if (!s || !s.chuteFalaise) throw new Error(k + ' : pas de descente de falaise (phase falaise)');
      de = L.foreuse + '.Output0'; a = short(s.relaisFalaise) + '.Input1';
    } else {
      if (!s || !s.ascenseur) throw new Error(k + ' : pas d\'ascenseur de gare (phase haut)');
      de = L.depart;
      if (L.descente) {
        if (!s.chute2) throw new Error(k + ' : pas de descente (phase descente)');
        de = short(s.chute2) + '.' + (await freeEnd(s.chute2)).name;
      }
      // depuis : ligne du plateau dont le pied de falaise alimente cette entree
      if (L.depuis) {
        const f = st[L.depuis];
        if (!f || !f.chuteFalaise) throw new Error(k + ' : pas de descente de falaise ' + L.depuis);
        de = short(f.chuteFalaise) + '.' + (await freeEnd(f.chuteFalaise)).name;
      }
      a = short(s.ascenseur) + '.' + (await freeEnd(s.ascenseur)).name;
    }
    console.log(k, 'de', de, 'a', a);
    // --marge <m> : zone de recherche autour des deux bouts (60 m par defaut dans tracer.js) ; la ligne de la 634 doit
    // aller chercher le passage ouest de la cuvette, hors de la zone par defaut
    // --releve <m> : pas du releve du relief (2 m pour le passage sous l'arche de la cuvette, couloir de 4 a 6 m)
    const pass = ['--marge', '--releve'].flatMap((o) => { const i = process.argv.indexOf(o); return i > 0 ? [o, process.argv[i + 1]] : []; });
    // sortie du traceur laissee passer (progression du releve visible dans le journal)
    const r = spawnSync(process.execPath, ['tracer.js', 'convoyeur', '--de', de, '--a', a, '--nom', 's13e101-' + k, '--frais'].concat(pass), { cwd: __dirname, stdio: 'inherit' });
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
