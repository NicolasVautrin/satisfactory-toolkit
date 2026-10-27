// Commandes unitaires sur la partie en cours (via l'hote Frida, tools/re/frida/host.py) : une commande = une action ou
// une lecture, resultat en JSON. Evite d'ecrire un script pour chaque verification.
//
// Usage : node fg.js <commande> [arguments...] [--frame <gare>[+<decalage v en m>]] [--depth <n>]
//
// Arguments :
//   <acteur>  chemin complet ou nom court (Build_TrainStation_C_2146896367, ...PlatformConnection0 pour un composant)
//   <point>   x,y,z (monde, uu) ou @u,v,z (repere de --frame, metres)
// --frame : repere d'une gare (voir frame.js) ; chaque position {x,y,z} du resultat recoit aussi "uvz" dans ce repere.
//
// Commandes :
//   help                              cette aide (en-tete de fg.js), sans appel au jeu
//   call <fonction> [arg...]          appel brut d'une fonction de l'agent ; arg = JSON, <point> ou <acteur>
//   player                            joueur (position, regard)
//   selection                         ce que cible le pistolet du joueur en mode demontage : acteur sous le viseur,
//                                     acteur selectionne, selection multiple (UFGBuildGunStateDismantle)
//   teleport <point> [cap]            deplace le joueur
//   goto <x,y[,z]> [m]                « amene-moi en ... » : pose le joueur a 3 m du poteau electrique raccorde le plus
//                                     proche du point (1 km au plus), a sa hauteur (il vole et a besoin du courant) ;
//                                     m : coordonnees en metres (-1621,-1489 m) ; le depart est garde pour `retour` ;
//                                     --dry : poteau choisi, sans deplacer le joueur
//   retour                            ramene le joueur a son depart du dernier goto
//   scan <classe> [--near <point|acteur>] [--radius <m>] [--limit <n>]
//   pose <acteur...>                  position et rotation
//   bounds <acteur...>                boite englobante dans le repere de l'acteur (min, max) et sa pose ; ex. plan d'eau
//   markers [motif]                   balises de la carte du jeu (nom, position, icone), filtrees par nom
//   markers-remove <motif>            supprime les balises dont le nom correspond (ex. "^(HD|MS)$")
//   markers-add <nom> <point> [icone] pose une balise sur la carte (icone : numero du jeu, 350 par defaut)
//   save [etiquette]                  sauvegarde nommee agent_<jjmmaa>_<hhmmss>[_<etiquette>] ; attend le fichier .sav
//   dump <acteur> [champ...]          proprietes (reflexion du jeu), --depth pour les objets imbriques
//   fields <classe|structure> [motif] liste des proprietes (nom, type, offset)
//   rails <rail...>                   connecteurs d'un rail : position, normale, raccords, signaux
//   ports <acteur>                    connecteurs convoyeur / tuyau / electricite d'un batiment
//   signals <signal...>               etat : validation du bloc (1 ok, 2 sans sortie, 3 boucle) et aspect
//   load-mode <quai...> [load|unload] lit ou regle le mode des quais de fret
//   rename <gare> <nom>               renomme une gare (noms par coordonnees : "N279 E331 -> N211 O96" au chargement,
//                                     "N211 O96 <- N279 E331" au dechargement ; regle dans references/commandes.md)
//   nom-gare <gare> [--vers <partenaire> | --depuis <partenaire>] [--appliquer]
//                                     nom d'une gare par ses coordonnees (--vers : gare de chargement, --depuis : gare de
//                                     dechargement) ; --appliquer renomme et relit, sinon le nom est seulement affiche
//   tags <acteur> [etiquette...]      lit ou remplace les etiquettes Unreal d'un acteur (sauvegardees : l'agent pose le
//                                     drapeau au demarrage ; --vider pour tout enlever)
//   dismantle <acteur...>             demonte (avec la voie integree des gares et quais)
'use strict';

const fs = require('fs');
const path = require('path');
const { call } = require('./client');
const { stationFrame } = require('./frame');

const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf('--' + name);
  if (i < 0) return def;
  const v = argv[i + 1];
  argv.splice(i, 2);
  return v;
};

const GOTO_BACK = path.join(__dirname, 'goto-retour.json'); // depart du dernier goto (non versionne)

