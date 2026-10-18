// Verification stricte : chaque connecteur de chaque element de la tour, etat reel du jeu (IsConnected)
'use strict';
const fs = require('fs');
const T = require('./tower');
(async () => {
  const s = JSON.parse(fs.readFileSync(__dirname + '/tower-state.json', 'utf8'));
  const elements = [['foreuse', s.miner], ['convoyeur foreuse', s.minerBelt], ['uploader', s.uploader], ['convoyeur sortie', s.outputBelt]];
  s.floors.forEach((f, i) => {
    for (const k of ['ctor', 'splitter', 'merger', 'feedBelt', 'outBelt', 'inputLift', 'outputLift']) if (f[k]) elements.push(['etage ' + i + ' ' + k, f[k]]);
  });
  let free = 0;
  let total = 0;
  const lines = [];
  for (const [label, p] of elements) {
    const conns = await T.call('connections', p);
    total += conns.length;
    const libres = conns.filter((c) => !c.connected).map((c) => c.name);
    free += libres.length;
    if (libres.length) lines.push(label.padEnd(24) + ' libres : ' + libres.join(' '));
  }
  console.log(elements.length + ' elements, ' + total + ' connecteurs, ' + free + ' libres');
  for (const l of lines) console.log(l);
  for (const [i, f] of s.floors.entries()) {
    const c = await T.call('machine', f.ctor);
    console.log('etage ' + i + ' : ' + c.recipe + ', courant ' + c.power.hasPower);
  }
  console.log('poteau Mk3 : ' + JSON.stringify(await T.call('power', s.pole)));
})().catch((e) => console.error(e.message));
