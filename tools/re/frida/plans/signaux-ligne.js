// Signaux de bloc intermediaires sur une grande ligne (utilisateur, 24/10/2026 : « il faut positionner des signal bloc sur
// les long trajet sinon les train attendront trop sur les anneaux », puis « pose des signaux tous les 2 rails, min 200 m »).
// Part d'un signal existant (sortie d'anneau, de gare), suit la voie dans le sens de marche (connecteur observe du signal)
// jusqu'au prochain signal, aiguillage ou bout libre, puis pose un signal de bloc a gauche (circulation a gauche : bord
// exterieur de la double voie) a la sortie d'un rail des que le bloc compte --rails rails (2) et --min m (200) ; le dernier
// bloc, jusqu'au signal d'arrivee, fait aussi --min m au moins.
// Chaque signal pose est controle : le jeu doit ranger les rails de part et d'autre dans deux blocs differents. Un signal
// pose sur un joint fait par railLink ne coupe pas les blocs (24/10/2026, anneau de Lund) : il est alors retire et le rail
// suivant essaye.
//
// node signaux-ligne.js plan|pose --signal <signal de depart> [--rails 2] [--min 200] [--nom <etat>]
// node signaux-ligne.js retirer --signal <signal de depart> [--nom <etat>]   retire les signaux poses sur cette ligne
//   etat : plans/<nom>-state.json (signaux poses, par ligne) ; defaut signaux-lignes
'use strict';
const fs = require('fs');
const path = require('path');
const { call } = require('./client');

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf('--' + name); return i < 0 ? def : argv[i + 1]; };
const LV = '/Game/FactoryGame/Map/GameLevel01/Persistent_Level.Persistent_Level:PersistentLevel.';
const full = (p) => (p.includes('/') ? p : LV + p);
const short = (p) => String(p).split('.').pop();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Voie depuis le connecteur observe du signal : rails dans le sens de marche, joints (connecteur de sortie de chaque rail)
async function follow(signal) {
  const s = await call('dump', signal, 1, 1, ['mObservedConnections']);
  const start = (s.mObservedConnections || [])[0];
  if (!start) throw new Error('signal sans connecteur observe : ' + short(signal));
  let track = String(start).split('.').slice(0, -1).join('.'), inName = short(start);
  const rails = [];
  let total = 0, stop = '';
  for (let guard = 0; guard < 400; guard++) {
    const info = await call('rails', track);
    const out = info.connections.find((c) => c.name !== inName);
    total += info.length;
    rails.push({ track, out: out.name, at: out.location, dist: total, links: out.connections.length, signal: !!(out.facingSignal || out.trailingSignal), station: !!out.station });
    if (out.facingSignal || out.trailingSignal) { stop = 'signal'; break; }
    if (out.station) { stop = 'gare'; break; }
    if (out.connections.length !== 1) { stop = out.connections.length ? 'aiguillage' : 'bout libre'; break; }
    const next = out.connections[0];
    // l'entree du rail suivant ne doit pas etre un aiguillage (convergence) : le signal se pose avant
    const nInfo = await call('rails', next.track);
    const nIn = nInfo.connections.find((c) => c.name === next.name);
    if (nIn.connections.length !== 1) { stop = 'convergence'; break; }
    track = next.track; inName = next.name;
  }
  return { rails, total, stop };
}

// Joint candidat : sortie d'un rail qui n'est ni un aiguillage ni deja un signal, et qui n'est pas le dernier rail. Un
// signal y coupe le bloc si celui-ci compte deja N rails et MIN m, et s'il reste MIN m jusqu'au signal d'arrivee ; `last` =
// distance du dernier signal (pose ou de depart)
const fits = (line, r, count, last, N, MIN) => r !== line.rails[line.rails.length - 1] && r.links === 1 && !r.signal
  && count >= N && r.dist - last >= MIN && line.total - r.dist >= MIN;

