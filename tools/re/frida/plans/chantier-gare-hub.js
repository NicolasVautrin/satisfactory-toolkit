// Chantier d'une gare du hub avancee de 6 m avec ses tampons (regle de l'utilisateur, 26/10/2026 : « pas de signaux a
// l'entree et a la sortie des gares, segment minimum de 12m » ; « on les avance de 6m 18 + 12 ca doit fonctionner »).
// Modele : chantier de N266 E126 (references/rails.md, « Signal d'entree de gare »). Pour chaque etage : rails d'entree
// et de sortie et leurs signaux retires (layouts/hub.js), gare et quais demontes puis reposes a la sortie donnee par
// --ent <cle>=12 (layouts/hub-gare.js, visee des quais a 20 m sous l'etage du dessus), rails et signaux reposes (entree
// 18 + 12 m, signal a la jonction), nom / etiquettes / modes des quais remis. Tampons : deplacer-tampons.js (releve fait
// avant, etat plans/<deplacement>-deplacement-state.json ; sans tampon : --deplacement absent).
// Joueur teleporte en --site (accord de l'utilisateur pour la tournee), ramene a son point de depart a la fin.
//
// node chantier-gare-hub.js --gare est<k>|ouest<k> --etages 0[,1,2] --site x,y,z [--deplacement <nom>] [--depuis <etape>]
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { call } = require('./client');

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf('--' + name); return i < 0 ? def : argv[i + 1]; };
const GARE = opt('gare'), FLOORS = String(opt('etages', '')).split(',').filter((x) => x !== '').map(Number);
const MOVE = opt('deplacement'), SITE = (() => { const s = String(opt('site', '')).split(',').map(Number); return s.length === 3 ? { x: s[0], y: s[1], z: s[2] } : null; })();
if (!/^(est|ouest)\d+$/.test(GARE || '') || !FLOORS.length || !SITE) throw new Error('usage : --gare est<k>|ouest<k> --etages 0[,1,2] --site x,y,z [--deplacement <nom>]');
const k = GARE.replace(/\D/g, ''), W = GARE.startsWith('ouest');
const ENT = (W ? 'W' : 'E') + k + '=12';
const IDS = W ? { inLine: 'Win' + k, inGare: 'Wing' + k, out: 'Wo' + k, sigIn: 'xWi' + k, sigOut: 'eWo' + k }
  : { inLine: 'Ein' + k, inGare: 'Eing' + k, out: 'Eo' + k, sigIn: 'xEi' + k, sigOut: 'eEo' + k };
const KEEP = path.join(__dirname, 'chantier-' + GARE + '-' + FLOORS.join('') + '-avant.json');
const HUB = ['--origin', '141339,-261512,349', '--axis', '180'];
const STEPS = ['controle', 'sauvegarde', 'demonte-tampons', 'voies-et-gares', 'noms', 'repose-tampons', 'verifie'];
const from = opt('depuis') ? STEPS.indexOf(opt('depuis')) : 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...m) => console.log(new Date().toTimeString().slice(0, 8), ...m);
const st = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, f + '-state.json'), 'utf8'));
const has = (f) => fs.existsSync(path.join(__dirname, f + '-state.json'));
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
const newOrigin = (f) => require('./layouts/hub.js').layout({ etage: f, ent: ENT }).stations[GARE].origin;
const axis = W ? '0' : '180';

