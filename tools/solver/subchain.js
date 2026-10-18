'use strict';
/**
 * subchain.js
 *
 * Extracts one block of the global LP solution (analyzeSinkPoints.js -> sinkAnalysis_<ts>.json):
 * every recipe, mine and generator the block needs, in proportion to its share of each shared flow.
 *
 *   - Roots: generator or sink variables that define the block (e.g. npp_uranium).
 *   - Upstream: each input of a block variable is demanded from its producers, pro rata of their output.
 *     The share supplied as a byproduct (not the recipe's main product) is free: it does not pull its recipe in.
 *   - Downstream: radioactive outputs (waste and everything made from it) are pushed to their consumers,
 *     which join the block in full; their non-radioactive inputs are then demanded upstream.
 *   - Non-radioactive byproducts of the downstream chain (e.g. water) are netted against the block's demand.
 *
 * Usage: node subchain.js <sinkAnalysis_ts.json> [block=nuclear] [json=<out.json>]
 */

const fs = require('fs');

const ARGS = {};
for (const arg of process.argv.slice(3)) {
	const [k, v] = arg.split('=');
	ARGS[k] = v !== undefined ? v : 'true';
}
const BLOCKS = {
	nuclear: { label: 'Filière nucléaire', roots: ['npp_uranium'] },
};
const block = BLOCKS[ARGS.block || 'nuclear'];
if (!process.argv[2] || !block) {
	console.error('Usage: node subchain.js <sinkAnalysis_ts.json> [block=' + Object.keys(BLOCKS).join('|') + '] [json=<out.json>]');
	process.exit(1);
}

const sol = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const V = sol.variables;
const EPS = 1e-6;
const isRadioactive = (item) => !!(sol.items[item] && sol.items[item].radioactive);
const itemName = (item) => (sol.items[item] && sol.items[item].name) || item.replace(/^Desc_|_C$/g, '');
const flowsOf = (v) => Object.entries(V[v].flows).filter(([f]) => f.startsWith('flow_') && f !== 'flow_PowerUnit').map(([f, c]) => [f.slice(5), c]);

// Producers and consumers of each item in the global solution (amounts per minute)
const producers = {};
const consumers = {};
for (const v in V) {
	for (const [item, c] of flowsOf(v)) {
		const rate = c * V[v].value;
		if (rate > EPS) (producers[item] = producers[item] || []).push({ v, rate, coef: c });
		else if (rate < -EPS) (consumers[item] = consumers[item] || []).push({ v, rate: -rate, coef: -c });
	}
}

// --- Downstream: roots, then every consumer of a radioactive output, in full ---
const x = {};         // attributed activity per variable (machines, generators, mines, sinks)
const role = {};      // 'root' | 'down' | 'up'
const down = [];
for (const r of block.roots) {
	if (!V[r]) throw new Error('variable absente de la solution : ' + r);
	x[r] = V[r].value; role[r] = 'root'; down.push(r);
}
for (let i = 0; i < down.length; i++) {
	for (const [item, c] of flowsOf(down[i])) {
		if (c <= 0 || !isRadioactive(item)) continue;
		for (const cons of consumers[item] || []) {
			if (role[cons.v]) continue;
			x[cons.v] = V[cons.v].value; role[cons.v] = 'down'; down.push(cons.v);
		}
	}
}

// Non-radioactive byproducts of the downstream chain, available to the block itself
const pool = {};
for (const v of down) {
	for (const [item, c] of flowsOf(v)) if (c > 0 && !isRadioactive(item)) pool[item] = (pool[item] || 0) + c * x[v];
}

