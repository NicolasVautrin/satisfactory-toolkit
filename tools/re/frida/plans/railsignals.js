// Controle de la signalisation d'un reseau, lu dans le jeu : decoupe en blocs (comme le jeu, d'un signal a l'autre),
// signaux d'entree / de sortie de chaque bloc, puis regles du wiki (https://satisfactory.wiki.gg/wiki/Train_Signals) :
//  - un bloc a au moins une entree et une sortie (sinon erreur "Block has no exit signal") ;
//  - les signaux d'ENTREE d'un bloc sont tous du meme type (bloc ou chemin) ;
//  - un bloc gere par des signaux de chemin ne contient pas de gare (erreur "Path block cannot contain stations") ;
//  - aux convergences, signaux de chemin en entree (bug : plusieurs signaux de bloc passent au vert -> collision) ;
//  - un bloc de chemin doit etre de niveau (sinon le decoupage en chemins echoue, collisions possibles) ;
//  - un signal de bloc juste avant un signal de chemin fait ralentir les trains (le chemin n'est reserve qu'apres) ;
//  - bloc au moins aussi long que le plus long train (--train <m>, 80 m par defaut : locomotive + 4 wagons).
// Usage : node railsignals.js --station <nom|chemin> [--train 80]
'use strict';

const { call, short } = require('./client');

const arg = (name, def) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : def;
};
const id = (p) => short(p).replace(/^Build_RailroadTrack(Integrated)?_C_/, (m, integ) => (integ ? 'int_' : 'r_'));
const sig = (p) => (/Path/.test(p) ? 'chemin ' : 'bloc ') + short(p).split('_').pop();
const isPath = (p) => /PathSignal/.test(p);
const fmt = (l) => '(' + Math.round(l.x) + ', ' + Math.round(l.y) + ', ' + Math.round(l.z) + ')';
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;

async function findStation(nameOrPath) {
  if (nameOrPath.indexOf('/') >= 0) return nameOrPath;
  const all = await call('scan', 'Build_TrainStation_C', null, 0, 500);
  for (const it of all.items) {
    const d = await call('dump', it.path, 1, 1, ['mStationName']);
    if (d.mStationName === nameOrPath) return it.path;
  }
  throw new Error('gare introuvable : ' + nameOrPath);
}

