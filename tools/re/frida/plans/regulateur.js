// Regulateur des tournees (utilisateur, 26/10/2026 : « on passe a la regulation de la ligne n279 », « il faut que tu
// maintiennes un temps moyen par boucle », « on s'en fout du temps d'arret », « est-ce qu'on peut taguer ca [...] pour
// ne pas avoir a le refaire ? ») : le regulateur tourne dans le jeu des le demarrage de l'agent (game.js, lineRegTick et
// accroche de AFGTrain::OnDocked) et n'occupe pas l'hote. Il regule les trains dont l'horaire passe par une gare
// etiquetee « regulation », groupes par horaire. Boucle = somme des trajets moyens (10 dernieres mesures, gardees en
// etiquettes « trajet > <gare suivante> : ... » sur la gare de depart), sans les arrets ; intervalle = boucle / nombre
// de trains ; a chaque gare, un train arrive moins d'un intervalle apres le depart du precedent y est retenu jusqu'a cet
// intervalle. Etiquettes sauvegardees avec la partie : rien a relancer.
// Charge (utilisateur : « est-ce que tu es capable de determiner si une tournee necessite un train supplementaire et a
// contrario si une ligne n'est pas consommee ? ») : a chaque arrivee et depart, remplissage des wagons et du stock de
// chaque quai ; diagnostic par quai sur les derniers passages. Gare de chargement : il manque un train (trains arrives
// vides, partis pleins, du stock reste au quai), ligne pas alimentee (trains partis vides), trains arrives deja pleins
// (ligne pas consommee au dechargement). Gare de dechargement : ligne pas consommee (quai plein ou trains repartis
// charges), rien n'arrive. Un arret de 0,1 s veut dire « rien a transferer » : wagons vides ET rien a charger, ou
// wagons pleins ET quai de dechargement plein.
//
// node regulateur.js regule <gare>       etiquette « regulation » sur la gare (nom en jeu exact) : sa tournee est regulee
// node regulateur.js deregule <gare>     retire l'etiquette (les trajets appris restent sur les gares)
// node regulateur.js etat [--evenements n]
// node regulateur.js arrete | reprend    arret d'urgence (retenues levees) jusqu'a « reprend » ou au redemarrage de l'agent
'use strict';
const { call } = require('./client');

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i < 0 ? d : argv[i + 1]; };
const pos = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));
const TAG = 'regulation';

function show(s) {
  console.log('regulateur', s.on ? 'en marche' : 'ARRETE', '|', s.lines.length, 'tournee(s)', s.error ? '| ERREUR ' + s.error : '');
  for (const l of s.lines) {
    console.log('\n' + l.order.join(' -> '), '| depuis', l.upS, 's');
    console.log('  boucle moyenne (trajets) :', l.cycleS === null ? 'en cours d\'apprentissage' : l.cycleS + ' s',
      '| intervalle :', l.headwayS === null ? '-' : l.headwayS + ' s', '|', l.trains.length, 'trains');
    for (const [k, m] of Object.entries(l.legs)) console.log('  trajet', k.padEnd(52), m.v + ' s, moyenne de ' + m.s.length + ' (' + m.s.join(' ') + ')');
    for (const [k, st] of Object.entries(l.stations)) {
      console.log('  gare  ', k.padEnd(52), 'dernier depart', st.sinceLastDepS === null ? '-' : 'il y a ' + st.sinceLastDepS + ' s (' + st.lastTrain + ')');
    }
    for (const t of l.trains) {
      console.log('  ' + t.name.padEnd(30), t.at ? 'a quai ' + t.at.station + ' depuis ' + t.at.sinceS + ' s' + (t.at.hold ? ', retenu ' + t.at.hold + ' s' : '')
        : t.from ? 'parti de ' + t.from.station + ' il y a ' + t.from.sinceS + ' s' : 'en route');
    }
    // charge : remplissage moyen (%) des wagons et du stock du quai, a l'arrivee -> au depart, sur les derniers passages
    const pct = (x) => (x == null ? '  -' : String(x).padStart(3)) + ' %';
    for (const [st, quais] of Object.entries(l.cargo || {})) {
      console.log('  charge a', st);
      for (const q of quais) {
        console.log('    q' + q.q, (q.load ? 'charge  ' : 'decharge'), String(q.item || '?').replace(/^Desc_|_C$/g, '').padEnd(20),
          'wagons', pct(q.wagonIn), '->', pct(q.wagonOut), '| quai', pct(q.quaiIn), '->', pct(q.quaiOut),
          '| tendance du quai', q.trend == null ? '-' : (q.trend > 0 ? '+' : '') + q.trend + ' pts', '|', q.n, 'passages :', q.diag);
      }
    }
    for (const e of l.events) console.log('   +' + e.t + ' s', JSON.stringify(e));
  }
}

async function station(name) {
  const s = (await call('stations', {})).filter((x) => x.name === name);
  if (s.length !== 1) throw new Error('gare « ' + name + ' » : ' + s.length + ' gares portent ce nom');
  return s[0];
}

const COMMANDS = {
  async regule(name) {
    const s = await station(name);
    const tags = (await call('tags', s.station)).tags;
    if (tags.some((t) => t.toLowerCase() === TAG)) console.log(name, ': deja etiquetee');
    else console.log(name, ':', JSON.stringify((await call('tags', s.station, tags.concat([TAG]))).tags));
    console.log('tournee prise par le regulateur a son prochain releve (10 s)');
  },

  async deregule(name) {
    const s = await station(name);
    const tags = (await call('tags', s.station)).tags;
    console.log(name, ':', JSON.stringify((await call('tags', s.station, tags.filter((t) => t.toLowerCase() !== TAG))).tags));
  },

  async etat() {
    show(await call('lineRegulatorStatus', { events: Number(opt('evenements', 10)) }));
  },

  async arrete() {
    const r = await call('lineRegulatorStop');
    console.log('retenues levees :', r.released.length ? r.released.join(', ') : 'aucune');
    show(r.state);
  },

  async reprend() {
    show(await call('lineRegulatorStart'));
  },
};

const [cmd, ...args] = pos;
if (!COMMANDS[cmd]) {
  console.error('usage : node regulateur.js <' + Object.keys(COMMANDS).join('|') + '> ... (voir l\'en-tete)');
  process.exit(2);
}
COMMANDS[cmd](...args).catch((e) => { console.error('ECHEC :', e.message); process.exitCode = 1; });