// --- Upstream: demand inputs from producers outside the downstream chain, pro rata ---
const pending = {};
const byproductSupply = {};  // block demand covered by other recipes' byproducts
const isMainProduct = (v, item) => !v.startsWith('recipe_') || !sol.recipes[v.slice(7)] || !sol.recipes[v.slice(7)].mainProduct || sol.recipes[v.slice(7)].mainProduct === item;
const demandOf = {};  // total demand of the block per item (before pool netting)
const fromPool = {};
function demand(item, amount) {
	demandOf[item] = (demandOf[item] || 0) + amount;
	const usePool = Math.min(pool[item] || 0, amount);
	if (usePool > 0) { pool[item] -= usePool; fromPool[item] = (fromPool[item] || 0) + usePool; amount -= usePool; }
	if (amount > EPS) pending[item] = (pending[item] || 0) + amount;
}
for (const v of down) {
	for (const [item, c] of flowsOf(v)) {
		if (c >= 0) continue;
		// radioactive inputs of the downstream chain come from the chain itself, except the roots' fuel
		if (isRadioactive(item) && role[v] === 'down') continue;
		demand(item, -c * x[v]);
	}
}
let guard = 0;
while (Object.keys(pending).length) {
	if (++guard > 200000) throw new Error('la remontée ne converge pas');
	const item = Object.keys(pending)[0];
	const amount = pending[item];
	delete pending[item];
	const prods = (producers[item] || []).filter((p) => role[p.v] !== 'root' && role[p.v] !== 'down');
	const total = prods.reduce((t, p) => t + p.rate, 0);
	if (total < EPS) continue;
	for (const p of prods) {
		if (!isMainProduct(p.v, item)) {
			byproductSupply[item] = (byproductSupply[item] || 0) + amount * (p.rate / total);
			continue;
		}
		const dx = amount * (p.rate / total) / p.coef;
		x[p.v] = (x[p.v] || 0) + dx;
		if (!role[p.v]) role[p.v] = 'up';
		for (const [inItem, c] of flowsOf(p.v)) if (c < 0) demand(inItem, -c * dx);
	}
}

// --- Report ---
const kind = (v) => v.split('_')[0];
const recipeOf = (v) => sol.recipes[v.slice(7)] || { name: v.slice(7), machine: '' };
const machineName = (m) => String(m).replace(/^Desc_|Mk1_C$|_C$/g, '');
const touchesRadioactive = (v) => flowsOf(v).some(([item]) => isRadioactive(item));
const fmt = (n, d = 1) => (Math.round(n * 10 ** d) / 10 ** d).toLocaleString('fr-FR');

const rows = Object.keys(x).filter((v) => x[v] > 1e-4);
const recipes = rows.filter((v) => kind(v) === 'recipe');
const hub = recipes.filter(touchesRadioactive);
const supply = recipes.filter((v) => !touchesRadioactive(v));
const mines = rows.filter((v) => kind(v) === 'mine');
const gens = rows.filter((v) => kind(v) === 'npp' || kind(v) === 'gen');
const sinks = rows.filter((v) => kind(v) === 'sink');

// Hub deliveries: non-radioactive inputs of the hub recipes and generators, net of the internal pool
const hubSet = new Set([...hub, ...gens]);
const hubIn = {};
for (const v of hubSet) for (const [item, c] of flowsOf(v)) if (c < 0 && !isRadioactive(item)) hubIn[item] = (hubIn[item] || 0) - c * x[v];
for (const v of hubSet) for (const [item, c] of flowsOf(v)) if (c > 0 && !isRadioactive(item) && hubIn[item]) hubIn[item] = Math.max(0, hubIn[item] - c * x[v]);

let powerGen = 0, powerUse = 0;
for (const v of rows) {
	const p = (V[v].flows.flow_PowerUnit || 0) * x[v];
	if (p > 0) powerGen += p; else powerUse -= p;
}
let points = 0;
for (const v of sinks) points += (V[v].flows.sink || 0) * x[v];

