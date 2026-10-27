// Chantier d'une gare « nord » des anneaux de la voie du nord (vbd), avancee de 6 m avec ses tampons (regle de
// l'utilisateur, 26/10/2026 : « pas de signaux a l'entree et a la sortie des gares, segment minimum de 12m » ; « on les
// avance de 6m 18 + 12 ca doit fonctionner »). Meme deroulement que chantier-gare-hub.js, avec les plans de ces gares :
// gare et quais layouts/hub-gare.js, sortie layouts/anneau-gare-nord.js (anneau a l'est de la gare), entree
// layouts/anneau-entree-nord.js (anneau a l'ouest). Une entree posee avec son anneau (rails Ein / xEi de l'etat de
// l'anneau, layouts/anneau-voie-basse.js) est demontee directement et retiree de cet etat, puis reposee par
// anneau-entree-nord.js dans un etat a elle (<anneau>-entree).
// Joueur teleporte au chantier (accord de l'utilisateur : « deplace moi dessus »), laisse sur place a la fin (--rester)
// ou ramene a son point de depart.
//
// node chantier-gare-anneau.js <gare> [--depuis <etape>] [--rester]        <gare> : cle de GARES ci-dessous
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { call } = require('./client');

// Gares : etat de la gare ; anneau a l'est et anneau a l'ouest [etat, x du centre, y de la voie sud] ; gare « nord »
// (sortie a l'est par anneau-gare-nord.js, etat `sortie` ; entree a l'ouest par anneau-entree-nord.js, etat `entree`,
// absent : entree posee avec l'anneau ouest) ou « sud » (layouts/anneau-gare-sud.js, sortie a l'ouest et entree a l'est
// dans le meme etat `sortie`) ; site du joueur ; deplacement des tampons. Types des quais lus en jeu.
const VBD = -261512, VB = -207220; // voie du nord (vbd), voie basse (vb)
const GARES = {
  o40: { gare: 'anneau-vbd-est5', est: ['anneau-vbd5', -30649, VBD], sortie: 'anneau-vbd5-gare-nord',
    ouest: ['anneau-vbd6', -54104, VBD], entree: null, site: { x: -43300, y: -270500, z: 1349 }, tampons: 'o40' },
  e53: { gare: 'anneau-vbd-est1', est: ['anneau-vbd1', 63171, VBD], sortie: 'anneau-vbd1-gare-nord',
    ouest: ['anneau-vbd2', 39716, VBD], entree: 'anneau-vbd2-entree', site: { x: 50550, y: -270500, z: 1349 }, tampons: 'e53' },
  o96: { gare: 'anneau-vb-est1', est: ['anneau-vb', -86144, VB], sortie: 'anneau-vb-gare-nord',
    ouest: ['anneau-vb2', -109599, VB], entree: null, site: { x: -98770, y: -215500, z: 1349 }, tampons: 'o96' },
  o119: { gare: 'anneau-vb-est2', est: ['anneau-vb2', -109599, VB], sortie: 'anneau-vb2-gare-nord',
    ouest: ['anneau-vb3', -133054, VB], entree: null, site: { x: -122226, y: -215500, z: 1349 }, tampons: 'o119' },
  o143: { gare: 'anneau-vb-est3', est: ['anneau-vb3', -133054, VB], sortie: 'anneau-vb3-gare-nord',
    ouest: ['anneau-vb4', -156509, VB], entree: null, site: { x: -145681, y: -215500, z: 1349 }, tampons: 'o143' },
  n204: { sud: true, gare: 'anneau-vb-sud1', est: ['anneau-vb', -86144, VB], sortie: 'anneau-vb2-gare-sud',
    ouest: ['anneau-vb2', -109599, VB], site: { x: -96971, y: -199500, z: 1349 }, tampons: 'n204' },
};
const RING = (r) => String(r[1]) + ',' + r[2] + ',349';
const argv = process.argv.slice(2);
const KEY = argv[0], G = GARES[KEY];
if (!G) throw new Error('gare inconnue : ' + KEY + ' (' + Object.keys(GARES).join(', ') + ')');
const opt = (name) => { const i = argv.indexOf('--' + name); return i < 0 ? null : argv[i + 1]; };
const STAY = argv.includes('--rester');
const STEPS = ['controle', 'sauvegarde', 'demonte-tampons', 'voies-et-gare', 'noms', 'repose-tampons', 'verifie'];
const from = opt('depuis') ? STEPS.indexOf(opt('depuis')) : 0;
const ENTREE = G.sud ? G.sortie : G.entree || G.ouest[0] + '-entree';
const DX = G.sud ? -600 : 600; // gare avancee de 6 m vers sa sortie (est pour une gare nord, ouest pour une gare sud)
const AXIS = G.sud ? '0' : '180';
const TYPE = (p) => (/Liquid/.test(p) ? 'fluide' : /Empty/.test(p) ? 'vide' : 'fret');
const KEEP = path.join(__dirname, 'chantier-' + KEY + '-avant.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...m) => console.log(new Date().toTimeString().slice(0, 8), ...m);
const file = (f) => path.join(__dirname, f + '-state.json');
const st = (f) => JSON.parse(fs.readFileSync(file(f), 'utf8'));
const has = (f) => fs.existsSync(file(f));
const node = (...a) => {
  try {
    const out = execFileSync('node', a, { cwd: __dirname, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    console.log(out.trim());
    return out;
  } catch (e) {
    console.log(((e.stdout || '') + (e.stderr || '')).trim());
    throw new Error('echec de : node ' + a.join(' '));
  }
};
// gare nord : sortie (anneau est) ; gare sud : sortie et entree dans le meme plan (repere de l'anneau ouest)
const SORTIE = [G.sud ? 'layouts/anneau-gare-sud.js' : 'layouts/anneau-gare-nord.js'];
const SORTIE_OPTS = () => (G.sud
  ? ['--origin', RING(G.ouest), '--axis', '180', '--anneau', G.ouest[0], '--est', G.est[0], '--gare', G.gare, '--nom', G.sortie, '--ent', '12']
  : ['--origin', RING(G.est), '--axis', '180', '--anneau', G.est[0], '--gare', G.gare, '--nom', G.sortie, '--ent', '12']);
const ENTREE_OPTS = () => ['--origin', RING(G.ouest), '--axis', '180', '--anneau', G.ouest[0], '--gare', G.gare, '--nom', ENTREE, '--ent', '12'];

(async () => {
  const home = (await call('player')).eyes.location;
  log('depart du joueur', JSON.stringify(home));
  await call('teleport', G.site, null);
  let ok = false;
  try {
    await sleep(8000);
    for (const step of STEPS.slice(from)) {
      log('=== ' + step);
      if (step === 'controle') {
        const g = st(G.gare);
        const s = (await call('stations', {})).find((x) => x.station === g.station);
        const modes = []; for (const p of g.platforms) modes.push(/Empty/.test(p) ? null : (await call('platformLoadMode', p)).load);
        // horaires des trains qui desservent la gare : le jeu retire d'un horaire une gare demontee (train du carburant,
        // 26/10/2026 : arret N266 E53 perdu, train reste a quai a sa seule gare) ; remis a l'identique a l'etape noms
        const trains = (await call('trains', {})).filter((t) => t.timetable && t.timetable.stops.some((x) => x.station && x.station.name === s.name))
          .map((t) => ({ path: t.path, name: t.name, selfDriving: t.selfDriving, current: t.timetable.current,
            stops: t.timetable.stops.map((x) => ({ name: x.station.name, definition: x.definition.replace('TDD_', ''), duration: x.duration, durationAndRule: x.durationAndRule })) }));
        const keep = { name: s.name, tags: (await call('tags', g.station)).tags || [], modes, origin: g.frame.origin, types: g.platforms.map(TYPE).join(','), trains };
        const near = await call('trains', { near: s.location, radius: 9000 });
        if (near.length) throw new Error('train pres de ' + s.name + ' : ' + near.map((t) => t.name).join(', '));
        const sor = st(G.sortie), ent = G.sud || G.entree ? st(ENTREE) : st(G.ouest[0]);
        for (const p of [sor.rails.Eo, sor.signals.eEo, ent.rails.Ein, ent.signals.xEi]) await call('dump', p, 1, 1, ['bHidden']).catch(() => { throw new Error('absent en jeu : ' + p); });
        if (!fs.existsSync(KEEP)) fs.writeFileSync(KEEP, JSON.stringify(keep, null, 1)); // reprise : garder l'etat d'avant
        console.log(JSON.stringify(keep));
      }
      if (step === 'sauvegarde') node('fg.js', 'save', 'avant-chantier-' + KEY);
      if (step === 'demonte-tampons') node('deplacer-tampons.js', 'demonte', G.tampons);
      if (step === 'voies-et-gare') {
        const keep = JSON.parse(fs.readFileSync(KEEP, 'utf8'));
        const o = { x: keep.origin.x + DX, y: keep.origin.y, z: keep.origin.z };
        const moved = () => has(G.gare) && Math.hypot(st(G.gare).frame.origin.x - o.x, st(G.gare).frame.origin.y - o.y) < 50;
        // sortie (Eo, eEo) ; gare sud : entree (Ein, xEi) dans le meme etat
        const sor = st(G.sortie);
        const outLeft = (G.sud ? ['eEo', 'xEi', 'Eo', 'Ein'] : ['eEo', 'Eo']).filter((id) => sor.signals[id] || sor.rails[id]);
        if (outLeft.length && !moved() && !sor.rails.Eing) node('railplan.js', ...SORTIE, 'remove', ...outLeft, ...SORTIE_OPTS());
        // entree : etat a elle, ou rails de l'anneau ouest
        if (G.sud) {
          // deja retiree avec la sortie
        } else if (G.entree) {
          const ent = st(G.entree);
          const inLeft = ['xEi', 'Ein'].filter((id) => (ent.signals[id] || ent.rails[id]) && !ent.rails.Eing);
          if (inLeft.length) node('railplan.js', 'layouts/anneau-entree-nord.js', 'remove', ...inLeft, ...ENTREE_OPTS());
        } else {
          const ring = st(G.ouest[0]);
          for (const [kind, id] of [['signals', 'xEi'], ['rails', 'Ein']]) {
            if (!ring[kind][id]) continue;
            await call('dismantle', ring[kind][id], true);
            console.log('demonte ' + id + ' de ' + G.ouest[0] + ' (' + ring[kind][id].split('.').pop() + ')');
            ring.built = (ring.built || []).filter((x) => x !== ring[kind][id]);
            delete ring[kind][id];
            fs.writeFileSync(file(G.ouest[0]), JSON.stringify(ring, null, 1));
          }
        }
        // gare et quais
        if (has(G.gare) && !moved()) node('railplan.js', 'layouts/hub-gare.js', 'teardown', '--nom', G.gare);
        if (!has(G.gare) || st(G.gare).platforms.length < 4) {
          node('railplan.js', 'layouts/hub-gare.js', 'build', '--origin', [o.x, o.y, o.z].join(','), '--axis', AXIS, '--nom', G.gare, '--types', keep.types);
        }
        node('railplan.js', ...SORTIE, 'build', ...SORTIE_OPTS());
        if (!G.sud) node('railplan.js', 'layouts/anneau-entree-nord.js', 'build', ...ENTREE_OPTS());
      }
      if (step === 'noms') {
        const keep = JSON.parse(fs.readFileSync(KEEP, 'utf8')), g = st(G.gare);
        await call('renameStation', g.station, keep.name);
        if (keep.tags.length) await call('tags', g.station, keep.tags);
        for (const [i, p] of g.platforms.entries()) if (keep.modes[i] != null) await call('platformLoadMode', p, keep.modes[i]);
        console.log(keep.name, '| etiquettes', keep.tags.length, '| modes', JSON.stringify(keep.modes));
        const stations = await call('stations', {});
        for (const t of keep.trains || []) {
          const stops = t.stops.map((x) => { const s = stations.find((y) => y.name === x.name); if (!s) throw new Error('gare ' + x.name + ' introuvable pour ' + t.name); return { station: s.station, definition: x.definition, duration: x.duration, durationAndRule: x.durationAndRule }; });
          await call('trainTimetable', t.path, stops, { current: t.current, selfDriving: t.selfDriving });
          console.log('horaire remis :', t.name, '|', t.stops.map((x) => x.name).join(' | '), '| arret suivant', t.current, t.selfDriving ? 'auto' : 'manuel');
        }
      }
      if (step === 'repose-tampons') node('deplacer-tampons.js', 'repose', G.tampons);
      if (step === 'verifie') {
        node('deplacer-tampons.js', 'verifie', G.tampons);
        const sor = st(G.sortie), ent = st(ENTREE), g = st(G.gare);
        const sig = async (p) => JSON.stringify(await call('dump', p, 1, 1, ['mBlockValidation', 'mAspect']));
        const blk = async (p) => (await call('rails', p)).connections[0].block;
        const ov = ((await call('dump', ent.rails.Eing, 1, 1, ['mOverlappingTracks'])).mOverlappingTracks || []).length;
        console.log('xEi', await sig(ent.signals.xEi), 'eEo', await sig(sor.signals.eEo), '| rail de 12 m : contacts', ov,
          '| blocs anneau/entree', (await blk(ent.rails.Ein)) !== (await blk(ent.rails.Eing)) ? 'separes' : 'CONFONDUS',
          '| entree/gare', (await blk(ent.rails.Eing)) === (await blk(g.integrated[4])) ? 'meme bloc' : 'DIFFERENTS',
          '| sortie/gare', (await blk(sor.rails.Eo)) === (await blk(g.integrated[0])) ? 'meme bloc' : 'DIFFERENTS');
        node('entrees-gares.js', 'liste');
      }
    }
    ok = true;
  } finally {
    if (!(STAY && ok)) { await call('teleport', home, null); log('joueur ramene a son point de depart'); } else log('joueur laisse sur le chantier');
  }
})().catch((e) => { console.log('ERREUR', e.message); process.exitCode = 1; });
