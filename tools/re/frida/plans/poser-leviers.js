// Pose les leviers manquants (liste de aiguillages-sans-levier.js : aiguillages-sans-levier.json) avec la commande
// switchControl de l'agent, puis met sur une branche vivante tout aiguillage dont la position designe une impasse (branche
// qui finit en bout libre en moins de 4 rails : lignes externes de 40 m des anneaux). Utilisateur, 26/10/2026 : « pour
// commencer je vois pas le signal d'aiguillage sur la voie » ; « est ce que tu es capable de les poser ? ».
//
// node poser-leviers.js [--essai]
'use strict';
const fs = require('fs');
const path = require('path');
const { call } = require('./client');

const ESSAI = process.argv.includes('--essai');
const short = (p) => (p ? p.split('_C_').pop() : p);

// La branche part du connecteur `from` du rail : finit-elle en bout libre en moins de 4 rails ?
async function deadEnd(rail, conn) {
  let track = rail, fromName = null;
  for (let i = 0; i < 4; i++) {
    const r = await call('rails', track);
    // l'autre bout que celui par ou l'on arrive (au depart : le bout qui n'est pas au point de l'aiguillage)
    const far = fromName ? r.connections.find((c) => c.name !== fromName) : r.connections.reduce((a, b) => (Math.hypot(b.location.x - conn.x, b.location.y - conn.y) > Math.hypot(a.location.x - conn.x, a.location.y - conn.y) ? b : a));
    if (!far.connections.length) return true;
    if (far.connections.length > 1) return false;
    track = far.connections[0].track; fromName = far.connections[0].name;
  }
  return false;
}

(async () => {
  const list = JSON.parse(fs.readFileSync(path.join(__dirname, 'aiguillages-sans-levier.json'), 'utf8'));
  let ok = 0, ko = 0, set = 0;
  for (const m of list) {
    const before = await call('switchPosition', m.connector);
    let built = !!before.switchControl;
    if (!built && !ESSAI) {
      const r = await call('switchControl', m.connector, {});
      built = r.built && !!r.switchControl;
      if (!built) console.log('ECHEC levier ' + m.rail + ' ' + JSON.stringify(r.blocking || r.disqualifiers));
    }
    built ? ok++ : ko++;
    // position sur une impasse : la remettre sur une branche vivante
    const dead = [];
    for (const b of before.branches) dead.push(await deadEnd(b, m.at));
    let pos = before.position;
    if (dead[pos] && dead.some((d) => !d)) {
      const good = dead.findIndex((d) => !d);
      if (!ESSAI && built) { pos = (await call('switchPosition', m.connector, good)).position; set++; }
      console.log(m.rail.padEnd(28) + ' position ' + before.position + ' (impasse ' + short(before.branches[before.position]) + ') -> ' + (ESSAI ? good + ' (essai)' : pos));
    }
  }
  console.log(list.length + ' aiguillages : ' + ok + ' avec levier, ' + ko + ' sans ; ' + set + ' remis sur une branche vivante');
})().catch((e) => { console.log('ERREUR', e.message); process.exitCode = 1; });
