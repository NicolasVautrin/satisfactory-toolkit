// Tampons des quais de chargement d'une gare (regle de l'utilisateur : tout quai de chargement est buffeurise ; montage
// valide a la gare 2 le 20/10/2026 : « je les aurais places a la meme hauteur que les quais, alignes sur les ports
// load »). Pour chaque quai :
//  - un conteneur industriel retourne vers le quai, base au niveau des rails : ses sorties Output1 (+1 m) et Output2
//    (+5 m) face aux entrees Input0 et Input1 du quai, a 3 m (refus a 2 m : il empiete sur le quai) ; son entree regarde
//    vers l'exterieur (cote d'arrivee des lignes) ;
//  - PAS de fondations dessous (utilisateur, 23/10/2026 : « pas de fondations pour les tampons ») : le conteneur est pose
//    en l'air (FGCDInvalidFloor ignore). La phase fondations (2 x 2 fondations 8x1, bande de 3 a 19 m devant les entrees)
//    reste pour memoire, a ne plus lancer ;
//  - deux convoyeurs Mk6 de 3 m : Output1 -> Input0, Output2 -> Input1 (« tu peux meme brancher les 2 ports »).
// Reprise de tampons-gare2.js et raccords-quais-gare2.js (scratchpad, gare 2), quais lus dans l'etat de la gare.
//
// node tampons-quais.js <etat de gare> fondations|conteneurs|raccords|verifie [--noms n1,n2,...] [--quais 1,2,4] [--dry]
//   <etat de gare> : plans/<etat>-state.json (champ platforms, dans l'ordre de railplan : de la gare vers le bout)
//   --noms : nom de chaque quai (ce qu'il charge), dans le meme ordre ; etat des tampons : plans/<etat>-tampons-state.json
'use strict';
const fs = require('fs');
const path = require('path');
const { call, short } = require('./client');

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf('--' + name); return i < 0 ? def : argv[i + 1]; };
const DRY = argv.includes('--dry');
const [etat, phase] = argv;
const GAP = 300; // entre une sortie du conteneur et l'entree du quai (uu) : convoyeur de 3 m
const BOX_OUT = GAP + 400; // centre du conteneur devant l'entree (ses sorties sont a +400 de son centre)
const BOX_DROP = 100; // base du conteneur sous Input0 (Output1 a +100)
const FOUND_OUT = GAP + 800; // centre de la bande de fondations (2 rangees de 8 m depuis GAP)

const gare = JSON.parse(fs.readFileSync(path.join(__dirname, etat + '-state.json'), 'utf8'));
const noms = (opt('noms', '') || '').split(',').filter(Boolean);
// --quais 1,2,4 : seulement ces quais (les autres restent sans tampon, ex. quai libre)
const only = opt('quais') ? opt('quais').split(',').map(Number) : null;
const QUAIS = {};
gare.platforms.forEach((p, i) => { if (!only || only.includes(i + 1)) QUAIS['q' + (i + 1) + (noms[i] ? '-' + noms[i] : '')] = p; });
const SF = path.join(__dirname, etat + '-tampons-state.json');
const st = fs.existsSync(SF) ? JSON.parse(fs.readFileSync(SF, 'utf8')) : { fondations: {}, conteneurs: {}, raccords: {} };
const save = () => { if (!DRY) fs.writeFileSync(SF, JSON.stringify(st, null, 1)); };

function report(label, r) {
  console.log(label.padEnd(28), r.built ? 'construit ' + (r.actor ? short(r.actor) : '') : DRY ? 'essai' : 'NON construit',
    r.blocking && r.blocking.length ? 'BLOQUANT ' + JSON.stringify(r.blocking) : '');
  if (!DRY && !r.built) throw new Error(label + ' : non construit');
}