let levelPrefix = null; // ".../Persistent_Level.Persistent_Level:PersistentLevel." lu sur le pion du joueur
async function actor(name) {
  if (name.indexOf('/') >= 0) return name;
  if (levelPrefix === null) {
    const pawn = (await call('player')).pawn.path;
    levelPrefix = pawn.slice(0, pawn.lastIndexOf('.') + 1);
  }
  return levelPrefix + name;
}

// Un appel a la fois : l'hote ne sert qu'une requete a la fois (des appels simultanes echouent avec "fetch failed")
async function each(names, fn) {
  const out = [];
  for (const n of names) out.push(await fn(n));
  return out;
}

let frame = null;
async function point(s) {
  if (s.startsWith('@')) {
    if (!frame) throw new Error('@u,v,z demande --frame');
    return frame.world(s.slice(1).split(',').map(Number));
  }
  const [x, y, z] = s.split(',').map(Number);
  return { x, y, z };
}

// Code d'une gare (regle de l'utilisateur, 24/10/2026) : N/S puis |y|, E/O puis |x|, en dizaines de metres, a la position
// du batiment de la gare (nord = -Y, est = +X) ; « h<altitude en dizaines de metres> » si une autre gare a le meme code
// (gares superposees de la gare de triage)
const xyCode = (p) => (p.y <= 0 ? 'N' : 'S') + Math.round(Math.abs(p.y) / 1000) + ' ' + (p.x >= 0 ? 'E' : 'O') + Math.round(Math.abs(p.x) / 1000);
async function stationCodes() {
  const items = (await call('scan', 'Build_TrainStation_C', null, 0, 1000, {})).items;
  const shared = {};
  for (const s of items) shared[xyCode(s.location)] = (shared[xyCode(s.location)] || 0) + 1;
  const codes = new Map();
  for (const s of items) {
    const c = xyCode(s.location);
    codes.set(s.path, shared[c] > 1 ? c + ' h' + Math.round(s.location.z / 1000) : c);
  }
  return codes;
}

const isPoint = (s) => /^@?-?[\d.]+,-?[\d.]+,-?[\d.]+$/.test(s);
const isActorName = (s) => /^[A-Za-z]\w*_\d+(\.\w+)?$/.test(s);

// Argument brut de "call" : JSON, point, nom d'acteur ou texte
async function rawArg(s) {
  if (isPoint(s)) return point(s);
  if (isActorName(s)) return actor(s);
  let v;
  try {
    v = JSON.parse(s);
  } catch (e) {
    return s;
  }
  // Dans un objet JSON, "path" peut aussi etre un nom court ({"path":"Build_RailroadTrack_C_123","name":"TrackConnection0"})
  if (v && typeof v === 'object' && typeof v.path === 'string' && isActorName(v.path)) v.path = await actor(v.path);
  return v;
}

