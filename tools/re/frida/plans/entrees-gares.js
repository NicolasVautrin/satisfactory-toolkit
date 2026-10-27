// Entrees et sorties de gare : regle de l'utilisateur (26/10/2026) « pas de signaux a l'entree et a la sortie des gares,
// segment minimum de 12m ». Un train locomotive + 4 wagons (81,5 m) deborde de 1,5 m d'une gare a 4 quais (80 m) : avec le
// signal colle au dernier quai, sa queue occupe le bloc d'avant (dans le hub, le bloc de l'anneau lui-meme : « un train en
// gare bloque l'anneau a l'entree de celle-ci »).
//
// node entrees-gares.js liste                       gares dont un signal est pose a l'entree / a la sortie, ou a moins de
//                                                   12 m (premier signal le long du rail qui y aboutit)
// node entrees-gares.js corriger <gare...> [--dry]  coupe le rail d'approche de l'entree en deux rails droits : 12 m cote
//                                                   gare, le reste cote ligne ; le signal (meme type, meme cote) passe a
//                                                   leur jonction. Rail d'approche droit seulement. Le joueur doit etre a
//                                                   moins de ~140 m de l'entree : un joint pose plus loin n'est pas raccorde
//                                                   par le jeu, et un signal sur un joint relie par railLink ne coupe pas
//                                                   les blocs (references/rails.md, « Raccords et distance du joueur »).
//                                                   Refus si le rail d'approche touche un autre rail (mOverlappingTracks) :
//                                                   le jeu met deux rails a moins de 6 m dans le meme bloc, et le rail cote
//                                                   gare y resterait (gares du hub, 26/10/2026 : entree a 24 m d'un
//                                                   aiguillage dont la courbe de 18 m longe le rail sur 13,6 m ; le signal
//                                                   a 12 m de la gare a fusionne anneau et gare, validation 3). En cas
//                                                   d'echec des controles, l'entree d'origine est reposee.
// Gare : nom en jeu exact.
'use strict';
const { call, short } = require('./client');

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry');
const pos = argv.filter((a) => !a.startsWith('--'));
const MIN = 1200; // uu : segment minimum entre un signal et la gare
const RECIPES = { rail: 'Recipe_RailroadTrack_C', BlockSignal: 'Recipe_RailroadBlockSignal_C', PathSignal: 'Recipe_RailroadPathSignal_C' };
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const signalOf = (c) => c.trailingSignal || c.facingSignal || null;
const signalState = (p) => call('dump', p, 1, 1, ['mIsPathSignal', 'mBlockValidation', 'mAspect', 'mIsLeftHanded']);
const sigLabel = (s) => (s ? short(s).replace('Build_Railroad', '').replace(/_C_/, ' ') : null);

// Voies integrees d'une gare : voie de la gare, puis quais ; entree = bout libre du dernier quai, sortie = bout libre de
// la voie de la gare
async function stationEnds(station) {
  const first = (await call('dump', station.station, 1, 1, ['mRailroadTrack'])).mRailroadTrack;
  const firstInfo = await call('rails', first);
  const integ = (c) => c.connections.some((x) => /RailroadTrackIntegrated/.test(x.track));
  const exit = Object.assign({ track: first }, firstInfo.connections.find((c) => !integ(c)) || {});
  let track = first, info = firstInfo, from = null;
  for (let n = 0; n < 16; n++) {
    const c0 = info.connections.find((c) => c.name === 'TrackConnection0'), c1 = info.connections.find((c) => c.name === 'TrackConnection1');
    const out = from === 'TrackConnection0' ? c1 : c0;
    const next = out.connections.filter((x) => /RailroadTrackIntegrated/.test(x.track));
    if (next.length !== 1) return { exit, entry: Object.assign({ track }, out), tracks: n + 1 };
    from = next[0].name; track = next[0].track; info = await call('rails', track);
  }
  throw new Error(station.name + ' : plus de 16 voies integrees');
}

// Rail qui aboutit a un bout de gare : longueur, signal a son autre bout
async function approach(end) {
  const out = [];
  for (const x of end.connections || []) {
    const r = await call('rails', x.track);
    const here = r.connections.find((c) => c.name === x.name), there = r.connections.find((c) => c.name !== x.name);
    out.push({ rail: x.track, name: x.name, length: r.length, here, there, signalThere: signalOf(there) });
  }
  return out;
}

async function liste() {
  let bad = 0;
  for (const s of await call('stations', {})) {
    const e = await stationEnds(s);
    for (const [kind, end] of [['entree', e.entry], ['sortie', e.exit]]) {
      if (!end.name) continue;
      const problems = [];
      if (signalOf(end)) problems.push('signal ' + sigLabel(signalOf(end)) + ' sur le bout de la gare');
      for (const a of await approach(end)) if (a.signalThere && a.length < MIN - 1) problems.push('signal ' + sigLabel(a.signalThere) + ' a ' + Math.round(a.length / 100) + ' m');
      if (problems.length) { bad++; console.log(s.name.padEnd(30), kind.padEnd(7), problems.join(' ; ')); }
    }
  }
  console.log(bad ? bad + ' bout(s) de gare hors regle' : 'toutes les gares respectent la regle');
}

