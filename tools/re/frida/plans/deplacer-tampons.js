// Deplacement des tampons d'une gare avec la gare (utilisateur, 26/10/2026 : gares du hub avancees de 6 m pour la regle
// « pas de signaux a l'entree et a la sortie des gares, segment minimum de 12m » ; « on s'en fou du contenu, ca vire »).
// La gare et ses quais sont reposes par railplan (layouts/hub-gare.js) ; ce script s'occupe de ce qui est branche sur les
// quais : tampons (conteneurs, cuves des quais fluides), liaisons courtes quai <-> tampon (convoyeurs, tuyaux), et premier
// maillon de chaque ligne au depart ou a l'arrivee d'un tampon. Les conteneurs sont reposes a leur place decalee du vecteur de deplacement, meme cap ; un
// ascenseur fixe directement sur un conteneur deplace est repose depuis ce conteneur (meme colonne decalee, meme
// altitude de l'autre bout, bras de l'autre bout dans la meme direction) ; tout le reste (repartiteurs, fusionneurs,
// ascenseurs non fixes a un conteneur, machines) reste en place, et les convoyeurs sont reposes entre les nouveaux ports.
//
// node deplacer-tampons.js releve <nom> --gares <etat>[,<etat>...] --decalage dx,dy,dz [--suivre <acteur>,...]
//   etat de gare : plans/<etat>-state.json ; --suivre : points fixes trop proches d'un tampon (cf. ecarts) deplaces avec
//   les tampons (regroupeur, pompe...) : leurs liaisons vers l'aval sont reposees comme les autres
// node deplacer-tampons.js demonte <nom> [--dry]      convoyeurs, ascenseurs deplaces, conteneurs (contenu perdu)
//   (puis : rails et signaux, gares et quais par railplan ; les nouveaux quais sont relus dans les memes etats de gare)
// node deplacer-tampons.js repose <nom> [--dry]       conteneurs, ascenseurs, convoyeurs
// node deplacer-tampons.js verifie <nom>
// node deplacer-tampons.js ecarts <nom>        avant demontage : pour chaque convoyeur vers / depuis un point fixe, avance
//                                              (le long de la normale du connecteur du conteneur) et ecart lateral apres
//                                              decalage ; une avance courte avec un grand ecart ne passera pas (cf. plus bas)
// Etat : plans/<nom>-deplacement-state.json
// Cas non traite automatiquement : un point fixe trop proche du conteneur pour absorber le decalage (N266 E126, 26/10/2026 :
// regroupeur a 4,4 m devant la sortie, 6 m de decalage lateral -> FGCDConveyorTooSteep). Le decaler lui aussi, dans le
// sens de sa sortie (demonter sa sortie et lui, le reposer decale, refaire sa sortie puis le convoyeur du conteneur), puis
// noter le nouveau point fixe et le convoyeur dans l'etat (belts.<b>.to.fixed, built.<b>) avant de relancer repose.
// Depuis, --suivre au releve le fait (boxes.<f>.suivi ; boxes.<f>.power = poteau : cable repose). Pompe posee SUR un
// tuyau (N211 O96, 26/10/2026) : reposee seule, le bout de 2 m cuve -> pompe est refuse (FGCDPipeInvalidShape, il gardait
// la courbe du long tuyau d'origine). Faire comme a l'origine : un tuyau cuve -> aval, puis la pompe visee sur ce tuyau
// (buildAim onActor : elle le coupe en deux, sortie vers l'aval), cable, puis noter pompe et moities dans l'etat.
'use strict';
const fs = require('fs');
const path = require('path');
const { call, short } = require('./client');

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf('--' + name); return i < 0 ? def : argv[i + 1]; };
const DRY = argv.includes('--dry');
const [phase, nom] = argv;
const SF = path.join(__dirname, (nom || '') + '-deplacement-state.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const owner = (comp) => comp.slice(0, comp.lastIndexOf('.'));
const portOf = (comp) => comp.slice(comp.lastIndexOf('.') + 1);
const recipeOf = (actor) => 'Recipe_' + short(actor).replace(/^Build_/, '').replace(/_C_\d+$/, '_C');
const r0 = (v) => [v.x, v.y, v.z].map(Math.round).join(';');
const load = () => JSON.parse(fs.readFileSync(SF, 'utf8'));
// Liaisons (convoyeurs, tuyaux) et tampons (conteneurs, cuves) ; bouts d'une liaison dans le sens de pose
const LINK = /ConveyorBelt|Pipeline(MK2)?_C/;
const BUFFER = /StorageContainer|IndustrialTank|PipeStorageTank/;
const ENDS = (link) => (/Pipeline/.test(link) ? ['PipelineConnection0', 'PipelineConnection1'] : ['ConveyorAny0', 'ConveyorAny1']);
const save = (s) => { if (!DRY) fs.writeFileSync(SF, JSON.stringify(s, null, 1)); };

// Raccords d'un acteur : connecteur -> composant relie
async function partners(actor) {
  const out = [];
  for (const p of await call('connections', actor)) {
    if (!p.connected) continue;
    const d = await call('dump', actor + '.' + p.name, 1, 1, ['mConnectedComponent']).catch(() => ({}));
    if (d.mConnectedComponent) out.push({ port: p.name, at: p.location, normal: p.normal, to: d.mConnectedComponent });
  }
  return out;
}

// --- releve : quais -> conteneurs -> premiers maillons ------------------------------------------------------------------
async function releve() {
  const gares = String(opt('gares', '')).split(',').filter(Boolean);
  const [dx, dy, dz] = String(opt('decalage', '0,0,0')).split(',').map(Number);
  if (!gares.length || !(dx || dy || dz)) throw new Error('usage : releve <nom> --gares <etat>[,...] --decalage dx,dy,dz');
  const plan = { gares, decalage: { x: dx, y: dy, z: dz }, quais: {}, boxes: {}, lifts: {}, belts: {}, built: {}, removed: {} };
  const refOf = (actor) => {
    for (const [k, q] of Object.entries(plan.quais)) if (q === actor) return { quai: k };
    for (const [k, b] of Object.entries(plan.boxes)) if (b.old === actor) return { box: k };
    for (const [k, l] of Object.entries(plan.lifts)) if (l.old === actor) return { lift: k };
    return { fixed: actor };
  };
  // quais : cle <etat>#<rang>
  for (const g of gares) {
    const st = JSON.parse(fs.readFileSync(path.join(__dirname, g + '-state.json'), 'utf8'));
    st.platforms.forEach((p, i) => { plan.quais[g + '#' + i] = p; });
  }
  // conteneurs branches sur les quais (par un convoyeur)
  const beltsSeen = new Map(); // belt -> { a0: composant amont, a1: composant aval }
  const noteBelt = async (belt) => {
    if (beltsSeen.has(belt)) return;
    const ps = await partners(belt);
    const [n0, n1] = ENDS(belt);
    const a0 = ps.find((p) => p.port === n0), a1 = ps.find((p) => p.port === n1);
    beltsSeen.set(belt, { a0: a0 ? a0.to : null, a1: a1 ? a1.to : null });
  };
  for (const q of Object.values(plan.quais)) {
    for (const p of await partners(q)) {
      const belt = owner(p.to);
      if (!LINK.test(belt)) throw new Error(short(q) + '.' + p.port + ' : relie a ' + short(belt) + ' (convoyeur ou tuyau attendu)');
      await noteBelt(belt);
      const b = beltsSeen.get(belt);
      const other = [b.a0, b.a1].find((c) => c && owner(c) !== q);
      if (!other || !BUFFER.test(owner(other))) throw new Error(short(belt) + ' : pas de tampon (conteneur, cuve) au bout');
      const box = owner(other);
      if (!Object.values(plan.boxes).some((x) => x.old === box)) {
        const pose = await call('pose', box);
        plan.boxes['c' + (Object.keys(plan.boxes).length + 1)] = { old: box, recipe: recipeOf(box), location: pose.location, yaw: pose.rotation.yaw, pitch: pose.rotation.pitch, roll: pose.rotation.roll };
      }
    }
  }
  // points fixes deplaces avec les tampons
  const P = Object.values(plan.quais)[0].slice(0, Object.values(plan.quais)[0].lastIndexOf('.') + 1);
  for (const f of String(opt('suivre', '')).split(',').filter(Boolean)) {
    const a = f.indexOf('/') >= 0 ? f : P + f;
    const pose = await call('pose', a);
    plan.boxes['f' + (Object.keys(plan.boxes).length + 1)] = { old: a, recipe: recipeOf(a), location: pose.location, yaw: pose.rotation.yaw, pitch: pose.rotation.pitch, roll: pose.rotation.roll, suivi: true };
  }
  // premiers maillons des conteneurs : convoyeur (vers un fixe ou un ascenseur), ou ascenseur fixe sur le conteneur
  for (const [bk, b] of Object.entries(plan.boxes)) {
    for (const p of await partners(b.old)) {
      const link = owner(p.to);
      if (LINK.test(link)) { await noteBelt(link); continue; }
      if (/ConveyorLift/.test(link)) {
        const lc = await call('connections', link);
        // bras du conteneur : le connecteur de l'ascenseur relie a ce conteneur
        const topName = (await partners(link)).find((x) => owner(x.to) === b.old).port;
        const top = lc.find((c) => c.name === topName), foot = lc.find((c) => c.name !== topName);
        const pose = await call('pose', link);
        plan.lifts['l' + (Object.keys(plan.lifts).length + 1)] = { old: link, recipe: recipeOf(link), box: bk, boxPort: p.port, liftPort: top.name,
          column: { x: pose.location.x, y: pose.location.y }, footZ: foot.location.z, footName: foot.name, footNormal: foot.normal };
        for (const fp of await partners(link)) if (owner(fp.to) !== b.old && /ConveyorBelt/.test(owner(fp.to))) await noteBelt(owner(fp.to));
        continue;
      }
      throw new Error(short(b.old) + '.' + p.port + ' : relie a ' + short(link) + ' (convoyeur, tuyau ou ascenseur attendu)');
    }
  }
  let n = 0;
  for (const [belt, e] of beltsSeen) {
    if (!e.a0 || !e.a1) throw new Error(short(belt) + ' : bout libre');
    plan.belts['b' + (++n)] = { old: belt, recipe: recipeOf(belt), from: Object.assign(refOf(owner(e.a0)), { port: portOf(e.a0) }), to: Object.assign(refOf(owner(e.a1)), { port: portOf(e.a1) }) };
  }
  fs.writeFileSync(SF, JSON.stringify(plan, null, 1));
  const label = (r) => (r.quai ? 'quai ' + r.quai : r.box ? 'conteneur ' + r.box : r.lift ? 'ascenseur ' + r.lift : 'fixe ' + short(r.fixed)) + '.' + r.port;
  console.log(Object.keys(plan.quais).length + ' quais, ' + Object.keys(plan.boxes).length + ' conteneurs, ' + Object.keys(plan.lifts).length + ' ascenseurs deplaces, ' + n + ' convoyeurs');
  for (const [k, b] of Object.entries(plan.boxes)) console.log('  ' + k + ' ' + short(b.old) + ' en ' + r0(b.location) + ' cap ' + Math.round(b.yaw));
  for (const [k, l] of Object.entries(plan.lifts)) console.log('  ' + k + ' ' + short(l.old) + ' sur ' + l.box + '.' + l.boxPort + ', pied a ' + Math.round(l.footZ));
  for (const [k, b] of Object.entries(plan.belts)) console.log('  ' + k + ' ' + short(b.old) + ' : ' + label(b.from) + ' -> ' + label(b.to));
}

// --- demonte ------------------------------------------------------------------------------------------------------------
async function demonte() {
  const plan = load();
  const order = [...Object.values(plan.belts).map((b) => b.old), ...Object.values(plan.lifts).map((l) => l.old), ...Object.values(plan.boxes).map((b) => b.old)];
  for (const a of order) {
    if (plan.removed[a]) continue;
    if (DRY) { console.log('demonterait', short(a)); continue; }
    await call('dismantle', a, true);
    plan.removed[a] = true; save(plan);
    console.log('demonte', short(a));
  }
}

// --- repose -------------------------------------------------------------------------------------------------------------
async function repose() {
  const plan = load();
  const D = plan.decalage;
  // nouveaux quais : meme rang dans les etats de gare relus
  const quais = {};
  for (const g of plan.gares) JSON.parse(fs.readFileSync(path.join(__dirname, g + '-state.json'), 'utf8')).platforms.forEach((p, i) => { quais[g + '#' + i] = p; });
  const resolve = (r) => (r.quai ? quais[r.quai] : r.box ? plan.built[r.box] : r.lift ? plan.built[r.lift] : r.fixed);
  for (const [k, b] of Object.entries(plan.boxes)) {
    if (plan.built[k]) continue;
    const at = { x: b.location.x + D.x, y: b.location.y + D.y, z: b.location.z + D.z };
    const r = await call('build', b.recipe, at, b.yaw, { dryRun: DRY, ignore: ['FGCDInvalidFloor'], pitch: b.pitch || 0, roll: b.roll || 0 });
    console.log('conteneur ' + k, r.built ? short(r.actor) : DRY ? 'essai ' + JSON.stringify(r.blocking) : 'NON construit ' + JSON.stringify(r.blocking));
    if (!DRY && !r.built) throw new Error('conteneur ' + k + ' refuse');
    if (r.built) { plan.built[k] = r.actor; save(plan); }
  }
  // courant d'un point suivi alimente (pompe) : boxes.<k>.power = poteau, cable repose apres coup
  for (const [k, b] of Object.entries(plan.boxes)) {
    if (!b.power || !plan.built[k] || plan.built[k + ' cable'] || DRY) continue;
    const w = await call('wire', b.power, plan.built[k], {});
    console.log('cable ' + k, w.built ? short(w.actor) : 'NON pose ' + JSON.stringify(w.blocking));
    if (!w.built) throw new Error('cable ' + k + ' refuse');
    plan.built[k + ' cable'] = w.actor; save(plan);
  }
  for (const [k, l] of Object.entries(plan.lifts)) {
    if (plan.built[k] || DRY) continue;
    // ascenseur pose depuis le conteneur ; bras du pied dans la meme direction qu'avant (quatre caps essayes)
    let ok = null;
    for (const scroll of [0, 90, 180, 270]) {
      const col = { x: l.column.x + D.x, y: l.column.y + D.y, z: l.footZ + D.z };
      const r = await call('belt', l.recipe, plan.built[l.box], l.boxPort, col, { endZ: l.footZ + D.z, snapTolerance: 400, endScroll: scroll });
      if (!r.built) { console.log('ascenseur ' + k + ' cap ' + scroll + ' refuse ' + JSON.stringify(r.blocking)); continue; }
      const foot = (await call('connections', r.actor)).find((c) => !c.connected);
      const good = foot && foot.normal.x * l.footNormal.x + foot.normal.y * l.footNormal.y > 0.9 && Math.abs(foot.location.z - (l.footZ + D.z)) < 50
        && Math.hypot(foot.location.x - (l.column.x + D.x), foot.location.y - (l.column.y + D.y)) < 100;
      if (good) { ok = r.actor; break; }
      console.log('ascenseur ' + k + ' cap ' + scroll + ' : pied ' + (foot ? r0(foot.location) : '?') + ', bras mal place, demonte');
      await call('dismantle', r.actor, true);
      await sleep(1500);
    }
    if (!ok) throw new Error('ascenseur ' + k + ' : aucun cap ne donne le meme pied');
    plan.built[k] = ok; save(plan);
    console.log('ascenseur ' + k, short(ok));
  }
  for (const [k, b] of Object.entries(plan.belts)) {
    if (plan.built[k]) continue;
    const from = resolve(b.from), to = resolve(b.to);
    if (!from || !to) { console.log('convoyeur ' + k + ' : bout pas encore pose (essai)'); continue; }
    const r = await call('belt', b.recipe, from, b.from.port, { path: to, name: b.to.port }, { dryRun: DRY });
    const snappedOk = r.snapped && r.snapped.every((s) => s !== null);
    console.log('convoyeur ' + k, r.built ? short(r.actor) + (snappedOk ? '' : ' BOUT NON ACCROCHE ' + JSON.stringify(r.snapped)) : DRY ? 'essai ' + JSON.stringify(r.blocking) : 'NON construit ' + JSON.stringify(r.blocking));
    if (!DRY && !r.built) throw new Error('convoyeur ' + k + ' refuse');
    if (r.built) { plan.built[k] = r.actor; save(plan); }
  }
}

// --- verifie : chaque convoyeur repose relie ses deux bouts voulus ------------------------------------------------------
async function verifie() {
  const plan = load();
  let bad = 0;
  const quais = {};
  for (const g of plan.gares) JSON.parse(fs.readFileSync(path.join(__dirname, g + '-state.json'), 'utf8')).platforms.forEach((p, i) => { quais[g + '#' + i] = p; });
  const resolve = (r) => (r.quai ? quais[r.quai] : r.box ? plan.built[r.box] : r.lift ? plan.built[r.lift] : r.fixed);
  for (const [k, b] of Object.entries(plan.belts)) {
    const ps = plan.built[k] ? await partners(plan.built[k]) : [];
    const want0 = resolve(b.from) + '.' + b.from.port, want1 = resolve(b.to) + '.' + b.to.port;
    const [n0, n1] = ENDS(b.old);
    const ok0 = ps.some((p) => p.port === n0 && p.to === want0), ok1 = ps.some((p) => p.port === n1 && p.to === want1);
    if (!ok0 || !ok1) bad++;
    console.log('convoyeur ' + k.padEnd(4), plan.built[k] ? short(plan.built[k]) : 'ABSENT', ok0 ? 'depart ok' : 'DEPART NON RELIE', ok1 ? 'arrivee ok' : 'ARRIVEE NON RELIEE');
  }
  for (const [k, l] of Object.entries(plan.lifts)) {
    const ps = plan.built[k] ? await partners(plan.built[k]) : [];
    console.log('ascenseur ' + k, plan.built[k] ? short(plan.built[k]) : 'ABSENT', ps.length + '/2 bouts relies');
    if (ps.length !== 2) bad++;
  }
  console.log(bad ? bad + ' raccord(s) manquant(s)' : 'tous les raccords sont faits');
}

// --- ecarts : geometrie des convoyeurs vers les points fixes, apres decalage des conteneurs ------------------------------
async function ecarts() {
  const plan = load();
  const D = plan.decalage;
  for (const [k, b] of Object.entries(plan.belts)) {
    const boxEnd = b.from.box ? b.from : b.to.box ? b.to : null, fixEnd = b.from.fixed ? b.from : b.to.fixed ? b.to : null;
    if (!boxEnd || !fixEnd) continue;
    const c = (await call('connections', plan.boxes[boxEnd.box].old)).find((x) => x.name === boxEnd.port);
    const f = (await call('connections', fixEnd.fixed)).find((x) => x.name === fixEnd.port);
    const n = c.normal, at = { x: c.location.x + D.x, y: c.location.y + D.y };
    const dx = f.location.x - at.x, dy = f.location.y - at.y;
    const ahead = dx * n.x + dy * n.y, side = Math.abs(dx * -n.y + dy * n.x);
    const facing = f.normal.x * dx + f.normal.y * dy; // > 0 : le connecteur fixe regarde a l'oppose du conteneur
    console.log(k.padEnd(4), short(fixEnd.fixed).replace(/_C_(\d+)$/, ' $1').padEnd(40), fixEnd.port.padEnd(8),
      'avance', (ahead / 100).toFixed(1).padStart(6), 'm, ecart lateral', (side / 100).toFixed(1).padStart(6), 'm, hauteur', ((f.location.z - c.location.z) / 100).toFixed(1).padStart(5), 'm',
      facing > 0 ? '| entree tournee a l\'oppose' : '');
  }
}

const PH = { releve, demonte, repose, verifie, ecarts };
if (!PH[phase] || !nom) { console.error('usage : node deplacer-tampons.js releve|demonte|repose|verifie <nom> [...]'); process.exit(2); }
PH[phase]().catch((e) => { console.error('ECHEC :', e.message); process.exitCode = 1; });
