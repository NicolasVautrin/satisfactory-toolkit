// Garde une zone chargee comme pres du joueur (rochers et collisions de World Partition) le temps d'un chantier lointain,
// par des sources de streaming de l'agent (voir tracer.js loadArea et references/pieges.md) : grille de 300 m au plus,
// attente de la fin du chargement. Les sources restent jusqu'a « retire » (ou jusqu'au demontage de leur acteur).
// node zone-chargee.js pose <x0,y0,x1,y1> (uu)   |   node zone-chargee.js retire   |   node zone-chargee.js liste
'use strict';
const { call } = require('./client');

const [cmd, arg] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  if (cmd === 'pose') {
    const [x0, y0, x1, y1] = (arg || '').split(',').map(Number);
    if (![x0, y0, x1, y1].every(Number.isFinite)) throw new Error('zone attendue : x0,y0,x1,y1');
    const SP = 30000;
    const nx = Math.max(1, Math.ceil((x1 - x0) / SP)), ny = Math.max(1, Math.ceil((y1 - y0) / SP));
    const pts = [];
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) pts.push({ x: x0 + ((i + 0.5) * (x1 - x0)) / nx, y: y0 + ((j + 0.5) * (y1 - y0)) / ny, z: 15000 });
    const paths = await call('streamingSourceAdd', pts);
    const t0 = Date.now();
    for (;;) {
      const st = (await call('streamingSources')).filter((s) => paths.includes(s.path));
      if (st.length && st.every((s) => s.completed)) break;
      if (Date.now() - t0 > 120000) { console.log('ATTENTION : chargement pas fini apres 2 min'); break; }
      await sleep(1000);
    }
    await sleep(3000);
    console.log('zone chargee :', paths.length, 'sources,', Math.round((Date.now() - t0) / 1000), 's');
  } else if (cmd === 'retire') {
    await call('streamingSources', { adopter: true });
    console.log('sources retirees :', (await call('streamingSourceRemove')).length);
  } else if (cmd === 'liste') {
    for (const s of await call('streamingSources', { adopter: true })) console.log(s.path.split('.').pop(), Math.round(s.location.x), Math.round(s.location.y), s.completed ? 'chargee' : 'en cours');
  } else throw new Error('usage : node zone-chargee.js pose x0,y0,x1,y1 | retire | liste');
})().catch((e) => { console.error('ECHEC :', e.message); process.exitCode = 1; });
