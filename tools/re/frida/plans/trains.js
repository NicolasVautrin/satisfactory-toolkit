// Trafic ferroviaire (utilisateur, 26/10/2026 : « il va falloir que tu te dotes des outils capables de controler tout le
// trafic ferroviaire » ; « on pose un train et on affinera ») : trains et tournees, par les commandes de l'agent
// (trains, stations, trainTimetable, trainSelfDriving, trainName, buildAim).
//
// node trains.js liste [--gare <motif>]          trains : composition, horaire, conduite, etat, erreur, ou il est
// node trains.js tournee <gare de chargement> [--wagons n] [--attente s] [--regle LoadUnloadOnce|FullyLoadUnload]
//   [--dry]                                       un train de plus sur la tournee de cette gare : locomotive sur la voie
//                                                 de la gare, wagons sur les voies des quais (autant que de quais
//                                                 etiquetes non vides, q1.. ; --wagons pour forcer), horaire chargement
//                                                 -> gare couplee (« A -> B » -> « B <- A »), nom « A -> B » (#n a partir
//                                                 du 2e), conduite automatique. La gare doit etre libre (aucun train).
// node trains.js poser <gare> [--wagons n] [--nom <nom>] [--dry]   pose un train a une gare, sans horaire (essais)
// node trains.js horaire <train> <gare>... [--attente s] [--regle ...] [--auto]   (arret suivant conserve)
// node trains.js regle [<train>] [--gare <motif>] [--attente s] [--regle ...]       regle d'attente seule, gares et
//                                                 arret suivant conserves (un train, ou ceux qui passent par la gare)
// node trains.js retenir <train> --jusqua <train> --a <gare>   retient le train a sa gare suivante jusqu'a ce que
//                                                 l'autre soit a quai a la gare, puis le libere (en arriere-plan)
// node trains.js rerail <train>                   remet un train deraille sur ses rails (un a la fois, puis le degager)
// node trains.js garer --gare <motif> | --train <chemin>   met chaque train en manuel des qu'il est a quai (a sa gare
//                                                 suivante s'il est deja a quai au lancement ; en arriere-plan)
// node trains.js auto <train> [on|off]
// node trains.js nom <train> <nom>
// Train : chemin du train ou d'un de ses vehicules, ou nom du train. Gare : nom en jeu exact ou chemin du batiment.
// Regle d'attente par defaut : charger / decharger une fois, 0 s (utilisateur, 26/10/2026 : « mets 0s et charger une
// fois », « y'a aucune raison de positionner cette attente »).
'use strict';
const { call } = require('./client');

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i < 0 ? d : argv[i + 1]; };
const FLAGS = new Set(['dry', 'auto']);
const pos = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--') && !FLAGS.has(argv[i - 1].slice(2))));
const DRY = argv.includes('--dry');
const RULE = { definition: opt('regle', 'LoadUnloadOnce'), duration: Number(opt('attente', 0)) };
const PREFIX = '/Game/FactoryGame/Map/GameLevel01/Persistent_Level.Persistent_Level:PersistentLevel.';
const full = (p) => (p.indexOf('/') >= 0 ? p : PREFIX + p);
const short = (p) => (p ? p.split('.').pop() : p);

async function findStation(ref) {
  const all = await call('stations', {});
  const s = ref.indexOf('/') >= 0 || ref.indexOf(':') >= 0 ? all.find((x) => x.station === full(ref)) : all.find((x) => x.name === ref);
  if (!s) throw new Error('gare introuvable : ' + ref);
  return s;
}

async function findTrain(ref) {
  if (ref.indexOf('_C_') >= 0) return (await call('trains', { path: full(ref) }))[0];
  const t = (await call('trains', {})).filter((x) => x.name === ref);
  if (t.length !== 1) throw new Error('train « ' + ref + ' » : ' + t.length + ' trains portent ce nom');
  return t[0];
}