const out = [];
const line = (s) => out.push(s);
line('=== ' + block.label + ' (part de la solution globale, ' + fmt(sol.objective / 1e6, 1) + ' M points/min) ===');
line('');
line('Production : ' + gens.map((v) => fmt(x[v], 1) + ' ' + v + ' @100 % = ' + fmt(x[v] / sol.generatorClock, 1) + ' @' + sol.generatorClock * 100 + ' %').join(', '));
line('Électricité : ' + fmt(powerGen / 1000, 1) + ' GW produits, ' + fmt(powerUse / 1000, 1) + ' GW consommés par la filière (machines + extraction) ; net ' + fmt((powerGen - powerUse) / 1000, 1) + ' GW');
line('Points du broyeur : ' + sinks.map((v) => fmt(-(V[v].flows['flow_' + v.slice(5)] || -1) * x[v], 2) + ' ' + itemName(v.slice(5)) + '/min').join(', ') + ' = ' + fmt(points, 0) + ' points/min');
line('');
line('--- Hub : chaîne radioactive (machines à 100 %) ---');
for (const v of hub.sort((a, b) => x[b] - x[a])) line('  ' + fmt(x[v], 2).padStart(8) + ' × ' + machineName(recipeOf(v).machine).padEnd(16) + recipeOf(v).name);
line('');
line('--- Livré au hub (non radioactif, par minute) ---');
for (const [item, q] of Object.entries(hubIn).sort((a, b) => b[1] - a[1])) if (q > 0.01) line('  ' + fmt(q, 1).padStart(10) + '  ' + itemName(item) + (fromPool[item] ? '  (dont ' + fmt(fromPool[item], 0) + ' recyclés dans le hub)' : ''));
line('');
line('--- Chaîne d\'approvisionnement (machines à 100 %, part attribuée) ---');
for (const v of supply.sort((a, b) => x[b] - x[a])) {
	const share = V[v].value > 0 ? x[v] / V[v].value : 0;
	line('  ' + fmt(x[v], 2).padStart(8) + ' × ' + machineName(recipeOf(v).machine).padEnd(16) + recipeOf(v).name + (share < 0.999 ? '  (' + fmt(share * 100, 0) + ' % des ' + fmt(V[v].value, 1) + ' du plan)' : ''));
}
const byp = Object.entries(byproductSupply).filter(([, q]) => q > 0.01);
if (byp.length) {
	line('');
	line('--- Couvert par des sous-produits d\'autres recettes du plan (par minute) ---');
	for (const [item, q] of byp.sort((a, b) => b[1] - a[1])) line('  ' + fmt(q, 1).padStart(10) + '  ' + itemName(item));
}
line('');
line('--- Ressources brutes (par minute) ---');
for (const v of mines.sort((a, b) => x[b] - x[a])) {
	const share = x[v] / V[v].value;
	line('  ' + fmt(x[v], 0).padStart(10) + '  ' + itemName(v.slice(5)).padEnd(14) + fmt(share * 100, 1).padStart(6) + ' % de l\'extraction du plan');
}
console.log(out.join('\n'));

if (ARGS.json) {
	const report = {
		block: ARGS.block || 'nuclear', objective: sol.objective,
		generators: Object.fromEntries(gens.map((v) => [v, x[v]])),
		power: { generatedMW: powerGen, consumedMW: powerUse },
		sinkPoints: points,
		hub: Object.fromEntries(hub.map((v) => [v.slice(7), { name: recipeOf(v).name, machine: recipeOf(v).machine, machines: x[v] }])),
		hubInputs: Object.fromEntries(Object.entries(hubIn).filter(([, q]) => q > 0.01).map(([k, q]) => [k, { name: itemName(k), perMin: q }])),
		supply: Object.fromEntries(supply.map((v) => [v.slice(7), { name: recipeOf(v).name, machine: recipeOf(v).machine, machines: x[v], shareOfPlan: x[v] / V[v].value }])),
		resources: Object.fromEntries(mines.map((v) => [v.slice(5), { name: itemName(v.slice(5)), perMin: x[v], shareOfPlan: x[v] / V[v].value }])),
	};
	fs.writeFileSync(ARGS.json, JSON.stringify(report, null, 1));
	console.log('\nÉcrit : ' + ARGS.json);
}