(async () => {
  const station = await findStation(arg('station', 'Breda'));
  const trainLength = Number(arg('train', '80'));
  const { mRailroadTrack: start } = await call('dump', station, 1, 1, ['mRailroadTrack']);

  // Reseau connexe de la gare (tous les rails relies, sans tenir compte du sens)
  const rails = new Map();
  const todo = [start];
  while (todo.length) {
    const t = todo.pop();
    if (rails.has(t)) continue;
    const info = await call('rails', t);
    rails.set(t, info);
    for (const c of info.connections) for (const x of c.connections) if (!rails.has(x.track)) todo.push(x.track);
  }

  // Blocs : union des rails relies par un joint SANS signal
  const parent = new Map([...rails.keys()].map((t) => [t, t]));
  const find = (t) => (parent.get(t) === t ? t : (parent.set(t, find(parent.get(t))), parent.get(t)));
  const signals = new Map(); // signal -> { from rail (le train le voit en sortant par ce connecteur), to rails, location }
  for (const [t, info] of rails) {
    for (const c of info.connections) {
      const hasSignal = c.facingSignal || c.trailingSignal;
      if (c.facingSignal) {
        const s = signals.get(c.facingSignal) || { from: new Set(), to: new Set(), location: c.location };
        s.from.add(t);
        for (const x of c.connections) {
          const other = rails.get(x.track).connections.find((o) => o.name === x.name);
          if (dot(other.normal, c.normal) < -0.5) s.to.add(x.track); // passage praticable seulement
        }
        signals.set(c.facingSignal, s);
      }
      // Sans signal, le joint relie tout. Avec un signal, il ne coupe qu'entre ses deux cotes : les branches d'un
      // aiguillage situees du meme cote (normales paralleles) restent dans le meme bloc (constate dans le jeu)
      // Un rail d'aiguillage ne liste pas forcement ses branches soeurs : on unit entre elles les branches atteintes
      // depuis un meme connecteur
      let firstAcross = null;
      for (const x of c.connections) {
        const other = rails.get(x.track).connections.find((o) => o.name === x.name);
        const across = dot(other.normal, c.normal) < -0.5;
        if (!hasSignal || !across) parent.set(find(t), find(x.track));
        else if (firstAcross === null) firstAcross = x.track;
        else parent.set(find(firstAcross), find(x.track));
      }
    }
  }
  const blocks = new Map();
  for (const [t, info] of rails) {
    const b = find(t);
    if (!blocks.has(b)) blocks.set(b, { rails: [], entries: new Set(), exits: new Set(), length: 0, zmin: Infinity, zmax: -Infinity, station: [], merges: [], splits: [] });
    const blk = blocks.get(b);
    blk.rails.push(t);
    blk.length += info.length || 0;
    for (const c of info.connections) {
      blk.zmin = Math.min(blk.zmin, c.location.z);
      blk.zmax = Math.max(blk.zmax, c.location.z);
      if (c.station) blk.station.push(c.station);
    }
    if (/Integrated/.test(t)) blk.station.push(t);
  }
  for (const [s, v] of signals) {
    for (const t of v.from) blocks.get(find(t)).exits.add(s);
    for (const t of v.to) blocks.get(find(t)).entries.add(s);
  }
  // Aiguillages a l'interieur des blocs : joints ou un connecteur a plusieurs passages praticables
  for (const [t, info] of rails) {
    for (const c of info.connections) {
      const passable = c.connections.filter((x) => dot(rails.get(x.track).connections.find((o) => o.name === x.name).normal, c.normal) < -0.5);
      if (passable.length > 1) blocks.get(find(t)).splits.push(fmt(c.location));
    }
  }
  // Une divergence vue dans un sens est une convergence dans l'autre : on compte les joints a 3 rails ou plus
  for (const blk of blocks.values()) blk.merges = [...new Set(blk.splits)];

  console.log('Reseau de ' + short(station) + ' : ' + rails.size + ' rails, ' + signals.size + ' signaux, ' + blocks.size + ' blocs\n');
  let n = 0;
  const problems = [];
  // Joint anormal : deux branches d'un aiguillage reliees entre elles (normales paralleles). Le jeu ne cree pas cette
  // liaison ; un signal pose sur un tel joint se reboucle sur lui-meme (constate en B le 18/10/2026)
  const anomalies = new Set();
  for (const [t, info] of rails) {
    for (const c of info.connections) {
      for (const x of c.connections) {
        const other = rails.get(x.track).connections.find((o) => o.name === x.name);
        if (dot(other.normal, c.normal) > 0.5) anomalies.add(fmt(c.location));
      }
    }
  }
  for (const a of anomalies) problems.push('joint ' + a + ' : branches soeurs reliees entre elles (anormal) -> un signal y sera en erreur');
  for (const blk of blocks.values()) {
    n++;
    const entries = [...blk.entries];
    const exits = [...blk.exits];
    const names = blk.rails.map(id);
    console.log('Bloc ' + n + ' : ' + Math.round(blk.length / 100) + ' m, ' + blk.rails.length + ' rails, altitude ' + Math.round(blk.zmin / 100) + '..' + Math.round(blk.zmax / 100) + ' m'
      + (blk.station.length ? ', GARE/QUAIS' : '') + (blk.merges.length ? ', aiguillages en ' + blk.merges.join(' ') : ''));
    console.log('   rails : ' + names.join(' '));
    console.log('   entrees : ' + (entries.map(sig).join(', ') || 'aucune') + ' | sorties : ' + (exits.map(sig).join(', ') || 'aucune'));
    const say = (m) => { problems.push('Bloc ' + n + ' : ' + m); console.log('   !! ' + m); };
    if (entries.length && !exits.length) say('aucun signal de sortie (erreur du jeu "Block has no exit signal", sauf voie en attente de raccordement)');
    if (new Set(entries.map(isPath)).size > 1) say('signaux d\'entree de types differents (erreur du jeu)');
    const pathBlock = entries.some(isPath);
    if (pathBlock && blk.station.length) say('bloc de chemin contenant une gare (erreur du jeu)');
    if (pathBlock && blk.zmax - blk.zmin > 100) say('bloc de chemin pas de niveau (' + Math.round((blk.zmax - blk.zmin) / 100) + ' m de denivele) : le jeu decoupe mal les chemins');
    if (blk.merges.length && entries.length > 1 && !pathBlock) say('aiguillage(s) avec ' + entries.length + ' entrees en signaux de bloc : risque de collision (bug), signaux de chemin recommandes');
    if (entries.length && !blk.station.length && blk.length < trainLength * 100 && !blk.merges.length) say('plus court (' + Math.round(blk.length / 100) + ' m) que le train (' + trainLength + ' m)');
  }
  for (const [s, v] of signals) {
    if (isPath(s)) continue;
    for (const t of v.to) {
      const next = blocks.get(find(t));
      if ([...next.exits].some(isPath) && next.length < 25000) problems.push('signal de ' + sig(s) + ' suivi de pres par un signal de chemin : les trains ralentiront');
    }
  }
  // Controle croise avec les blocs du jeu (GetSignalBlock) : le jeu fusionne aussi des rails qui se touchent sans etre
  // raccordes ; tout ecart avec le decoupage ci-dessus est signale
  const gameIds = new Map(); // bloc calcule -> identifiants de blocs du jeu
  const owner = new Map(); // identifiant du jeu -> blocs calcules
  let k = 0;
  for (const blk of blocks.values()) {
    k++;
    const ids = new Set();
    for (const t of blk.rails) for (const c of rails.get(t).connections) if (c.block) ids.add(c.block);
    gameIds.set(k, ids);
    for (const g of ids) owner.set(g, (owner.get(g) || new Set()).add(k));
  }
  let mismatch = 0;
  for (const [b, ids] of gameIds) {
    if (ids.size > 1) { mismatch++; problems.push('Bloc ' + b + ' : le jeu le decoupe en ' + ids.size + ' blocs'); }
    // Voie sans signal d'entree (bout en attente de raccordement) : le jeu ne la range dans aucun bloc, c'est attendu
    if (ids.size === 0 && [...blocks.values()][b - 1].entries.size) { mismatch++; problems.push('Bloc ' + b + ' : hors de tout bloc du jeu'); }
  }
  for (const [g, set] of owner) {
    if (set.size > 1) { mismatch++; problems.push('Blocs ' + [...set].join(' + ') + ' : le jeu n\'en fait qu\'UN (rails qui se touchent ?)'); }
  }
  console.log('\nBlocs du jeu : ' + owner.size + ' (' + (mismatch ? mismatch + ' ecart(s) avec le decoupage calcule' : 'identiques au decoupage calcule') + ')');
  console.log('\nSignaux :');
  for (const [s, v] of signals) console.log('   ' + sig(s).padEnd(16) + ' en ' + fmt(v.location) + ' : de ' + [...v.from].map(id).join(',') + ' vers ' + ([...v.to].map(id).join(',') || 'rien (bout de voie)'));
  console.log('\n' + (problems.length ? problems.length + ' remarque(s) :\n  ' + problems.join('\n  ') : 'Aucune remarque'));
})().catch((e) => {
  console.error('ECHEC :', e.message);
  process.exitCode = 1;
});