function choose(line, N, MIN) {
  const picks = [];
  let last = 0, count = 0;
  for (const r of line.rails) {
    count++;
    if (fits(line, r, count, last, N, MIN)) { picks.push(r); last = r.dist; count = 0; }
  }
  return picks;
}

async function blockOf(track) { return (await call('dump', track, 1, 1, ['mSignalBlockID'])).mSignalBlockID; }

(async () => {
  const mode = argv[0];
  if (!['plan', 'pose', 'retirer'].includes(mode) || !opt('signal')) throw new Error('usage : node signaux-ligne.js plan|pose|retirer --signal <signal de depart> [--rails 2] [--min 200] [--nom <etat>]');
  const N = Number(opt('rails', 2)), MIN = 100 * Number(opt('min', 200));
  const signal = full(opt('signal'));
  const file = path.join(__dirname, opt('nom', 'signaux-lignes') + '-state.json');
  const st = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const key = short(signal);
  if (mode === 'retirer') {
    for (const s of st[key] || []) { await call('dismantle', s.signal, true); console.log('retire', short(s.signal), 'en', s.distance_m, 'm'); }
    delete st[key];
    fs.writeFileSync(file, JSON.stringify(st, null, 1));
    return;
  }
  const line = await follow(signal);
  console.log('ligne depuis', short(signal), ':', Math.round(line.total / 100), 'm,', line.rails.length, 'rails, arret :', line.stop);
  if (line.stop !== 'signal') console.log('ATTENTION : la ligne ne finit pas sur un signal (' + line.stop + ')');
  const picks = choose(line, N, MIN);
  const cuts = [0, ...picks.map((p) => p.dist), line.total];
  console.log('blocs prevus :', cuts.slice(1).map((d, i) => Math.round((d - cuts[i]) / 100)).join(' / '), 'm');
  if (mode === 'plan') return;
  st[key] = st[key] || [];
  // pose de proche en proche : si un joint ne coupe pas le bloc (railLink), le signal est retire et le rail suivant essaye
  let last = 0, count = 0;
  const placed = [];
  for (const r of line.rails) {
    count++;
    if (!fits(line, r, count, last, N, MIN)) continue;
    const res = await call('signal', 'Recipe_RailroadBlockSignal_C', { path: r.track, name: r.out }, { leftHanded: true });
    if (!res.built) { console.log('   refuse en', Math.round(r.dist / 100), 'm :', res.blocking.join(',')); continue; }
    await sleep(1500);
    const next = line.rails[line.rails.indexOf(r) + 1];
    const [b1, b2] = [await blockOf(r.track), await blockOf(next.track)];
    if (b1 === b2) {
      console.log('   signal en', Math.round(r.dist / 100), 'm ne coupe pas le bloc (joint fait par railLink ?) : retire, rail suivant');
      await call('dismantle', res.actor, true);
      await sleep(1000);
      continue;
    }
    st[key].push({ signal: res.actor, rail: r.track, connecteur: r.out, distance_m: Math.round(r.dist / 100) });
    fs.writeFileSync(file, JSON.stringify(st, null, 1));
    placed.push(res.actor);
    last = r.dist; count = 0;
  }
  const done = [0, ...st[key].map((s) => 100 * s.distance_m), line.total];
  console.log('pose :', placed.length, 'signaux ; blocs', done.slice(1).map((d, i) => Math.round((d - done[i]) / 100)).join(' / '), 'm');
  await sleep(1500);
  const bad = [];
  for (const p of placed) { const v = (await call('dump', p, 1, 1, ['mBlockValidation'])).mBlockValidation; if (v !== 1) bad.push(short(p) + '=' + v); }
  console.log(bad.length ? 'VALIDATION en defaut : ' + bad.join(' ') : 'validation du jeu : 1 pour tous');
})().catch((e) => { console.error('ECHEC :', e.message); process.exitCode = 1; });