let subsystemPath = null;
async function railroadSubsystem() {
  if (!subsystemPath) subsystemPath = (await call('scan', 'FGRailroadSubsystem', null, 0, 1, {})).items[0].path;
  return subsystemPath;
}

async function corriger(name) {
  const station = (await call('stations', {})).find((s) => s.name === name);
  if (!station) throw new Error('gare « ' + name + ' » introuvable');
  const { entry } = await stationEnds(station);
  const sig = signalOf(entry);
  if (!sig) { console.log(name, ': pas de signal a l\'entree, rien a faire'); return; }
  const aps = await approach(entry);
  if (aps.length !== 1) throw new Error(name + ' : ' + aps.length + ' rails a l\'entree (1 attendu)');
  const ap = aps[0];
  if (ap.there.connections.length !== 1) throw new Error(name + ' : le rail d\'approche a ' + ap.there.connections.length + ' raccords a son autre bout (1 attendu)');
  const partner = ap.there.connections[0]; // connecteur de la ligne (aiguillage de l'anneau) ou part le rail d'approche
  // Rail d'approche droit : normales opposees et alignees sur la corde
  const G = ap.here.location, S = ap.there.location, L = dist(G, S);
  const u = { x: (G.x - S.x) / L, y: (G.y - S.y) / L, z: (G.z - S.z) / L }; // sens de circulation, vers la gare
  const straight = ap.here.normal.x * u.x + ap.here.normal.y * u.y + ap.here.normal.z * u.z > 0.999
    && -(ap.there.normal.x * u.x + ap.there.normal.y * u.y + ap.there.normal.z * u.z) > 0.999 && Math.abs(ap.length - L) < 5;
  if (!straight) throw new Error(name + ' : rail d\'approche courbe (' + Math.round(ap.length / 100) + ' m, corde ' + Math.round(L / 100) + ' m) : cas non traite');
  if (L < 2 * MIN - 1) throw new Error(name + ' : rail d\'approche de ' + Math.round(L / 100) + ' m, trop court pour deux rails de 12 m');
  const overlapping = (await call('dump', ap.rail, 1, 1, ['mOverlappingTracks'])).mOverlappingTracks || [];
  if (overlapping.length) throw new Error(name + ' : le rail d\'approche touche ' + overlapping.map(short).join(', ') + ' (moins de 6 m) : le rail cote gare resterait dans le bloc de la ligne, il faut eloigner la gare');
  const M = { x: G.x - u.x * MIN, y: G.y - u.y * MIN, z: G.z - u.z * MIN };
  const yaw = (Math.atan2(u.y, u.x) * 180) / Math.PI;
  const grade = u.z / Math.hypot(u.x, u.y);
  const sInfo = await signalState(sig);
  const type = /PathSignal/.test(sig) ? 'PathSignal' : 'BlockSignal';
  const left = sInfo.mIsLeftHanded;
  const me = (await call('player')).eyes.location;
  // Aucun vehicule sur le rail d'approche (le demontage ne le verifie pas) : centre a moins de L/2 + 10 m de son milieu
  const mid = { x: (G.x + S.x) / 2, y: (G.y + S.y) / 2, z: (G.z + S.z) / 2 };
  const onIt = (await call('trains', { near: mid, radius: L / 2 + 1000 })).filter((t) => t.vehicles.some((v) => dist(v.location, mid) < L / 2 + 1000));
  console.log(name + ' : approche ' + short(ap.rail) + ' ' + Math.round(L / 100) + ' m depuis ' + short(partner.track) + '.' + partner.name
    + ', ' + type + ' ' + (left ? 'a gauche' : 'a droite') + ' ; nouveau joint a 12 m de la gare (' + [M.x, M.y, M.z].map(Math.round).join(' ; ')
    + '), joueur a ' + Math.round(dist(me, M) / 100) + ' m' + (onIt.length ? ' ; TRAIN SUR L\'APPROCHE : ' + onIt.map((t) => t.name).join(', ') : ''));
  if (DRY) return;
  if (onIt.length) throw new Error(name + ' : train sur le rail d\'approche, attendre qu\'il soit degage');
  if (dist(me, M) > 14000) throw new Error(name + ' : joueur a plus de 140 m du nouveau joint, le jeu ne ferait pas les raccords');
  // Demontage : signal puis rail d'approche
  for (const p of [sig, ap.rail]) await call('dismantle', p, true);
  const built = [];
  try {
    await split();
  } catch (e) {
    // Retour a l'entree d'origine : rail unique de l'aiguillage au quai, signal (meme type, meme cote) au quai
    for (const p of built.reverse()) await call('dismantle', p, true).catch(() => null);
    const back = await call('rail', RECIPES.rail, { path: partner.track, name: partner.name }, { path: entry.track, name: entry.name }, {});
    const backAtDock = back.built ? (await call('rails', back.actor)).connections.find((c) => dist(c.location, G) < 20) : null;
    const backSig = backAtDock ? await call('signal', RECIPES[type], { path: back.actor, name: backAtDock.name }, { leftHanded: !!left }) : null;
    throw new Error(e.message + ' ; entree d\'origine ' + (backSig && backSig.built ? 'reposee (' + short(back.actor) + ', ' + short(backSig.actor) + ')' : 'NON REPOSEE : a refaire a la main'));
  }

  async function split() {
    // Rail cote ligne : depuis le connecteur de l'aiguillage jusqu'au nouveau joint (point libre, cap de la voie)
    const a = await call('rail', RECIPES.rail, { path: partner.track, name: partner.name }, Object.assign({ x: M.x, y: M.y, z: M.z, yaw }, grade ? { grade } : {}), {});
    if (!a.built) throw new Error('rail cote ligne refuse : ' + a.blocking.join(','));
    built.push(a.actor);
    const aInfo = await call('rails', a.actor);
    const aStart = aInfo.connections.find((c) => dist(c.location, S) < 20), aEnd = aInfo.connections.find((c) => dist(c.location, M) < 20);
    let startNote = 'raccorde';
    if (!aStart.connections.some((x) => x.track === partner.track && x.name === partner.name)) {
      // joint sans signal : un raccord par railLink suffit a la circulation
      await call('railLink', await railroadSubsystem(), a.actor, aStart.name, partner.track, partner.name);
      startNote = 'relie par railLink';
    }
    // Rail cote gare : du nouveau joint au bout du dernier quai
    const b = await call('rail', RECIPES.rail, { path: a.actor, name: aEnd.name }, { path: entry.track, name: entry.name }, {});
    if (!b.built) throw new Error('rail cote gare refuse : ' + b.blocking.join(','));
    built.push(b.actor);
    const bInfo = await call('rails', b.actor);
    const bStart = bInfo.connections.find((c) => dist(c.location, M) < 20), bEnd = bInfo.connections.find((c) => dist(c.location, G) < 20);
    const linkedTo = (c, track, n) => c.connections.some((x) => x.track === track && x.name === n);
    if (!linkedTo(bStart, a.actor, aEnd.name)) throw new Error('nouveau joint non raccorde par le jeu (joueur trop loin ?) : le signal n\'y couperait pas les blocs');
    if (!linkedTo(bEnd, entry.track, entry.name)) {
      await call('railLink', await railroadSubsystem(), b.actor, bEnd.name, entry.track, entry.name);
      if (!linkedTo((await call('rails', b.actor)).connections.find((c) => c.name === bEnd.name), entry.track, entry.name)) throw new Error('rail cote gare non raccorde au quai');
    }
    // Signal au nouveau joint : il arrete les trains qui sortent du rail cote ligne vers la gare
    const s = await call('signal', RECIPES[type], { path: a.actor, name: aEnd.name }, { leftHanded: !!left });
    if (!s.built) throw new Error('signal refuse : ' + s.blocking.join(','));
    built.push(s.actor);
    const check = await signalState(s.actor);
    const blocks = [(await call('rails', a.actor)).connections[0].block, (await call('rails', b.actor)).connections[0].block, (await call('rails', entry.track)).connections[0].block];
    console.log('  rails ' + short(a.actor) + ' (' + Math.round(aInfo.length / 100) + ' m, depart ' + startNote + ') + ' + short(b.actor) + ' (' + Math.round(bInfo.length / 100) + ' m) ; '
      + type + ' ' + short(s.actor) + ' : validation ' + check.mBlockValidation + ', aspect ' + check.mAspect
      + ' ; blocs : ligne ' + (blocks[0] !== blocks[1] ? '≠' : '= (ANORMAL)') + ' gare ' + (blocks[1] === blocks[2] ? '(rail cote gare dans le bloc de la gare)' : '(ANORMAL : rail cote gare hors du bloc de la gare)'));
    if (check.mBlockValidation !== 1 || blocks[0] === blocks[1] || blocks[1] !== blocks[2]) throw new Error(name + ' : blocs incorrects apres correction');
  }
}

(async () => {
  const cmd = pos[0];
  if (cmd === 'liste') return liste();
  if (cmd === 'corriger') { for (const n of pos.slice(1)) await corriger(n); return; }
  console.log('usage : node entrees-gares.js liste | corriger <gare...> [--dry]');
})().catch((e) => { console.log('ERREUR', e.message); process.exitCode = 1; });