// Ajoute "<cle>Uvz" (repere de --frame, metres) a cote de chaque position du resultat (location, Location, ...).
// Les directions (normal, rotation...) ne sont pas converties.
const POSITION_KEY = /^(location|position|origin|aimHit|eyes)$/i;
function withFrame(v) {
  if (!frame || v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(withFrame);
  const out = {};
  for (const [k, x] of Object.entries(v)) {
    out[k] = withFrame(x);
    const p = x && typeof x === 'object' && (typeof x.x === 'number' ? x : typeof x.X === 'number' ? { x: x.X, y: x.Y, z: x.Z } : null);
    if (p && POSITION_KEY.test(k)) out[k + 'Uvz'] = frame.local(p).map((c) => Math.round(c * 10) / 10).join(', ');
  }
  return out;
}

const COMMANDS = {
  async call(fn, ...args) {
    return call(fn, ...(await each(args, rawArg)));
  },
  player: () => call('player'),
  async teleport(p, cap) {
    return call('teleport', await point(p), cap == null ? null : Number(cap));
  },
  // Utilisateur, 27/10/2026 : « comment faire en sorte que tu n'aies plus a chercher comment me teleporter » ; regle :
  // pres d'un poteau alimente, a sa hauteur, le sol importe peu (references/pieges.md, Teleportation)
  async goto(p, unit) {
    if (!p) throw new Error('goto <x,y[,z]> [m]');
    const k = unit === 'm' ? 100 : 1;
    const [x, y, z] = p.split(',').map((v) => Number(v) * k);
    const target = { x, y, z: Number.isFinite(z) ? z : 0 };
    const start = (await call('player')).eyes;
    const flat = (l) => Math.hypot(l.x - target.x, l.y - target.y);
    let poles = [];
    for (const r of [300, 1000]) {
      poles = (await call('scan', 'FGBuildablePowerPole', target, r * 100, 30, {})).items;
      if (poles.length) break;
    }
    let pole = null;
    for (const it of poles.sort((a, b) => flat(a.location) - flat(b.location))) {
      const pw = await call('power', it.path);
      if (pw.wires > 0) { pole = Object.assign({}, it, { power: pw }); break; }
    }
    if (!pole) throw new Error('aucun poteau raccorde a moins de 1 km de ' + JSON.stringify(target));
    if (argv.indexOf('--dry') >= 0) return { essai: true, poteau: pole.path.split('.').pop(), circuit: pole.power.circuitId, aDuPointM: Math.round(flat(pole.location) / 100), location: pole.location };
    fs.writeFileSync(GOTO_BACK, JSON.stringify({ at: new Date().toISOString(), location: start.location, yaw: start.rotation.yaw }));
    await call('teleport', { x: pole.location.x + 300, y: pole.location.y, z: pole.location.z + 200 }, null);
    const now = (await call('player')).eyes.location;
    return { poteau: pole.path.split('.').pop(), circuit: pole.power.circuitId, aDuPointM: Math.round(flat(pole.location) / 100),
      arrivee: { x: Math.round(now.x), y: Math.round(now.y), z: Math.round(now.z) }, depart: { x: Math.round(start.location.x), y: Math.round(start.location.y), z: Math.round(start.location.z) } };
  },
  async retour() {
    if (!fs.existsSync(GOTO_BACK)) throw new Error('pas de depart garde (goto jamais lance)');
    const back = JSON.parse(fs.readFileSync(GOTO_BACK, 'utf8'));
    await call('teleport', back.location, back.yaw);
    return { retour: back.location, depuisLe: back.at };
  },
  // --machine : etat des machines (recette, cadence, pause) ; --recipe <motif> : seulement les machines dont la recette
  // correspond (implique --machine)
  async scan(cls) {
    const near = opt('near');
    const recipe = opt('recipe');
    const machine = argv.indexOf('--machine') >= 0 || !!recipe;
    if (argv.indexOf('--machine') >= 0) argv.splice(argv.indexOf('--machine'), 1);
    const center = !near ? null : isPoint(near) ? await point(near) : (await call('pose', await actor(near))).location;
    const r = await call('scan', cls, center, Number(opt('radius', '0')) * 100, Number(opt('limit', '50')), { machine });
    if (recipe) {
      const re = new RegExp(recipe, 'i');
      r.items = r.items.filter((it) => it.machine && re.test(it.machine.recipe || ''));
    }
    return r;
  },
  async pose(...names) {
    return each(names, async (n) => Object.assign({ path: n }, await call('pose', await actor(n))));
  },
  async bounds(...names) {
    return each(names, async (n) => Object.assign({ path: n }, await call('bounds', await actor(n))));
  },
  // Balises posees sur la carte du jeu (AFGMapManager::mMapMarkers, lues par reflexion)
  async markers(pattern) {
    const manager = (await call('scan', 'FGMapManager', null, 0, 1, {})).items[0];
    if (!manager) throw new Error('gestionnaire de carte introuvable');
    const list = (await call('dump', manager.path, 3, 100000, ['mMapMarkers'])).mMapMarkers || [];
    const re = pattern ? new RegExp(pattern, 'i') : null;
    return list.filter((m) => !re || re.test(m.Name)).map((m) => ({
      name: m.Name, category: m.CategoryName || undefined, type: m.MapMarkerType, icon: m.IconID,
      location: { x: Math.round(m.Location.X), y: Math.round(m.Location.Y), z: Math.round(m.Location.Z) },
    }));
  },
  // Pose une balise : nom, point (x,y,z monde ou @u,v,z avec --frame), numero d'icone du jeu (350 par defaut)
  // Sauvegarde nommee agent_<jjmmaa>_<hhmmss>[_<etiquette>] (a faire avant tout changement important), puis attente du
  // fichier .sav dans le dossier des sauvegardes du jeu (60 s au plus)
  async save(label) {
    const d = new Date(), p2 = (n) => String(n).padStart(2, '0');
    const stamp = p2(d.getDate()) + p2(d.getMonth() + 1) + String(d.getFullYear()).slice(2) + '_' + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds());
    const name = 'agent_' + stamp + (label ? '_' + label.replace(/[^A-Za-z0-9_-]+/g, '-') : '');
    const root = path.join(process.env.LOCALAPPDATA, 'FactoryGame', 'Saved', 'SaveGames');
    const started = Date.now();
    const r = await call('saveGame', name);
    for (;;) {
      for (const dir of fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory())) {
        const file = path.join(root, dir.name, name + '.sav');
        if (!fs.existsSync(file)) continue;
        // ecriture terminee : taille stable sur 1 s
        const size = fs.statSync(file).size;
        await new Promise((res) => setTimeout(res, 1000));
        if (fs.statSync(file).size === size && size > 0) return { ...r, file, size };
      }
      if (Date.now() - started > 60000) throw new Error('sauvegarde ' + name + ' non ecrite apres 60 s (jeu en pause ? sauvegarde deja en cours ?)');
      await new Promise((res) => setTimeout(res, 1000));
    }
  },
  async 'markers-add'(name, where, icon) {
    if (!name || !where) throw new Error('markers-add <nom> <point> [icone]');
    const manager = (await call('scan', 'FGMapManager', null, 0, 1, {})).items[0];
    if (!manager) throw new Error('gestionnaire de carte introuvable');
    return call('addMapMarkers', manager.path, [{ name, location: await point(where), icon: icon == null ? null : Number(icon) }]);
  },
  // Supprime les balises dont le nom correspond au motif (expression reguliere, sans casse : '^(HD|MS)$')
  async 'markers-remove'(pattern) {
    if (!pattern) throw new Error('motif obligatoire');
    const manager = (await call('scan', 'FGMapManager', null, 0, 1, {})).items[0];
    if (!manager) throw new Error('gestionnaire de carte introuvable');
    const re = new RegExp(pattern, 'i');
    const list = (await call('dump', manager.path, 3, 100000, ['mMapMarkers'])).mMapMarkers || [];
    const targets = list.filter((m) => re.test(m.Name));
    if (targets.length) await call('removeMapMarkers', manager.path, targets.map((m) => m.markerGuid));
    const left = (await call('dump', manager.path, 3, 100000, ['mMapMarkers'])).mMapMarkers || [];
    return { removed: targets.length, matchingLeft: left.filter((m) => re.test(m.Name)).length, total: left.length };
  },
  async dump(name, ...only) {
    return call('dump', await actor(name), Number(opt('depth', '1')), 50, only.length ? only : null);
  },
  async fields(name, pattern) {
    const r = await call('fields', name);
    const re = pattern ? new RegExp(pattern, 'i') : null;
    return r.fields.filter((f) => !re || re.test(f.name)).map((f) => f.name + ' : ' + f.type + ' @' + f.offset);
  },
  async rails(...names) {
    return each(names, async (n) => call('rails', await actor(n)));
  },
  async ports(name) {
    return call('connections', await actor(name));
  },
  // Suit un flux de convoyeur depuis un connecteur (<acteur>.<connecteur>, ex. ...Assembler..._123.Output0) : convoyeurs
  // et ascenseurs traverses, jusqu'au premier batiment (repartiteur, fusionneur, stockage, quai...) ; --max <n> etapes.
  // --up : vers l'amont (depuis une entree) ; traverse aussi les repartiteurs (une seule entree), s'arrete aux fusionneurs
  async follow(start) {
    const max = Number(opt('max', '60'));
    const up = argv.indexOf('--up') >= 0;
    const steps = [];
    let conn = await actor(start);
    for (let i = 0; i < max; i++) {
      const next = (await call('dump', conn, 1, 1, ['mConnectedComponent'])).mConnectedComponent;
      if (!next) {
        steps.push({ end: 'connecteur libre', at: conn.split('.').slice(-2).join('.') });
        break;
      }
      const owner = next.slice(0, next.lastIndexOf('.'));
      const cls = owner.split('.').pop().replace(/_\d+$/, '');
      const ports = await call('connections', owner);
      const pose = await call('pose', owner);
      const entered = next.split('.').pop();
      const others = ports.filter((p) => p.name !== entered && p.direction !== (up ? 'output' : 'input'));
      steps.push({ via: owner.split('.').pop(), entered, location: pose.location });
      // Convoyeur / ascenseur (et repartiteur vers l'amont) : un seul autre bout, on continue ; ailleurs on s'arrete
      const passThrough = /ConveyorBelt|ConveyorLift/.test(cls) || (up && /Splitter/.test(cls));
      if (!passThrough || others.length !== 1) {
        steps[steps.length - 1].end = cls + (others.length ? ' (' + (up ? 'entrees' : 'sorties') + ' : ' + others.map((p) => p.name).join(', ') + ')' : '');
        break;
      }
      conn = owner + '.' + others[0].name;
    }
    return steps;
  },
  // Sources d'un flux, vers l'amont depuis une entree (<acteur>.<connecteur>) : tout l'arbre des convoyeurs, a travers
  // repartiteurs, fusionneurs et stockages (contenu indique), jusqu'aux machines (recette), quais (gare) et bouts libres.
  // Chaque noeud indique le convoyeur le plus lent traverse depuis le depart (minMk, ex. LiftMk2) : le goulot du chemin.
  // --max <n> : batiments visites au plus
  async sources(start) {
    const max = Number(opt('max', '400'));
    const seen = new Set();
    const found = [];
    const where = (p) => [p.x, p.y, p.z].map(Math.round).join(',');
    const contents = async (owner) => {
      const inv = (await call('dump', owner, 1, 1, ['mStorageInventory', 'mInventory'])) || {};
      const path = inv.mStorageInventory || inv.mInventory;
      if (!path) return null;
      const s = JSON.stringify(await call('dump', path, 3, 60, ['mInventoryStacks']));
      const total = (s.match(/"NumItems":\d+/g) || []).reduce((a, x) => a + Number(x.split(':')[1]), 0);
      return total + ' ' + [...new Set(s.match(/Desc_\w+?_C/g) || [])].join(' ');
    };
    const MK = (cls) => Number((cls.match(/Mk(\d)/) || [0, 9])[1]);
    const walk = async (conn, depth, slowest) => {
      for (;;) {
        if (seen.size >= max) return;
        const next = (await call('dump', conn, 1, 1, ['mConnectedComponent'])).mConnectedComponent;
        if (!next) {
          found.push({ depth, source: 'bout libre', at: conn.split('.').slice(-2).join('.'), minMk: slowest });
          return;
        }
        const owner = next.slice(0, next.lastIndexOf('.'));
        if (seen.has(owner)) return;
        seen.add(owner);
        const cls = owner.split('.').pop().replace(/_\d+$/, '');
        const entered = next.split('.').pop();
        const ins = (await call('connections', owner)).filter((p) => p.name !== entered && p.direction === 'input' && p.connected);
        if (/ConveyorBelt|ConveyorLift/.test(cls) && ins.length === 1) {
          if (!slowest || MK(cls) < MK(slowest)) slowest = cls.replace('Build_Conveyor', '');
          conn = owner + '.' + ins[0].name;
          continue;
        }
        const pose = await call('pose', owner);
        const node = { depth, source: cls, path: owner.split('.').pop(), at: where(pose.location), minMk: slowest };
        if (/Storage|DockingStation/.test(cls)) node.contents = await contents(owner);
        if (/DockingStation/.test(cls)) {
          const st = (await call('dump', owner, 1, 1, ['mStationDockingMaster'])).mStationDockingMaster;
          if (st) node.station = (await call('dump', st, 1, 1, ['mStationName'])).mStationName;
        }
        if (!/Splitter|Merger|Storage|ConveyorBelt|ConveyorLift/.test(cls)) {
          const m = await call('scan', cls, pose.location, 10, 1, { machine: true });
          const it = m.items.find((x) => x.path === owner);
          if (it && it.machine) node.recipe = it.machine.recipe;
        }
        found.push(node);
        // Fusionneur, repartiteur, stockage : on remonte chacune de leurs entrees raccordees
        if (/Splitter|Merger|Storage/.test(cls)) for (const p of ins) await walk(owner + '.' + p.name, depth + 1, slowest);
        return;
      }
    };
    await walk(await actor(start), 0, null);
    return found;
  },
  // Etat de demontage du pistolet (BP_BuildGun_C.<...>_DismantleState) : lu meme si le pistolet est dans un autre mode
  // (champs restes de la derniere visee), d'ou le mode courant dans le resultat
  async selection() {
    const gun = (await call('scan', 'BP_BuildGun_C', null, 0, 1, {})).items[0];
    if (!gun) throw new Error('pistolet du joueur introuvable (BP_BuildGun_C)');
    const g = await call('dump', gun.path, 1, 1, ['mCurrentState', 'mCurrentStateEnum']);
    const state = gun.path + '.' + gun.path.split('.').pop() + '_DismantleState';
    const d = await call('dump', state, 1, 200, ['mCurrentlyAimedAtActor', 'mCurrentlySelectedActor', 'mPendingDismantleActors']);
    return { modeDemontage: g.mCurrentState === state, vise: d.mCurrentlyAimedAtActor, selectionne: d.mCurrentlySelectedActor, multiple: d.mPendingDismantleActors };
  },
  async signals(...names) {
    return each(names, async (n) => Object.assign({ signal: n },
      await call('dump', await actor(n), 1, 1, ['mIsPathSignal', 'mBlockValidation', 'mAspect', 'mIsLeftHanded'])));
  },
  async 'load-mode'(...args) {
    const mode = args[args.length - 1];
    const set = mode === 'load' ? true : mode === 'unload' ? false : null;
    const names = set === null ? args : args.slice(0, -1);
    return each(names, async (n) => call('platformLoadMode', await actor(n), set));
  },
  async tags(name, ...list) {
    const path = await actor(name);
    const vider = argv.indexOf('--vider') >= 0;
    const tags = list.filter((t) => t !== '--vider');
    return call('tags', path, vider ? [] : tags.length ? tags : undefined);
  },
  // Le jeu filtre le texte puis applique le nom dans un rappel : relecture une seconde apres
  async rename(name, ...words) {
    const path = await actor(name);
    const res = await call('renameStation', path, words.join(' '));
    await new Promise((r) => setTimeout(r, 1000));
    return Object.assign(res, { name: (await call('dump', path, 1, 1, ['mStationName'])).mStationName });
  },
  async 'nom-gare'(name, ...rest) {
    if (!name) throw new Error('nom-gare <gare> [--vers <partenaire> | --depuis <partenaire>] [--appliquer]');
    const flag = (f) => { const i = rest.indexOf(f); return i < 0 ? null : rest[i + 1]; };
    const vers = flag('--vers'), depuis = flag('--depuis');
    if (vers && depuis) throw new Error('--vers ou --depuis, pas les deux');
    const codes = await stationCodes();
    const code = async (n) => {
      const p = await actor(n);
      if (!codes.has(p)) throw new Error(n + ' : gare introuvable');
      return codes.get(p);
    };
    const path = await actor(name);
    const own = await code(name);
    const same = [...codes.entries()].filter(([p, c]) => c === own && p !== path);
    if (same.length) throw new Error('code ' + own + ' deja porte par ' + same.map(([p]) => p.split('.').pop()).join(', '));
    const wanted = vers ? own + ' -> ' + (await code(vers)) : depuis ? own + ' <- ' + (await code(depuis)) : own;
    const current = (await call('dump', path, 1, 1, ['mStationName'])).mStationName;
    if (rest.indexOf('--appliquer') < 0) return { gare: path, actuel: current, nom: wanted };
    await call('renameStation', path, wanted);
    await new Promise((r) => setTimeout(r, 1000));
    const after = (await call('dump', path, 1, 1, ['mStationName'])).mStationName;
    return { gare: path, avant: current, nom: after, conforme: after === wanted };
  },
  async dismantle(...names) {
    return each(names, async (n) => call('dismantle', await actor(n), true));
  },
};

(async () => {
  const frameArg = opt('frame');
  if (frameArg) {
    const [name, offset] = frameArg.split('+');
    frame = await stationFrame(name, Number(offset || '0'));
  }
  const [cmd, ...args] = argv;
  // Aide : l'en-tete de ce fichier, qui decrit les commandes (une seule source, a jour avec le code), sans appel au jeu
  if (!cmd || cmd === 'help') {
    const head = [];
    for (const line of fs.readFileSync(__filename, 'utf8').split('\n')) {
      if (!line.startsWith('//')) break;
      head.push(line.replace(/^\/\/ ?/, ''));
    }
    console.log(head.join('\n'));
    return;
  }
  if (!COMMANDS[cmd]) {
    console.error('commande inconnue : ' + cmd + '\ncommandes : ' + Object.keys(COMMANDS).join(', ') + ' (voir l\'en-tete de fg.js)');
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify(withFrame(await COMMANDS[cmd](...args)), null, 1));
})().catch((e) => {
  console.error('ECHEC :', e.message);
  process.exitCode = 1;
});