// Voies integrees d'une gare, de la gare vers le dernier quai : la voie de la gare puis, de connecteur 0 en connecteur 0,
// celles des quais accroches
async function stationTracks(station) {
  const first = (await call('dump', station.station, 1, 1, ['mRailroadTrack'])).mRailroadTrack;
  const out = [];
  let track = first, from = null;
  while (track && out.length < 16) {
    const r = await call('rails', track);
    const c0 = r.connections.find((c) => c.name === 'TrackConnection0'), c1 = r.connections.find((c) => c.name === 'TrackConnection1');
    out.push({ track, mid: { x: (c0.location.x + c1.location.x) / 2, y: (c0.location.y + c1.location.y) / 2, z: (c0.location.z + c1.location.z) / 2 } });
    // vers les quais : l'autre bout que celui par ou on est arrive (la voie de la gare part de son connecteur 0)
    const next = (from === 'TrackConnection0' ? c1 : c0).connections.filter((x) => /RailroadTrackIntegrated/.test(x.track));
    if (next.length !== 1) break;
    from = next[0].name;
    track = next[0].track;
  }
  return out;
}

// Locomotive sur la voie de la gare, puis un wagon par quai : le vehicule se cale sur le rail vise, tourne vers la sortie
// de la gare et s'attelle au precedent. Wagons : autant que de quais etiquetes non vides (q1..), sauf nombre impose.
// La gare doit etre libre. Rend le train (null a blanc).
async function placeTrain(station, wagonsOpt, name) {
  const tracks = await stationTracks(station);
  const tags = (await call('tags', station.station)).tags || [];
  const quais = tags.map((t) => /^q(\d+) (.+)$/.exec(t)).filter((x) => x && !/^vide/.test(x[2])).map((x) => Number(x[1]));
  const wagons = Number(wagonsOpt != null ? wagonsOpt : quais.length ? Math.max(...quais) : tracks.length - 1);
  if (wagons > tracks.length - 1) throw new Error(wagons + ' wagons pour ' + (tracks.length - 1) + ' quais');
  const all = await call('trains', {});
  const docked = all.find((t) => t.dockedAt && t.dockedAt.name === station.name);
  if (docked) throw new Error('gare occupee par ' + docked.name + ' (' + short(docked.path) + ') : attendre son depart');
  // Un train qui vient de partir couvre encore les quais : les wagons poses s'attelaient a sa queue (27/10/2026, 2 wagons
  // du #3 de N279 partis avec le #2). Aucun vehicule a moins de 12 m du milieu d'une voie de la gare ou d'un quai.
  const near = (v) => tracks.some((t) => Math.hypot(v.location.x - t.mid.x, v.location.y - t.mid.y, v.location.z - t.mid.z) < 1200);
  const leaving = all.find((t) => t.vehicles.some(near));
  if (leaving) throw new Error('voies de la gare occupees par ' + leaving.name + ' (' + short(leaving.path) + ') : attendre qu\'il les ait degagees');
  const plan = [['Recipe_Locomotive_C', tracks[0]]].concat(tracks.slice(1, 1 + wagons).map((t) => ['Recipe_FreightWagon_C', t]));
  let first = null;
  for (const [recipe, t] of plan) {
    const r = await call('buildAim', recipe, { x: t.mid.x, y: t.mid.y, z: t.mid.z + 2000 }, t.mid, { onActor: t.track, dryRun: DRY });
    console.log(' ', short(recipe).padEnd(22), DRY ? 'valide (essai)' : r.built ? short(r.actor) : 'NON pose', JSON.stringify(r.blocking));
    if (!DRY && !r.built) throw new Error(recipe + ' non pose : ' + JSON.stringify(r.blocking));
    if (!first && r.built) first = r.actor;
  }
  if (DRY) return null;
  const train = (await call('trains', { path: first }))[0];
  if (train.vehicles.length !== plan.length) throw new Error('train de ' + train.vehicles.length + ' vehicules au lieu de ' + plan.length + ' (attelage ?)');
  return name ? call('trainName', train.path, name) : train;
}

function show(t) {
  const tt = t.timetable ? t.timetable.stops.map((s, i) => (i === t.timetable.current ? '>' : '') + (s.station ? s.station.name : '?')).join(' | ') : 'sans horaire';
  const comp = t.vehicles.map((v) => (/Locomotive/.test(v.class) ? 'L' : 'W')).join('');
  const where = t.dockedAt ? 'a quai ' + t.dockedAt.name : t.vehicles.length ? '(' + Math.round(t.vehicles[0].location.x) + ' ; ' + Math.round(t.vehicles[0].location.y) + ')' : '';
  return [t.name.padEnd(28), comp.padEnd(8), (t.selfDriving ? 'auto' : 'manuel').padEnd(7), t.status.replace('TS_', '').padEnd(12),
    t.error.replace('SDLE_', '').padEnd(14), String(t.speed).padStart(4) + ' km/h', where, '\n    ' + tt + '  ' + short(t.path)].join(' ');
}

