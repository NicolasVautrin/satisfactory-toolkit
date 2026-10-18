// Ramassage d'objets du monde (spheres de Mercer, Somersloop, limaces...) d'apres la liste du scanner du jeu.
// Usage : node collect.js [--class BP_WAT2_C] [--count 1] [--radius <uu>] [--dry]
//   BP_WAT2_C = sphere de Mercer, BP_WAT1_C = Somersloop, BP_Crystal_C / _mk2_C / _mk3_C = limaces bleue / jaune / violette
// Pour chaque objet : teleportation a cote, attente du chargement de sa cellule, ramassage (touche E du jeu).
// Le joueur est ramene a son point de depart a la fin, meme en cas d'echec.
'use strict';

const { call, short } = require('./client');

const arg = (name, def) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : def;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Attente du chargement : apres une longue teleportation, la cellule du monde a mis plus de 15 s a arriver
// (constate le 18/10/2026 : BP_WAT210 charge apres ~12-20 s)
const LOAD_TIMEOUT_MS = 45000;
const LOAD_POLL_MS = 500;
// Le jeu ne note l'objet comme pris qu'a sa destruction (0,3 s apres le ramassage) : partir avant laisse la cellule
// se decharger, l'objet reste alors compte comme present (constate sur 6 spheres le 18/10/2026)
const GONE_TIMEOUT_MS = 5000;
// Arrivee au-dessus de l'objet : le moteur decale la destination si elle est obstruee
const ARRIVAL_DZ = 150;

// Tournee gloutonne : toujours l'objet restant le plus proche de la position courante
function tour(items, from) {
  const left = items.slice();
  const out = [];
  let at = from;
  while (left.length) {
    let best = 0;
    let bestD = Infinity;
    left.forEach((it, i) => {
      const d = Math.hypot(it.location.x - at.x, it.location.y - at.y, it.location.z - at.z);
      if (d < bestD) { bestD = d; best = i; }
    });
    const [it] = left.splice(best, 1);
    out.push(it);
    at = it.location;
  }
  return out;
}

async function pickWhenLoaded(path, near) {
  const deadline = Date.now() + LOAD_TIMEOUT_MS;
  for (;;) {
    try {
      return await call('pickup', path, near);
    } catch (e) {
      if (!/objet introuvable/.test(e.message) || Date.now() > deadline) throw e;
      await sleep(LOAD_POLL_MS);
    }
  }
}

// Attend la destruction de l'objet ramasse (il n'est alors plus trouve pres de sa position)
async function waitGone(path, near) {
  const deadline = Date.now() + GONE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      await call('pickup', path, near);
    } catch (e) {
      if (/objet introuvable/.test(e.message)) return true;
      throw e;
    }
    await sleep(LOAD_POLL_MS);
  }
  return false;
}

(async () => {
  const cls = arg('class', 'BP_WAT2_C');
  const count = Number(arg('count', '1'));
  const radius = arg('radius') ? Number(arg('radius')) : 0;
  const dry = process.argv.includes('--dry');

  // Candidats en surnombre : certains peuvent echouer ou etre deja pris (compte du jeu en retard), on s'arrete a `count`
  const world = await call('world', 'pickups', { classes: [cls], radius, limit: count * 2 + 10 });
  const stat = world.byClass[cls] || { total: 0, remaining: 0 };
  console.log(cls + ' : ' + stat.remaining + ' restants sur ' + stat.total + ', objectif ' + count + ', ' + world.items.length + ' candidats');
  const start = (await call('player')).eyes;
  const targets = tour(world.items, start.location);
  if (dry) {
    for (const t of targets) console.log('  ' + short(t.path), JSON.stringify(t.location), Math.round(t.distance / 100) + ' m');
    return;
  }
  let ok = 0;
  try {
    for (const t of targets) {
      if (ok >= count) break;
      try {
        await call('teleport', { x: t.location.x, y: t.location.y, z: t.location.z + ARRIVAL_DZ }, null);
        const r = await pickWhenLoaded(t.path, t.location);
        const gone = r.pickedUp && (await waitGone(t.path, t.location));
        if (r.pickedUp && !r.alreadyPickedUp) ok++;
        console.log((r.pickedUp ? 'ramasse ' : 'NON ramasse ') + short(t.path) + (r.alreadyPickedUp ? ' (deja pris)' : '')
          + (r.pickedUp && !gone ? ' (pas encore detruit : peut rester compte comme present)' : ''));
      } catch (e) {
        console.log('ECHEC ' + short(t.path) + ' : ' + e.message);
      }
    }
  } finally {
    await call('teleport', start.location, start.rotation.yaw);
    console.log(ok + '/' + count + ' ramasses, retour au point de depart');
  }
})().catch((e) => {
  console.error('ECHEC :', e.message);
  process.exitCode = 1;
});