// Entree Input0 de chaque quai, sa normale (vers l'exterieur), la tangente et le cap du quai
async function inputs() {
  const out = {};
  for (const [name, q] of Object.entries(QUAIS)) {
    const c = (await call('connections', q)).find((k) => k.name === 'Input0');
    const yaw = (await call('pose', q)).rotation.yaw;
    const h = Math.hypot(c.normal.x, c.normal.y);
    out[name] = { at: c.location, n: { x: c.normal.x / h, y: c.normal.y / h }, t: { x: -c.normal.y / h, y: c.normal.x / h }, yaw };
  }
  return out;
}
const off = (p, v, k) => ({ x: p.x + v.x * k, y: p.y + v.y * k });

const PH = {
  async fondations() {
    const I = await inputs();
    for (const [name, q] of Object.entries(I)) {
      const top = q.at.z - BOX_DROP;
      for (const [a, b] of [[-400, -400], [-400, 400], [400, -400], [400, 400]]) {
        const key = name + ' ' + a + ',' + b;
        if (st.fondations[key]) continue;
        // a : le long de la voie (t), b : vers l'exterieur (n), autour du centre de la bande
        const c = off(off(q.at, q.n, FOUND_OUT + b), q.t, a);
        const r = await call('build', 'Recipe_Foundation_8x1_01_C', { x: c.x, y: c.y, z: top - 50 }, q.yaw, { dryRun: DRY });
        report('fondation ' + key, r);
        if (r.built) { st.fondations[key] = r.actor || true; save(); }
      }
    }
  },
  async conteneurs() {
    const I = await inputs();
    for (const [name, q] of Object.entries(I)) {
      if (st.conteneurs[name]) continue;
      const c = off(q.at, q.n, BOX_OUT);
      const r = await call('build', 'Recipe_StorageContainerMk2_C', { x: c.x, y: c.y, z: q.at.z - BOX_DROP }, q.yaw + 180, { dryRun: DRY, ignore: ['FGCDInvalidFloor'] });
      report('conteneur ' + name, r);
      if (r.built) { st.conteneurs[name] = r.actor; save(); }
    }
  },
  async raccords() {
    for (const [name, q] of Object.entries(QUAIS)) {
      for (const [out, inp] of [['Output1', 'Input0'], ['Output2', 'Input1']]) {
        const key = name + ' ' + out;
        if (st.raccords[key]) continue;
        if (!st.conteneurs[name]) throw new Error(name + ' : pas de conteneur (phase conteneurs)');
        const r = await call('belt', 'Recipe_ConveyorBeltMk6_C', st.conteneurs[name], out, { path: q, name: inp }, { dryRun: DRY });
        report(key + ' -> ' + inp, r);
        if (r.built) { st.raccords[key] = r.actor; save(); }
      }
    }
  },
  async verifie() {
    const I = await inputs();
    for (const [name, a] of Object.entries(st.conteneurs)) {
      if (!QUAIS[name]) continue; // quai hors de --quais
      const cs = await call('connections', a), qs = await call('connections', QUAIS[name]), q = I[name];
      const outs = cs.filter((k) => /^Output/.test(k.name)).map((o) => {
        const d = { x: o.location.x - q.at.x, y: o.location.y - q.at.y };
        const facing = -(o.normal.x * q.n.x + o.normal.y * q.n.y) > 0.99;
        return o.name + ' a ' + Math.round(d.x * q.n.x + d.y * q.n.y) + ' uu' + (facing ? '' : ' MAL ORIENTEE') + (o.connected ? ' ok' : ' LIBRE');
      });
      console.log(name.padEnd(14), short(a), outs.join(', '), '| quai', qs.filter((k) => /^Input/.test(k.name)).map((k) => k.name + (k.connected ? ' ok' : ' LIBRE')).join(', '));
    }
  },
};
if (!PH[phase]) { console.error('usage : node tampons-quais.js <etat de gare> ' + Object.keys(PH).join('|') + ' [--noms ...] [--dry]'); process.exit(2); }
PH[phase]().catch((e) => { console.error('ECHEC :', e.message); process.exitCode = 1; });