(async () => {
  const home = (await call('player')).eyes.location;
  log('depart du joueur', JSON.stringify(home));
  await call('teleport', SITE, null);
  try {
    await sleep(8000);
    for (const step of STEPS.slice(from)) {
      log('=== ' + step);
      if (step === 'controle') {
        const keep = {};
        for (const f of FLOORS) {
          const h = st('hub' + f), g = st('hub' + f + '-' + GARE);
          for (const [kind, id] of [['rails', IDS.inLine], ['rails', IDS.out], ['signals', IDS.sigIn], ['signals', IDS.sigOut]]) {
            await call('dump', h[kind][id], 1, 1, ['bHidden']).catch(() => { throw new Error('hub' + f + ' ' + id + ' absent en jeu : ' + h[kind][id]); });
          }
          const s = (await call('stations', {})).find((x) => x.station === g.station);
          const modes = []; for (const p of g.platforms) modes.push((await call('platformLoadMode', p)).load);
          // horaires des trains qui desservent la gare (le jeu retire une gare demontee de leurs horaires) : remis a l'etape noms
          const trains = (await call('trains', {})).filter((t) => t.timetable && t.timetable.stops.some((x) => x.station && x.station.name === s.name))
            .map((t) => ({ path: t.path, name: t.name, selfDriving: t.selfDriving, current: t.timetable.current,
              stops: t.timetable.stops.map((x) => ({ name: x.station.name, definition: x.definition.replace('TDD_', ''), duration: x.duration, durationAndRule: x.durationAndRule })) }));
          keep[f] = { name: s.name, tags: (await call('tags', g.station)).tags || [], modes, trains };
          const near = await call('trains', { near: s.location, radius: 9000 });
          if (near.length) throw new Error('train pres de ' + s.name + ' : ' + near.map((t) => t.name).join(', '));
        }
        fs.writeFileSync(KEEP, JSON.stringify(keep, null, 1));
        console.log(JSON.stringify(keep));
      }
      if (step === 'sauvegarde') node('fg.js', 'save', 'avant-chantier-' + (MOVE || GARE));
      if (step === 'demonte-tampons' && MOVE) node('deplacer-tampons.js', 'demonte', MOVE);
      if (step === 'voies-et-gares') {
        for (const f of FLOORS) {
          const h = st('hub' + f), o = newOrigin(f), g = 'hub' + f + '-' + GARE;
          const left = [IDS.sigIn, IDS.sigOut, IDS.inLine, IDS.out, IDS.inGare].filter((id) => h.signals[id] || h.rails[id]);
          // reprise : rails deja reposes a la nouvelle place (Eing present) : rien a retirer
          if (left.length && !h.rails[IDS.inGare]) node('railplan.js', 'layouts/hub.js', 'remove', ...left, '--nom', 'hub' + f, '--etage', String(f));
          if (has(g) && Math.hypot(st(g).frame.origin.x - o.x, st(g).frame.origin.y - o.y) > 50) node('railplan.js', 'layouts/hub-gare.js', 'teardown', '--nom', g);
          if (!has(g) || st(g).platforms.length < 4) node('railplan.js', 'layouts/hub-gare.js', 'build', '--origin', [o.x, o.y, o.z].join(','), '--axis', axis, '--nom', g, '--visee', '20');
          node('railplan.js', 'layouts/hub.js', 'build', ...HUB, '--nom', 'hub' + f, '--etage', String(f), '--ent', ENT,
            '--rails', [IDS.inLine, IDS.inGare, IDS.out].join('|'), '--signaux', [IDS.sigIn, IDS.sigOut].join('|'));
        }
      }
      if (step === 'noms') {
        const keep = JSON.parse(fs.readFileSync(KEEP, 'utf8'));
        for (const f of FLOORS) {
          const g = st('hub' + f + '-' + GARE), kp = keep[f];
          await call('renameStation', g.station, kp.name);
          if (kp.tags.length) await call('tags', g.station, kp.tags);
          for (const [i, p] of g.platforms.entries()) await call('platformLoadMode', p, kp.modes[i]);
          console.log('hub' + f + '-' + GARE, kp.name, '| etiquettes', kp.tags.length, '| modes', JSON.stringify(kp.modes));
          const stations = await call('stations', {});
          for (const t of kp.trains || []) {
            const stops = t.stops.map((x) => { const s = stations.find((y) => y.name === x.name); if (!s) throw new Error('gare ' + x.name + ' introuvable pour ' + t.name); return { station: s.station, definition: x.definition, duration: x.duration, durationAndRule: x.durationAndRule }; });
            await call('trainTimetable', t.path, stops, { current: t.current, selfDriving: t.selfDriving });
            console.log('horaire remis :', t.name, '|', t.stops.map((x) => x.name).join(' | '));
          }
        }
      }
      if (step === 'repose-tampons' && MOVE) node('deplacer-tampons.js', 'repose', MOVE);
      if (step === 'verifie') {
        if (MOVE) node('deplacer-tampons.js', 'verifie', MOVE);
        for (const f of FLOORS) {
          const h = st('hub' + f), g = st('hub' + f + '-' + GARE);
          const sig = async (id) => JSON.stringify(await call('dump', h.signals[id], 1, 1, ['mBlockValidation', 'mAspect']));
          const blk = async (p) => (await call('rails', p)).connections[0].block;
          const ov = ((await call('dump', h.rails[IDS.inGare], 1, 1, ['mOverlappingTracks'])).mOverlappingTracks || []).length;
          console.log('hub' + f, IDS.sigIn, await sig(IDS.sigIn), IDS.sigOut, await sig(IDS.sigOut), '| rail de 12 m : contacts', ov,
            '| blocs anneau/entree', (await blk(h.rails[IDS.inLine])) !== (await blk(h.rails[IDS.inGare])) ? 'separes' : 'CONFONDUS',
            '| entree/gare', (await blk(h.rails[IDS.inGare])) === (await blk(g.integrated[4])) ? 'meme bloc' : 'DIFFERENTS');
        }
        node('entrees-gares.js', 'liste');
      }
    }
  } finally {
    await call('teleport', home, null);
    log('joueur ramene a son point de depart');
  }
})().catch((e) => { console.log('ERREUR', e.message); process.exitCode = 1; });