const COMMANDS = {
  async liste() {
    const t = await call('trains', opt('gare') ? { station: opt('gare') } : {});
    console.log(t.length, 'trains');
    for (const x of t) console.log(show(x));
  },

  async tournee(ref) {
    const station = await findStation(ref);
    const m = /^(.+) -> (.+)$/.exec(station.name);
    if (!m) throw new Error('« ' + station.name + ' » n\'est pas une gare de chargement (nom « A -> B »)');
    const dest = await findStation(m[2] + ' <- ' + m[1]);
    const others = (await call('trains', {})).filter((t) => t.name === station.name || t.name.startsWith(station.name + ' #'));
    console.log(station.name, '->', dest.name, ':', others.length, 'train(s) deja sur la tournee');
    const train = await placeTrain(station, opt('wagons'), others.length ? station.name + ' #' + (others.length + 1) : station.name);
    if (!train) return;
    const stops = [station.station, dest.station].map((s) => Object.assign({ station: s }, RULE));
    console.log(show(await call('trainTimetable', train.path, stops, { current: 0, selfDriving: true })));
  },

  // Pose un train (locomotive + wagons) a une gare quelconque, sans horaire ni conduite automatique : trains d'essai
  async poser(ref) {
    const train = await placeTrain(await findStation(ref), opt('wagons'), opt('nom'));
    if (train) console.log(show(train));
  },

  async horaire(trainRef, ...stationRefs) {
    const t = await findTrain(trainRef);
    const stops = [];
    for (const r of stationRefs) stops.push(Object.assign({ station: (await findStation(r)).station }, RULE));
    // arret suivant conserve : un train en route ne fait pas demi-tour
    const current = t.timetable ? Math.min(t.timetable.current, stops.length - 1) : 0;
    console.log(show(await call('trainTimetable', t.path, stops, { current, selfDriving: argv.includes('--auto') ? true : undefined })));
  },

  // Regle d'attente (--regle, --attente) de tous les arrets, gares et arret suivant conserves : un train (nom ou chemin)
  // ou tous ceux dont l'horaire passe par une gare (--gare motif)
  async regle(trainRef) {
    const list = trainRef ? [await findTrain(trainRef)] : await call('trains', { station: opt('gare', '$^') });
    for (const t of list) {
      if (!t.timetable || !t.timetable.stops.length) { console.log(t.name, ': sans horaire'); continue; }
      const stops = t.timetable.stops.map((s) => Object.assign({ station: s.station.station }, RULE));
      console.log(show(await call('trainTimetable', t.path, stops, { current: t.timetable.current })));
    }
  },

  // Retient un train a sa gare suivante jusqu'a ce qu'un autre train soit a quai a une gare (ecart entre deux trains
  // d'une meme tournee ; utilisateur, 26/10/2026 : « sur la tournee N279 tu feras attendre #2 jusqu'a ce que #1
  // atteigne N279 ») : attente longue cumulee a la regle (« duree ET regle ») sur l'arret suivant du train retenu ;
  // quand l'autre train est a quai a la gare --a, retour a la regle normale (--regle, --attente), puis controle du
  // depart. Tourne jusque-la : a lancer en arriere-plan.
  async retenir(trainRef) {
    const log = (...m) => console.log(new Date().toTimeString().slice(0, 8), ...m);
    const otherRef = opt('jusqua'), target = opt('a');
    if (!otherRef || !target) throw new Error('usage : node trains.js retenir <train> --jusqua <train> --a <gare>');
    let held = await findTrain(trainRef);
    const other = await findTrain(otherRef);
    const stations = held.timetable.stops.map((s) => s.station.station);
    // a quai : le jeu a deja avance l'arret suivant, on retient a la gare ou il est (26/10/2026 : la retenue etait partie
    // sur la gare suivante, qui etait la gare de chargement de l'autre train)
    const at = held.dockedAt ? held.timetable.stops.findIndex((x) => x.station.name === held.dockedAt.name) : -1;
    const hold = at >= 0 ? at : held.timetable.current;
    const rules = (holdIt) => stations.map((station, i) => Object.assign({ station }, i === hold && holdIt ? { definition: RULE.definition, duration: 7200, durationAndRule: true } : RULE));
    const s = held.timetable.stops[hold];
    if (!(s.durationAndRule && s.duration >= 3600)) await call('trainTimetable', held.path, rules(true), { current: hold });
    log(held.name, 'retenu a', held.timetable.stops[hold].station.name, 'jusqu\'a ce que', other.name, 'soit a quai a', target);
    for (let i = 0; i < 1440; i++) {
      const o = (await call('trains', { path: other.path }))[0];
      if (o.dockedAt && o.dockedAt.name === target) break;
      if (i % 12 === 0) { const h = (await call('trains', { path: held.path }))[0]; log(o.name, o.dockedAt ? 'a quai ' + o.dockedAt.name : o.speed + ' km/h', '|', h.name, h.dockedAt ? 'a quai ' + h.dockedAt.name : h.speed + ' km/h'); }
      await new Promise((r) => setTimeout(r, 5000));
    }
    held = (await call('trains', { path: held.path }))[0];
    await call('trainTimetable', held.path, rules(false), { current: held.timetable.current });
    // la gare garde la regle prise a l'arrivee : on leve aussi l'attente en cours (stationReleaseDock)
    if (held.dockedAt) await call('stationReleaseDock', held.dockedAt.station);
    log(other.name, 'a quai a', target, ': attente de', held.name, 'levee');
    for (let i = 0; i < 24; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const h = (await call('trains', { path: held.path }))[0];
      if (!h.dockedAt) { log(h.name, 'parti,', h.speed, 'km/h, arret suivant', h.timetable.stops[h.timetable.current].station.name); return; }
    }
    log('ATTENTION :', held.name, 'toujours a quai 2 min apres la levee de la retenue');
  },

  // Remet un train deraille sur ses rails (AFGTrain::Rerail, comme la touche E du jeu). UN train a la fois : deux trains
  // remis en meme temps alors qu'ils se touchent deraillent de nouveau aussitot (26/10/2026). Le degager (auto) avant de
  // remettre le suivant.
  async rerail(trainRef) {
    const t = await findTrain(trainRef);
    if (t.selfDriving) await call('trainSelfDriving', t.path, false);
    await call('trainRerail', t.path);
    await new Promise((r) => setTimeout(r, 3000));
    console.log(show((await call('trains', { path: t.path }))[0]));
  },

  // Gare les trains a leur prochain quai : chacun passe en conduite manuelle des qu'il est a quai, et y reste (jamais
  // arrete sur la ligne : entre deux anneaux, un train de 81,5 m deborde sur l'anneau precedent, 26/10/2026). --gare
  // motif sur les gares de l'horaire. Tourne jusqu'a ce que tous soient gares : a lancer en arriere-plan.
  async garer() {
    const log = (...m) => console.log(new Date().toTimeString().slice(0, 8), ...m);
    let todo = (await call('trains', opt('train') ? { path: full(opt('train')) } : { station: opt('gare', '$^') })).filter((t) => t.selfDriving);
    log(todo.length, 'train(s) a garer :', todo.map((t) => t.name).join(', '));
    // un train deja a quai au depart n'est gare qu'a sa gare suivante
    const left = new Set(todo.filter((t) => !t.dockedAt).map((t) => t.path));
    for (let i = 0; i < 720 && todo.length; i++) {
      for (const t of todo.slice()) {
        const u = (await call('trains', { path: t.path }))[0];
        if (!u.dockedAt) left.add(u.path);
        else if (left.has(u.path)) {
          await call('trainSelfDriving', u.path, false);
          log(u.name, 'gare a quai a', u.dockedAt.name);
          todo = todo.filter((x) => x.path !== t.path);
        }
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    if (todo.length) log('non gares apres 36 min :', todo.map((t) => t.name).join(', '));
  },

  async auto(trainRef, on) {
    const t = await findTrain(trainRef);
    console.log(show(await call('trainSelfDriving', t.path, on !== 'off')));
  },

  async nom(trainRef, name) {
    const t = await findTrain(trainRef);
    console.log(show(await call('trainName', t.path, name)));
  },
};

const [cmd, ...args] = pos;
if (!COMMANDS[cmd]) {
  console.error('usage : node trains.js <' + Object.keys(COMMANDS).join('|') + '> ... (voir l\'en-tete)');
  process.exit(2);
}
COMMANDS[cmd](...args).catch((e) => { console.error('ECHEC :', e.message); process.exitCode = 1; });
