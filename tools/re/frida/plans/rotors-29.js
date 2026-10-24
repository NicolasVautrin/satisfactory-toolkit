// Rotors vers le quai 4 de la gare 29 (couple 29 -> 42, utilisateur 23/10/2026 : « occupe toi des rotors ») : les deux
// lignes de rotors (fusionneurs A 2144050259 et B 2144049333, a 17,5 m) quittent le quai de chargement 95 201 de la gare 33,
// A se jette dans B, puis une ligne de relais en l'air (fusionneurs, cap 0, tous les ~38 m) a 17,5 m le long de
// y -268 400 jusqu'a un ascenseur qui monte a l'entree haute (Input1, 33,4 m) du tampon du quai 4 de la 29.
// Pose depuis le haut (un ascenseur montant accroche au bout d'un convoyeur se pose a l'envers) : ascenseur depuis
// l'entree du tampon, puis relais d'est en ouest, convoyeurs de l'aval vers l'amont.
//   node rotors-29.js est [--dry]    ascenseur, relais R6 R5 R4 et leurs convoyeurs (joueur au-dessus du quai 4 de la 29)
//   node rotors-29.js ouest [--dry]  bascule des lignes A et B, relais R3 R2 R1 (joueur pres des fusionneurs, x ~95 000)
//   node rotors-29.js verifie
// Etat : plans/rotors-29-state.json
'use strict';
const fs = require('fs');
const path = require('path');
const { call, short } = require('./client');

const DRY = process.argv.includes('--dry');
const P = '/Game/FactoryGame/Map/GameLevel01/Persistent_Level.Persistent_Level:PersistentLevel.';
const A = P + 'Build_ConveyorAttachmentMerger_C_2144050259', B = P + 'Build_ConveyorAttachmentMerger_C_2144049333';
const OLD = { A: P + 'Build_ConveyorBeltMk6_C_2144049682', B: P + 'Build_ConveyorBeltMk6_C_2144048673' }; // vers le quai 95 201
const BOX = JSON.parse(fs.readFileSync(path.join(__dirname, 'hub1-est1-tampons-state.json'), 'utf8')).conteneurs['q4-rotors'];
// Relais a y -268 400 : a y -269 200, la ligne touchait les colonnes d'eau des modules de stators (pompes a x 103 300 et
// 110 800, sondees le 23/10/2026 avec la collision du jeu ; y -268 400 libre de x 93 800 a 116 400). R6, au-dessus du pied
// de l'ascenseur, reste a y -269 200.
const Z = 1749;
const RELAYS = { R1: [97500, -268400], R2: [101300, -268400], R3: [105100, -268400], R4: [108900, -268400], R5: [112700, -268400], R6: [116500, -269200] };
const REC = { merger: 'Recipe_ConveyorAttachmentMerger_C', belt: 'Recipe_ConveyorBeltMk6_C', lift: 'Recipe_ConveyorLiftMk6_C' };
const AIR = { ignore: ['FGCDInvalidFloor'] };
const SF = path.join(__dirname, 'rotors-29-state.json');
const st = fs.existsSync(SF) ? JSON.parse(fs.readFileSync(SF, 'utf8')) : { actors: {}, links: {} };
const save = () => { if (!DRY) fs.writeFileSync(SF, JSON.stringify(st, null, 1)); };
const r0 = (p) => `(${Math.round(p.x)} ; ${Math.round(p.y)} ; ${(p.z / 100).toFixed(1)} m)`;

function report(key, r) {
  console.log(key.padEnd(24), r.built ? 'construit ' + short(r.actor) : DRY ? 'essai' : 'NON construit',
    r.blocking && r.blocking.length ? 'BLOQUANT ' + JSON.stringify(r.blocking) : '');
  if (!DRY && !r.built) throw new Error(key + ' : non construit');
}
async function relay(key) {
  if (st.actors[key]) return st.actors[key];
  const r = await call('build', REC.merger, { x: RELAYS[key][0], y: RELAYS[key][1], z: Z }, 0, Object.assign({ dryRun: DRY }, AIR));
  report(key, r);
  if (r.built) { st.actors[key] = r.actor; save(); }
  return st.actors[key];
}
async function link(key, from, fromName, to, toName) {
  if (st.links[key]) return;
  if (!from || !to) { console.log(key.padEnd(24), 'saute (bout absent, essai)'); return; }
  const r = await call('belt', REC.belt, from, fromName, { path: to, name: toName }, { dryRun: DRY });
  report(key, r);
  if (r.built) {
    if (!r.snapped || r.snapped.some((s) => s === null)) throw new Error(key + ' : bout non accroche ' + JSON.stringify(r.snapped));
    st.links[key] = r.actor; save();
  }
}

