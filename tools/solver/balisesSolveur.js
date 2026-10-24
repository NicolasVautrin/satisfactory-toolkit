'use strict';
/**
 * balisesSolveur.js
 *
 * Balises de la carte du jeu propres à l'optimiseur de gares (optimizeStationsMulti.js), posées et retirées d'un coup
 * (agent Frida, tools/re/frida/host.py). Une balise par gare proposée par un résultat : les gares libres, ni les
 * arrivées ni les gares imposées, qui existent déjà. Le nom de la balise ne donne que la gare (« solveur G7 »), pas ses
 * minerais (utilisateur, 24/10/2026).
 *
 * Usage :
 *   node balisesSolveur.js poser <resultat> [--dry]   retire les balises du solveur, puis pose une balise par gare de
 *                                                     data/stations_multi_<resultat>.json
 *   node balisesSolveur.js retirer [--anciens]        retire toutes les balises du solveur ; --anciens retire aussi les
 *                                                     balises « plan G<n> ... » posées à la main pour le calcul du 21/10
 *   node balisesSolveur.js lister                     balises du solveur en place
 *
 * Les balises du solveur se reconnaissent à leur nom, qui commence par « solveur » suivi d'un espace.
 */

const fs = require('fs');
const path = require('path');
const { call } = require('../re/frida/plans/client.js');

const DATA = path.join(__dirname, '..', '..', 'data');
const PREFIX = 'solveur ';
const MINE = new RegExp('^' + PREFIX);
const OLD = /^plan G\d+\b/;
const COLOR = { r: 1, g: 0, b: 1, a: 1 }; // magenta : distinct des balises grises de l'utilisateur
const ICON = 350;

async function manager() {
  const m = (await call('scan', 'FGMapManager', null, 0, 1, {})).items[0];
  if (!m) throw new Error('gestionnaire de carte introuvable');
  return m.path;
}

const markers = async (mgr) => (await call('dump', mgr, 3, 100000, ['mMapMarkers'])).mMapMarkers || [];

async function remove(mgr, re) {
  const targets = (await markers(mgr)).filter((m) => re.test(m.Name));
  if (targets.length) await call('removeMapMarkers', mgr, targets.map((m) => m.markerGuid));
  return targets.map((m) => m.Name);
}

const COMMANDS = {
  async lister() {
    const list = (await markers(await manager())).filter((m) => MINE.test(m.Name));
    for (const m of list) console.log(m.Name, '(' + Math.round(m.Location.X) + ' ; ' + Math.round(m.Location.Y) + ')');
    console.log(list.length, 'balise(s) du solveur');
  },
  async retirer() {
    const mgr = await manager();
    const gone = await remove(mgr, MINE);
    if (process.argv.includes('--anciens')) gone.push(...(await remove(mgr, OLD)));
    console.log(gone.length, 'balise(s) retiree(s)' + (gone.length ? ' : ' + gone.join(', ') : ''));
  },
  async poser(result) {
    if (!result) throw new Error('usage : node balisesSolveur.js poser <resultat>');
    const file = path.join(DATA, 'stations_multi_' + result + '.json');
    const stations = JSON.parse(fs.readFileSync(file, 'utf8')).stations.filter((s) => !s.fixed && !s.imposed);
    const wanted = stations.map((s) => ({ name: PREFIX + s.label, location: { x: s.x, y: s.y, z: 0 }, icon: ICON, color: COLOR }));
    if (process.argv.includes('--dry')) {
      for (const w of wanted) console.log(w.name, '(' + w.location.x + ' ; ' + w.location.y + ')');
      console.log(wanted.length, 'balise(s) a poser (essai, rien n\'est change)');
      return;
    }
    const mgr = await manager();
    const gone = await remove(mgr, MINE);
    const added = await call('addMapMarkers', mgr, wanted);
    const left = (await markers(mgr)).filter((m) => MINE.test(m.Name)).length;
    console.log(gone.length, 'retiree(s),', added.filter((a) => a.added).length, 'posee(s) sur', wanted.length, '; en place :', left, '(' + path.basename(file) + ')');
  },
};

const [cmd, ...args] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!COMMANDS[cmd]) {
  console.error('usage : node balisesSolveur.js poser <resultat> [--dry] | retirer [--anciens] | lister');
  process.exit(2);
}
COMMANDS[cmd](...args).catch((e) => { console.error('ERR', e.message); process.exit(1); });
