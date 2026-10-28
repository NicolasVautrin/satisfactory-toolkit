// Refonte du module 1 de carburant pour fusees en disposition compacte (utilisateur, 27/10/2026 : « oui refais le module
// 1 en compact ») : le module etale (265 m nord-sud) n'a jamais tourne (charbon compacte sans debouche). On le demonte
// avec les fins des lignes d'arrivee de gares-carburant.js au-dela des nouveaux raccords, puis carburant-fusee.js le
// repose en compact (30 m plus au nord, 182 m) et raccorde les arrivees (phase raccords).
//
// node refonte-fusee-m1.js releve     ce qui sera demonte (module, demi-tuyaux des pompes, fins de lignes), sans rien toucher
// node refonte-fusee-m1.js demonte    demontage (sauvegarder avant), etat des lignes mis a jour, etat du module archive
//                                     (carburant-fusee-m1-etale-state.json)
// Ensuite : SLOTS[1].layout = 'compact' dans carburant-fusee.js, puis node carburant-fusee.js tout --module=1
'use strict';
const fs = require('fs');
const path = require('path');
const { call, short } = require('./client');

const M1 = path.join(__dirname, 'carburant-fusee-m1-state.json');
const M1_ARCHIVE = path.join(__dirname, 'carburant-fusee-m1-etale-state.json');
const GARES = path.join(__dirname, 'gares-carburant-state.json');
// Fins de lignes de gares-carburant.js au-dela des raccords du module compact (carburant-fusee.js, phase raccords)
const TAILS = {
  actors: ['nitrique n2', 'nitrique n3', 'azote coin', 'azote e0', 'azote e1', 'azote e2', 'azote e3', 'azote fin',
    'charbon n2', 'charbon n3', 'charbon coin no', 'charbon e0', 'charbon e1', 'charbon e2', 'charbon e3', 'charbon coin ne', 'charbon arrivee',
    'soufre r-277683', 'soufre coin nord', 'soufre haut', 'soufre bas', 'soufre vers T', 'soufre relais N', 'soufre vers N'],
  links: ['nitrique n1 > n2', 'nitrique n2 > n3', 'azote n2 > coin', 'azote coin > e0', 'azote e0 > e1', 'azote e1 > e2', 'azote e2 > e3', 'azote e3 > fin',
    'charbon n1 > n2', 'charbon n2 > n3', 'charbon n3 > coin no', 'charbon coin no > e0', 'charbon e0 > e1', 'charbon e1 > e2', 'charbon e2 > e3',
    'charbon e3 > coin ne', 'charbon coin ne > arrivee', 'soufre r-273367 > r-277683', 'soufre r-277683 > coin nord', 'soufre coin nord > haut',
    'soufre haut > bas', 'soufre bas > vers T', 'soufre vers T > relais', 'soufre relais > vers N', 'soufre > tete T', 'soufre > tete N'],
};
// Tetes du module dont le vis-a-vis est la derniere piece d'une ligne a demonter (le petrole garde son oleoduc)
const HEADS = [['nitrique K 53400', 'Connection0'], ['azote N 74400', 'Connection2'], ['charbon N 0', 'Input1'], ['soufre T 0', 'Input1'], ['soufre N 0', 'Input1']];

const peer = async (a, name) => {
  const p = (await call('dump', a + '.' + name, 1, 1, ['mConnectedComponent'])).mConnectedComponent;
  return typeof p === 'string' && p ? p.split('.').slice(0, -1).join('.') : null;
};

async function plan() {
  const st = JSON.parse(fs.readFileSync(M1, 'utf8'));
  const G = JSON.parse(fs.readFileSync(GARES, 'utf8'));
  const pumps = Object.entries(st.actors).filter(([k]) => k.startsWith('pompe ')).map(([, a]) => a);
  const pumpPipes = [];
  for (const p of pumps) for (const c of await call('connections', p)) { const q = c.connected ? await peer(p, c.name) : null; if (q) pumpPipes.push(q); }
  const finals = [];
  for (const [k, n] of HEADS) { const q = await peer(st.actors[k], n); if (q) finals.push(q); }
  const tails = TAILS.actors.map((k) => [k, G.actors[k]]).concat(TAILS.links.map((k) => [k, G.links[k]]));
  const missing = tails.filter(([, a]) => !a).map(([k]) => k);
  return {
    st, G, links: Object.values(st.links).concat(pumpPipes), wires: Object.values(st.wires).filter((w) => typeof w === 'string'),
    actors: Object.values(st.actors), finals, tails: tails.filter(([, a]) => a), missing,
  };
}

const PH = {
  async releve() {
    const p = await plan();
    console.log('module 1 etale :', p.actors.length, 'pieces,', p.links.length, 'liaisons (dont', p.links.length - Object.keys(p.st.links).length, 'demi-tuyaux de pompes),', p.wires.length, 'cables');
    console.log('dernieres pieces des lignes (vis-a-vis des tetes) :', p.finals.map(short).join(', '));
    console.log('fins de lignes :', p.tails.length, 'pieces et liaisons', p.missing.length ? '; ABSENTES de l\'etat : ' + p.missing.join(', ') : '');
  },
  async demonte() {
    const p = await plan();
    if (p.missing.length) throw new Error('fins de lignes absentes de l\'etat : ' + p.missing.join(', '));
    const lots = [['cables', p.wires], ['liaisons', p.links], ['dernieres pieces des lignes', p.finals], ['fins de lignes', p.tails.map(([, a]) => a)], ['pieces', p.actors]];
    for (const [what, list] of lots) {
      let done = 0, gone = 0;
      const failed = [];
      for (let i = 0; i < list.length; i += 40) {
        const r = await call('dismantleMany', list.slice(i, i + 40), true);
        done += r.done; gone += r.gone; failed.push(...r.failed);
      }
      console.log(what.padEnd(28), done, 'demontes,', gone, 'deja absents', failed.length ? '; ECHECS : ' + failed.slice(0, 5).join(' | ') : '');
      if (failed.length) throw new Error(what + ' : ' + failed.length + ' echecs');
    }
    // etat des lignes : les fins demontees en sortent ; etat du module archive
    for (const [k] of p.tails) { delete p.G.actors[k]; delete p.G.links[k]; }
    for (const f of p.finals) for (const tab of [p.G.actors, p.G.links]) for (const [k, a] of Object.entries(tab)) if (a === f) delete tab[k];
    fs.writeFileSync(GARES, JSON.stringify(p.G, null, 1) + '\n');
    fs.renameSync(M1, M1_ARCHIVE);
    console.log('etat des lignes mis a jour ; etat du module 1 etale archive :', path.basename(M1_ARCHIVE));
  },
};
const ph = process.argv[2];
if (!PH[ph]) { console.error('phases : ' + Object.keys(PH).join(' | ')); process.exit(2); }
PH[ph]().catch((e) => { console.error('ECHEC :', e.message); process.exitCode = 1; });