const PH = {
  async est() {
    // ascenseur : depuis l'entree haute du tampon jusqu'a 17,5 m, bras du bas vers l'ouest (cote des relais)
    if (!st.actors.lift) {
      const input = (await call('connections', BOX)).find((c) => c.name === 'Input1');
      const scroll = Number((process.argv.find((a) => a.startsWith('--scroll=')) || '--scroll=90').split('=')[1]);
      const r = await call('belt', REC.lift, BOX, 'Input1', { x: input.location.x, y: input.location.y - 300, z: Z },
        { endZ: Z, snapTolerance: 400, endScroll: scroll, dryRun: DRY });
      report('ascenseur', r);
      if (r.hologram) console.log('   hologramme', r0(r.hologram.location), 'cap', Math.round(r.hologram.rotation.yaw));
      if (r.built) {
        st.actors.lift = r.actor; save();
        for (const c of await call('connections', r.actor)) console.log('  ', c.name, r0(c.location), 'normale', JSON.stringify(c.normal, (k, v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v)), c.connected ? 'raccorde' : 'LIBRE');
      }
      if (DRY) return;
      const foot = (await call('connections', st.actors.lift)).find((c) => !c.connected);
      if (!foot || foot.normal.x > -0.9) throw new Error('bras du bas de l\'ascenseur pas tourne vers l\'ouest : ' + JSON.stringify(foot && foot.normal) + ' (demonter et reprendre avec --scroll=270)');
    }
    for (const k of ['R6', 'R5', 'R4']) await relay(k);
    if (DRY) return;
    const foot = (await call('connections', st.actors.lift)).find((c) => !c.connected && /ConveyorAny/.test(c.name));
    if (foot) await link('R6 > ascenseur', st.actors.R6, 'Output1', st.actors.lift, foot.name);
    await link('R5 > R6', st.actors.R5, 'Output1', st.actors.R6, 'Input1');
    await link('R4 > R5', st.actors.R4, 'Output1', st.actors.R5, 'Input1');
  },
  async ouest() {
    for (const k of ['R3', 'R2', 'R1']) await relay(k);
    if (DRY) return;
    await link('R3 > R4', st.actors.R3, 'Output1', st.actors.R4, 'Input1');
    await link('R2 > R3', st.actors.R2, 'Output1', st.actors.R3, 'Input1');
    await link('R1 > R2', st.actors.R1, 'Output1', st.actors.R2, 'Input1');
    // bascule : les convoyeurs vers le quai de la 33 sont demontes, A se jette dans B, B part vers R1
    for (const [k, b] of Object.entries(OLD)) {
      if (st.links['demonte ' + k]) continue;
      console.log('demontage', k, JSON.stringify(await call('dismantle', b, true)).slice(0, 120));
      st.links['demonte ' + k] = true; save();
    }
    await new Promise((r) => setTimeout(r, 2000)); // apres un demontage, attendre avant de raccorder le connecteur libere
    await link('B > R1', B, 'Output1', st.actors.R1, 'Input1');
    await link('A > B', A, 'Output1', B, 'Input1');
  },
  async verifie() {
    for (const [k, a] of Object.entries(Object.assign({ A, B }, st.actors))) {
      console.log(k.padEnd(6), short(a), (await call('connections', a)).filter((c) => /Input|Output|ConveyorAny/.test(c.name)).map((c) => c.name + (c.connected ? '+' : '-')).join(' '));
    }
  },
};
if (!PH[process.argv[2]]) { console.error('usage : node rotors-29.js est|ouest|verifie [--dry]'); process.exit(2); }
PH[process.argv[2]]().catch((e) => { console.error('ECHEC :', e.message); process.exitCode = 1; });
