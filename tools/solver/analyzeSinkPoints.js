const https = require('https');

const SOLVER_URL = 'https://api.satisfactorytools.com/v2/solver';

const RESOURCE_MAX = {
	Desc_OreIron_C: 92100,
	Desc_OreCopper_C: 36900,
	Desc_Stone_C: 69900,
	Desc_Coal_C: 42300,
	Desc_OreGold_C: 15000,
	Desc_LiquidOil_C: 12600,
	Desc_RawQuartz_C: 13500,
	Desc_Sulfur_C: 10800,
	Desc_OreBauxite_C: 12300,
	Desc_OreUranium_C: 2100,
	Desc_NitrogenGas_C: 12000,
	Desc_SAM_C: 10200,
	Desc_Water_C: 9999999,
};

// SAM resource conversion recipes to block (Converter: SAM Ingot + ore -> other ore)
const BLOCKED_CONVERSION_RECIPES = [
	'Recipe_Bauxite_Caterium_C',
	'Recipe_Bauxite_Copper_C',
	'Recipe_Caterium_Copper_C',
	'Recipe_Caterium_Quartz_C',
	'Recipe_Coal_Iron_C',
	'Recipe_Coal_Limestone_C',
	'Recipe_Copper_Quartz_C',
	'Recipe_Copper_Sulfur_C',
	'Recipe_Iron_Limestone_C',
	'Recipe_Limestone_Sulfur_C',
	'Recipe_Nitrogen_Bauxite_C',
	'Recipe_Nitrogen_Caterium_C',
	'Recipe_Quartz_Bauxite_C',
	'Recipe_Quartz_Coal_C',
	'Recipe_Sulfur_Coal_C',
	'Recipe_Sulfur_Iron_C',
	'Recipe_Uranium_Bauxite_C',
	'Recipe_DarkEnergy_C',
];

const RESOURCE_WEIGHT = {
	Desc_OreIron_C: 1,
	Desc_OreCopper_C: 2.496,
	Desc_Stone_C: 1.318,
	Desc_Coal_C: 2.177,
	Desc_OreGold_C: 6.14,
	Desc_LiquidOil_C: 7.31,
	Desc_RawQuartz_C: 6.822,
	Desc_Sulfur_C: 8.528,
	Desc_OreBauxite_C: 7.488,
	Desc_OreUranium_C: 43.857,
	Desc_NitrogenGas_C: 7.675,
	Desc_SAM_C: 9.029,
	Desc_Water_C: 0,
	Desc_Wood_C: 0,
};

// High-tier solid craftable items (no liquids, no equipment-only)
const HIGH_ITEMS = [
	{ className: 'Desc_SpaceElevatorPart_11_C', name: 'Ballistic Warp Drive', sinkPoints: 2895334 },
	{ className: 'Desc_SpaceElevatorPart_8_C', name: 'Thermal Propulsion Rocket', sinkPoints: 728508 },
	{ className: 'Desc_SpaceElevatorPart_12_C', name: 'AI Expansion Server', sinkPoints: 597652 },
	{ className: 'Desc_SpaceElevatorPart_9_C', name: 'Nuclear Pasta', sinkPoints: 538976 },
	{ className: 'Desc_SpaceElevatorPart_7_C', name: 'Assembly Director System', sinkPoints: 500176 },
	{ className: 'Desc_SpaceElevatorPart_10_C', name: 'Biochemical Sculptor', sinkPoints: 301778 },
	{ className: 'Desc_PressureConversionCube_C', name: 'Pressure Conversion Cube', sinkPoints: 255088 },
	{ className: 'Desc_TemporalProcessor_C', name: 'Neural-Quantum Processor', sinkPoints: 248034 },
	{ className: 'Desc_MotorLightweight_C', name: 'Turbo Motor', sinkPoints: 240496 },
	{ className: 'Desc_PlutoniumFuelRod_C', name: 'Plutonium Fuel Rod', sinkPoints: 153184 },
	{ className: 'Desc_SingularityCell_C', name: 'Singularity Cell', sinkPoints: 114675 },
	{ className: 'Desc_ComputerSuper_C', name: 'Supercomputer', sinkPoints: 97352 },
	{ className: 'Desc_SpaceElevatorPart_5_C', name: 'Adaptive Control Unit', sinkPoints: 76368 },
	{ className: 'Desc_ModularFrameFused_C', name: 'Fused Modular Frame', sinkPoints: 62840 },
	{ className: 'Desc_NuclearFuelRod_C', name: 'Uranium Fuel Rod', sinkPoints: 43468 },
	{ className: 'Desc_QuantumOscillator_C', name: 'Superposition Oscillator', sinkPoints: 37292 },
	{ className: 'Desc_ModularFrameLightweight_C', name: 'Radio Control Unit', sinkPoints: 32352 },
	{ className: 'Desc_CoolingSystem_C', name: 'Cooling System', sinkPoints: 12006 },
	{ className: 'Desc_SpaceElevatorPart_6_C', name: 'Magnetic Field Generator', sinkPoints: 11000 },
	{ className: 'Desc_ModularFrameHeavy_C', name: 'Heavy Modular Frame', sinkPoints: 10800 },
	{ className: 'Desc_SpaceElevatorPart_4_C', name: 'Modular Engine', sinkPoints: 9960 },
	{ className: 'Desc_Computer_C', name: 'Computer', sinkPoints: 8352 },
	{ className: 'Desc_HighSpeedConnector_C', name: 'High-Speed Connector', sinkPoints: 3776 },
	{ className: 'Desc_CrystalOscillator_C', name: 'Crystal Oscillator', sinkPoints: 3072 },
	{ className: 'Desc_AluminumPlateReinforced_C', name: 'Heat Sink', sinkPoints: 2804 },
	{ className: 'Desc_ElectromagneticControlRod_C', name: 'EM Control Rod', sinkPoints: 2560 },
	{ className: 'Desc_FicsiteIngot_C', name: 'Ficsite Ingot', sinkPoints: 1936 },
	{ className: 'Desc_DarkMatter_C', name: 'Dark Matter Crystal', sinkPoints: 1780 },
	{ className: 'Desc_Motor_C', name: 'Motor', sinkPoints: 1520 },
	{ className: 'Desc_SpaceElevatorPart_3_C', name: 'Automated Wiring', sinkPoints: 1440 },
	{ className: 'Desc_FicsiteMesh_C', name: 'Ficsite Trigon', sinkPoints: 1291 },
	{ className: 'Desc_SpaceElevatorPart_2_C', name: 'Versatile Framework', sinkPoints: 1176 },
];

function solveRequest(request) {
	return new Promise((resolve, reject) => {
		const data = JSON.stringify(request);
		const url = new URL(SOLVER_URL);

		const options = {
			hostname: url.hostname,
			path: url.pathname,
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Content-Length': Buffer.byteLength(data),
			},
		};

		const req = https.request(options, (res) => {
			let body = '';
			res.on('data', (chunk) => { body += chunk; });
			res.on('end', () => {
				try {
					const parsed = JSON.parse(body);
					resolve(parsed.result || {});
				} catch (e) {
					resolve({});
				}
			});
		});

		req.on('error', (e) => {
			console.error('Solver error: ' + e.message);
			resolve({});
		});

		req.write(data);
		req.end();
	});
}

function solveItem(item, allAlternateRecipes) {
	return solveRequest({
		gameVersion: '1.0.0',
		resourceMax: RESOURCE_MAX,
		resourceWeight: RESOURCE_WEIGHT,
		blockedResources: [],
		blockedRecipes: BLOCKED_CONVERSION_RECIPES,
		allowedAlternateRecipes: allAlternateRecipes,
		sinkableResources: [],
		production: [{
			item: item.className,
			type: 'perMinute',
			amount: 1,
			ratio: 100,
		}],
		input: [
			{ item: 'Desc_NuclearWaste_C', amount: 2000 },
			{ item: 'Desc_PlutoniumWaste_C', amount: 2000 },
		],
	});
}

// Machine power consumption (MW at 100%)
const MACHINE_POWER = {
	'Desc_ConstructorMk1_C': 4,
	'Desc_SmelterMk1_C': 4,
	'Desc_FoundryMk1_C': 16,
	'Desc_AssemblerMk1_C': 15,
	'Desc_ManufacturerMk1_C': 55,
	'Desc_OilRefinery_C': 30,
	'Desc_Blender_C': 75,
	'Desc_Packager_C': 10,
	'Desc_HadronCollider_C': 500,   // variable: use avg per recipe instead
	'Desc_QuantumEncoder_C': 500,   // variable: use avg per recipe instead
	'Desc_Converter_C': 250,        // variable: avg(100,400)
};

// Resource node data: number of miners needed and their power cost
// Loaded from data/resourceConfig.json
const resourceNodes = require('../data/resourceConfig.json');

// Compute total miners and total MW per resource at 250% overclock
// Miner Mk3 at 250%: impure=300/min, normal=600/min, pure=600/min (belt-capped at 780 but we use 600 for pure to match wiki totals)
// Actually: rate = baseRate * purityMult * (overclock/100), belt cap 780
// At 250%: impure=240*0.5*2.5=300, normal=240*1*2.5=600, pure=min(240*2*2.5, 780)=780
// But total extraction rates from wiki already account for this, so:
// miners per resource = sum of nodes (each node = 1 miner)
const MINING_POWER_TOTAL = {};
for (const resClass in resourceNodes.nodes) {
	const node = resourceNodes.nodes[resClass];
	const minerInfo = resourceNodes.miners[node.miner];
	if (!minerInfo) continue;
	const totalMiners = node.total > 0 ? node.total : 0;
	const totalPowerMW = totalMiners * minerInfo.power;
	// PowerUnit cost per unit/min extracted
	if (node.maxRate > 0 && node.maxRate < 9999999) {
		MINING_POWER_TOTAL[resClass] = { miners: totalMiners, power: totalPowerMW, perUnit: totalPowerMW / node.maxRate };
	}
}
// Water: unlimited nodes, cost = 20MW per 120 m³/min = 0.1667 MW per m³/min
MINING_POWER_TOTAL['Desc_Water_C'] = { miners: 0, power: 0, perUnit: 20 / 120 };

// Power modeled as virtual item "PowerUnit"
// Recipes/mines consume PowerUnit proportional to their MW
// A NPP conversion recipe: NuclearFuelRod -> PowerUnit + NuclearWaste
// 1 NPP = 2500 MW = 2500 PowerUnit, consumes 0.2 rods/min, produces 10 waste/min
// Per PowerUnit: 0.2/2500 = 0.00008 rods, 10/2500 = 0.004 waste
const MW_TO_RODS = 0.2 / 2500;   // 0.00008
const MW_TO_WASTE = 10 / 2500;   // 0.004

function analyzeResult(item, result, recipeData) {
	const resources = {};
	let recipeCount = 0;
	let totalPowerMW = 0;

	for (const key in result) {
		const amount = result[key];
		if (key.indexOf('#Mine') !== -1) {
			const resourceClass = key.split('#')[0];
			resources[resourceClass] = amount;
		} else if (key.indexOf('#Input') !== -1) {
			const itemClass = key.split('#')[0];
			resources[itemClass] = Number(amount) || 0;
		} else if (key.indexOf('#Byproduct') !== -1 || key.indexOf('#Sink') !== -1) {
			// Skip byproduct/sink entries
		} else if (key.indexOf('#') !== -1 && key.indexOf('#Mine') === -1) {
			// Recipe key: "RecipeClassName@clock#MachineClassName" -> amount = machine count
			recipeCount++;
			const parts = key.split('#');
			const machineClass = parts[1];
			const machineCount = amount;
			if (MACHINE_POWER[machineClass]) {
				totalPowerMW += MACHINE_POWER[machineClass] * machineCount;
			}
		}
	}

	// Calculate total raw resource "weight"
	const SINK_BASE = {
		Desc_OreIron_C: 1,
		Desc_OreCopper_C: 3,
		Desc_Stone_C: 2,
		Desc_Coal_C: 3,
		Desc_OreGold_C: 7,
		Desc_LiquidOil_C: 30,
		Desc_RawQuartz_C: 15,
		Desc_Sulfur_C: 11,
		Desc_OreBauxite_C: 8,
		Desc_OreUranium_C: 35,
		Desc_NitrogenGas_C: 10,
		Desc_SAM_C: 20,
		Desc_Water_C: 0,
		Desc_Wood_C: 0,
	};

	let totalRawCost = 0;
	for (const k in resources) {
		if (SINK_BASE[k]) {
			totalRawCost += resources[k] * SINK_BASE[k];
		}
	}

	return {
		name: item.name,
		sinkPoints: item.sinkPoints,
		recipeSteps: recipeCount,
		resources: resources,
		totalRawCost: totalRawCost,
		powerMW: Math.round(totalPowerMW * 100) / 100,
	};
}

async function main() {
	const gameData = require('../data/gameData.json');

	// Collect all alternate recipe classNames (except blocked conversion recipes)
	const allAlternateRecipes = Object.values(gameData.recipes)
		.filter(r => r.alternate && !BLOCKED_CONVERSION_RECIPES.includes(r.className))
		.map(r => r.className);

	process.stderr.write('Enabled ' + allAlternateRecipes.length + ' alternate recipes\n');

	const results = [];

	for (let i = 0; i < HIGH_ITEMS.length; i++) {
		const item = HIGH_ITEMS[i];
		process.stderr.write('Solving ' + (i + 1) + '/' + HIGH_ITEMS.length + ': ' + item.name + '...\n');

		const result = await solveItem(item, allAlternateRecipes);
		const analysis = analyzeResult(item, result, gameData.recipes);
		results.push(analysis);

		// Small delay to not hammer the API
		await new Promise(r => setTimeout(r, 500));
	}

	// Resource names mapping
	const RES_NAMES = {
		Desc_OreIron_C: 'Iron',
		Desc_OreCopper_C: 'Copper',
		Desc_Stone_C: 'Limestone',
		Desc_Coal_C: 'Coal',
		Desc_OreGold_C: 'Caterium',
		Desc_LiquidOil_C: 'Oil',
		Desc_RawQuartz_C: 'Quartz',
		Desc_Sulfur_C: 'Sulfur',
		Desc_OreBauxite_C: 'Bauxite',
		Desc_OreUranium_C: 'Uranium',
		Desc_NitrogenGas_C: 'Nitrogen',
		Desc_SAM_C: 'SAM',
		Desc_Water_C: 'Water',
		Desc_Wood_C: 'Wood',
		Desc_NuclearWaste_C: 'U Waste',
		Desc_PlutoniumWaste_C: 'Pu Waste',
	};
	const resKeys = Object.keys(RES_NAMES);

	// === Nuclear chain calculation ===
	const uraniumRod = results.find(r => r.name === 'Uranium Fuel Rod');
	const plutoniumRod = results.find(r => r.name === 'Plutonium Fuel Rod');

	const uraniumPerRod = Number(uraniumRod.resources['Desc_OreUranium_C']) || 0;
	const uraniumRodsPerMin = uraniumPerRod > 0 ? 2100 / uraniumPerRod : 0;
	const uraniumWastePerMin = uraniumRodsPerMin * 50;
	const wastePerPuRod = Number(plutoniumRod.resources['Desc_NuclearWaste_C']) || 0;
	const puRodsPerMin = wastePerPuRod > 0 ? uraniumWastePerMin / wastePerPuRod : 0;

	process.stderr.write('\n=== NUCLEAR CHAIN ===\n');
	process.stderr.write('Uranium Rods: ' + uraniumRodsPerMin.toFixed(2) + '/min\n');
	process.stderr.write('Plutonium Rods: ' + puRodsPerMin.toFixed(2) + '/min\n');
	process.stderr.write('Sink points (Pu rods): ' + Math.round(puRodsPerMin * 153184) + '/min\n');

	// Nuclear chain total resources per resource key
	const nuclearTotal = {};
	const remaining = {};
	for (const k of resKeys) {
		const uVal = Number(uraniumRod.resources[k]) || 0;
		const pVal = Number(plutoniumRod.resources[k]) || 0;
		nuclearTotal[k] = uVal * uraniumRodsPerMin + pVal * puRodsPerMin;
		const max = RESOURCE_MAX[k];
		remaining[k] = (max && max < Number.MAX_SAFE_INTEGER) ? max - nuclearTotal[k] : null;
	}

	// === Write XLSX ===
	const ExcelJS = require('exceljs');
	const workbook = new ExcelJS.Workbook();

	// Helper: add header row with style
	function addHeaderRow(sheet, values) {
		const row = sheet.addRow(values);
		row.font = { bold: true };
		row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
		return row;
	}

	// --- Sheet 1: Items (1/min) ---
	const ws1 = workbook.addWorksheet('Items (1 per min)');
	const headers1 = ['Item', 'Sink Points', 'Recipes', 'Raw Cost', 'Multiplier', 'Power (MW)']
		.concat(resKeys.map(k => RES_NAMES[k]));
	addHeaderRow(ws1, headers1);

	for (const r of results) {
		const row = [
			r.name,
			r.sinkPoints,
			r.recipeSteps,
			Math.round(r.totalRawCost),
			r.totalRawCost > 0 ? Math.round((r.sinkPoints / r.totalRawCost) * 10) / 10 : null,
			r.powerMW,
		];
		for (const k of resKeys) {
			const val = Number(r.resources[k]) || 0;
			row.push(val > 0.001 ? Math.round(val * 100) / 100 : null);
		}
		ws1.addRow(row);
	}
	// Auto-width columns
	ws1.columns.forEach(col => {
		col.width = Math.max(12, (col.header || '').length + 2);
	});
	ws1.getColumn(1).width = 30;

	// --- Sheet 2: Nuclear Chain ---
	const ws2 = workbook.addWorksheet('Nuclear Chain');

	// Parameters
	addHeaderRow(ws2, ['Parameter', 'Value']);
	ws2.addRow(['Uranium on map (/min)', 2100]);
	ws2.addRow(['NPP count', 100]);
	ws2.addRow(['NPP clock speed', '250%']);
	ws2.addRow(['Uranium per rod (/min)', uraniumPerRod]);
	ws2.addRow(['Uranium Rods (/min)', Math.round(uraniumRodsPerMin * 100) / 100]);
	ws2.addRow(['Waste per rod', 50]);
	ws2.addRow(['Uranium Waste (/min)', Math.round(uraniumWastePerMin * 100) / 100]);
	ws2.addRow(['U Waste per Pu Rod (/min)', Math.round(wastePerPuRod * 100) / 100]);
	ws2.addRow(['Plutonium Rods (/min)', Math.round(puRodsPerMin * 100) / 100]);
	ws2.addRow(['Pu Rod sink points', 153184]);
	ws2.addRow(['Total sink points (/min)', Math.round(puRodsPerMin * 153184)]);
	ws2.addRow(['NPP Power (uranium)', Math.round(100 * 2500 * 2.5) + ' MW']);
	ws2.addRow([]);

	// Resource usage table
	const nucHeaders = ['Resource', 'Map Max', 'Uranium Rods', 'Plutonium Rods', 'Nuclear Total', 'Remaining'];
	addHeaderRow(ws2, nucHeaders);
	for (const k of resKeys) {
		const max = RESOURCE_MAX[k];
		if (!max || max >= Number.MAX_SAFE_INTEGER) {
			if (k === 'Desc_Water_C') {
				const uW = (Number(uraniumRod.resources[k]) || 0) * uraniumRodsPerMin;
				const pW = (Number(plutoniumRod.resources[k]) || 0) * puRodsPerMin;
				ws2.addRow([RES_NAMES[k], '∞', Math.round(uW), Math.round(pW), Math.round(uW + pW), '∞']);
			}
			continue;
		}
		const uVal = (Number(uraniumRod.resources[k]) || 0) * uraniumRodsPerMin;
		const pVal = (Number(plutoniumRod.resources[k]) || 0) * puRodsPerMin;
		const total = uVal + pVal;
		const rem = max - total;
		ws2.addRow([
			RES_NAMES[k],
			max,
			Math.round(uVal * 100) / 100 || null,
			Math.round(pVal * 100) / 100 || null,
			Math.round(total * 100) / 100 || null,
			Math.round(rem),
		]);
	}
	ws2.getColumn(1).width = 14;
	ws2.getColumn(2).width = 12;
	ws2.getColumn(3).width = 14;
	ws2.getColumn(4).width = 14;
	ws2.getColumn(5).width = 14;
	ws2.getColumn(6).width = 12;

	// --- Sheet 3: Remaining Resources ---
	const ws3 = workbook.addWorksheet('Remaining Resources');
	addHeaderRow(ws3, ['Resource', 'Map Max', 'Nuclear Usage', 'Remaining', '% Remaining']);
	for (const k of resKeys) {
		const max = RESOURCE_MAX[k];
		if (!max || max >= Number.MAX_SAFE_INTEGER) continue;
		if (k === 'Desc_NuclearWaste_C' || k === 'Desc_PlutoniumWaste_C') continue;
		const used = nuclearTotal[k] || 0;
		const rem = max - used;
		ws3.addRow([
			RES_NAMES[k],
			max,
			Math.round(used),
			Math.round(rem),
			Math.round((rem / max) * 1000) / 10,
		]);
	}
	ws3.getColumn(1).width = 14;
	ws3.getColumn(2).width = 12;
	ws3.getColumn(3).width = 14;
	ws3.getColumn(4).width = 12;
	ws3.getColumn(5).width = 14;

	// --- Sheet 4: Full LP (recipes + MW + nuclear as variables) ---
	process.stderr.write('\n=== FULL LP OPTIMIZATION ===\n');
	const solver = require('javascript-lp-solver');

	const model = {
		optimize: 'sink',
		opType: 'max',
		constraints: {},
		variables: {},
	};

	// Item flow constraints: production - consumption >= 0
	// We prefix item constraints with 'flow_'
	const allItems = gameData.items;
	for (const className in allItems) {
		model.constraints['flow_' + className] = { min: 0 };
	}

	// Radioactive items with 0 sink points must be fully consumed (no accumulation)
	// Forces the solver to process waste through the full nuclear chain
	for (const className in allItems) {
		const item = allItems[className];
		if (item.radioactiveDecay > 0 && item.sinkPoints === 0) {
			model.constraints['flow_' + className] = { min: 0, max: 0 };
		}
	}

	// Raw resource limits
	for (const k of Object.keys(RESOURCE_MAX)) {
		model.constraints['limit_' + k] = { max: RESOURCE_MAX[k] };
	}

	// Virtual power item: breaks the circular dependency
	// Recipes/mines consume PowerUnit, NPP converts NuclearFuelRod -> PowerUnit + Waste
	model.constraints['flow_PowerUnit'] = { min: 0 };

	// --- Generator variables: solver picks optimal power mix ---

	// === Coal Generator (75 MW) ===
	// Coal: 300 MJ => 75/300*60 = 15/min, Water: 60*(75*10)/1000 = 45 m³/min
	model.variables['gen_coal'] = {
		'flow_Desc_Coal_C': -15, 'flow_Desc_Water_C': -45, 'flow_PowerUnit': 75,
	};
	// Compacted Coal: 630 MJ => 75/630*60 = 7.143/min
	model.variables['gen_coal_compacted'] = {
		'flow_Desc_CompactedCoal_C': -7.143, 'flow_Desc_Water_C': -45, 'flow_PowerUnit': 75,
	};
	// Petroleum Coke: 180 MJ => 75/180*60 = 25/min
	model.variables['gen_coal_petcoke'] = {
		'flow_Desc_PetroleumCoke_C': -25, 'flow_Desc_Water_C': -45, 'flow_PowerUnit': 75,
	};

	// === Fuel Generator (250 MW) ===
	// Liquid Fuel: 750 MJ => 250/750*60 = 20 m³/min
	model.variables['gen_fuel'] = {
		'flow_Desc_LiquidFuel_C': -20, 'flow_PowerUnit': 250,
	};
	// Liquid Turbo Fuel: 2000 MJ => 250/2000*60 = 7.5 m³/min
	model.variables['gen_fuel_turbo'] = {
		'flow_Desc_LiquidTurboFuel_C': -7.5, 'flow_PowerUnit': 250,
	};
	// Liquid Biofuel: 750 MJ => 250/750*60 = 20 m³/min
	model.variables['gen_fuel_biofuel'] = {
		'flow_Desc_LiquidBiofuel_C': -20, 'flow_PowerUnit': 250,
	};
	// Rocket Fuel: 3600 MJ => 250/3600*60 = 4.167 m³/min
	model.variables['gen_fuel_rocket'] = {
		'flow_Desc_RocketFuel_C': -4.167, 'flow_PowerUnit': 250,
	};
	// Ionized Fuel: 5000 MJ => 250/5000*60 = 3 m³/min
	model.variables['gen_fuel_ionized'] = {
		'flow_Desc_IonizedFuel_C': -3, 'flow_PowerUnit': 250,
	};

	// === Nuclear Power Plant (2500 MW) ===
	// Uranium: 750000 MJ => 0.2 rods/min, 10 waste/min, 240 m³ water/min
	model.variables['npp_uranium'] = {
		'flow_Desc_NuclearFuelRod_C': -0.2, 'flow_Desc_NuclearWaste_C': 10,
		'flow_Desc_Water_C': -240, 'flow_PowerUnit': 2500,
	};
	// Plutonium: 1500000 MJ => 0.1 rods/min, 1 Pu waste/min
	model.variables['npp_plutonium'] = {
		'flow_Desc_PlutoniumFuelRod_C': -0.1, 'flow_Desc_PlutoniumWaste_C': 1,
		'flow_Desc_Water_C': -240, 'flow_PowerUnit': 2500,
	};
	// Ficsonium: 150000 MJ => 1 rod/min, no waste
	model.variables['npp_ficsonium'] = {
		'flow_Desc_FicsoniumFuelRod_C': -1,
		'flow_Desc_Water_C': -240, 'flow_PowerUnit': 2500,
	};

	// --- Mining variables (with real miner power cost) ---
	for (const k of Object.keys(RESOURCE_MAX)) {
		const varName = 'mine_' + k;
		model.variables[varName] = {};
		model.variables[varName]['flow_' + k] = 1;    // produces resource
		model.variables[varName]['limit_' + k] = 1;   // limited by max
		const miningInfo = MINING_POWER_TOTAL[k];
		if (miningInfo && miningInfo.perUnit > 0) {
			model.variables[varName]['flow_PowerUnit'] = -miningInfo.perUnit;
		}
	}

	// --- Recipe variables (ALL recipes, including SAM conversions) ---
	const allRecipes = gameData.recipes;
	for (const slug in allRecipes) {
		const recipe = allRecipes[slug];
		// Only machine recipes, not building/hand recipes
		if (!recipe.inMachine || recipe.forBuilding) continue;
		if (!recipe.producedIn || recipe.producedIn.length === 0) continue;

		const machineClass = recipe.producedIn[0];
		const cyclesPerMin = 60 / recipe.time;
		const varName = 'recipe_' + recipe.className;
		model.variables[varName] = {};

		// Ingredients (consumed)
		for (const ing of recipe.ingredients) {
			const flowKey = 'flow_' + ing.item;
			model.variables[varName][flowKey] = (model.variables[varName][flowKey] || 0) - ing.amount * cyclesPerMin;
		}

		// Products (produced)
		for (const prod of recipe.products) {
			const flowKey = 'flow_' + prod.item;
			model.variables[varName][flowKey] = (model.variables[varName][flowKey] || 0) + prod.amount * cyclesPerMin;
		}

		// Power consumption as PowerUnit
		let power;
		if (recipe.isVariablePower && recipe.minPower > 0) {
			power = (recipe.minPower + recipe.maxPower) / 2;
		} else {
			power = MACHINE_POWER[machineClass] || 0;
		}
		if (power > 0) {
			model.variables[varName]['flow_PowerUnit'] =
				(model.variables[varName]['flow_PowerUnit'] || 0) - power;
		}
	}

	// --- Sink variables (for items with sinkPoints > 0) ---
	// IMPORTANT: add sinks in ascending sinkPoints order — javascript-lp-solver
	// returns 0 if high-value sinks are added first (solver quirk)
	const sinkableItems = Object.keys(allItems)
		.filter(cn => allItems[cn].sinkPoints > 0 && !allItems[cn].liquid)
		.sort((a, b) => allItems[a].sinkPoints - allItems[b].sinkPoints);
	for (const className of sinkableItems) {
		const item = allItems[className];
		const varName = 'sink_' + className;
		model.variables[varName] = { sink: item.sinkPoints };
		model.variables[varName]['flow_' + className] = -1;
	}

	process.stderr.write('Variables: ' + Object.keys(model.variables).length + ', Constraints: ' + Object.keys(model.constraints).length + '\n');

	// Convert model to CPLEX LP format and solve with HiGHS
	const lpText = modelToCplexLP(model);
	const highs_init = require('highs');
	const highs = await highs_init();
	const highsResult = highs.solve(lpText);

	process.stderr.write('Status: ' + highsResult.Status + '\n');
	process.stderr.write('Total sink points: ' + Math.round(highsResult.ObjectiveValue || 0) + '/min\n');

	// Convert HiGHS result to flat dict (like javascript-lp-solver output)
	// HiGHS uses sanitized names, build reverse mapping
	const sanToOrig = {};
	for (const v of Object.keys(model.variables)) {
		sanToOrig[v.replace(/[^a-zA-Z0-9_]/g, '_')] = v;
	}
	const lpResult = {};
	for (const sanName in highsResult.Columns) {
		const col = highsResult.Columns[sanName];
		if (col.Primal > 0.001) {
			const origName = sanToOrig[sanName] || sanName;
			lpResult[origName] = col.Primal;
		}
	}

	// Extract results
	const sinkItems = [];
	let totalSink = 0;
	for (const className in allItems) {
		const qty = lpResult['sink_' + className] || 0;
		if (qty > 0.01) {
			const item = allItems[className];
			sinkItems.push({
				name: item.name,
				className: className,
				sinkPoints: item.sinkPoints,
				quantity: qty,
				totalSink: Math.round(qty * item.sinkPoints),
			});
			totalSink += qty * item.sinkPoints;
		}
	}
	sinkItems.sort((a, b) => b.totalSink - a.totalSink);

	// Power info from all generator variables
	const generators = [
		{ key: 'gen_coal', name: 'Coal Gen (Coal)', mw: 75 },
		{ key: 'gen_coal_compacted', name: 'Coal Gen (Compacted)', mw: 75 },
		{ key: 'gen_coal_petcoke', name: 'Coal Gen (Pet. Coke)', mw: 75 },
		{ key: 'gen_fuel', name: 'Fuel Gen (Fuel)', mw: 250 },
		{ key: 'gen_fuel_turbo', name: 'Fuel Gen (Turbo)', mw: 250 },
		{ key: 'gen_fuel_biofuel', name: 'Fuel Gen (Biofuel)', mw: 250 },
		{ key: 'gen_fuel_rocket', name: 'Fuel Gen (Rocket)', mw: 250 },
		{ key: 'gen_fuel_ionized', name: 'Fuel Gen (Ionized)', mw: 250 },
		{ key: 'npp_uranium', name: 'NPP (Uranium)', mw: 2500 },
		{ key: 'npp_plutonium', name: 'NPP (Plutonium)', mw: 2500 },
		{ key: 'npp_ficsonium', name: 'NPP (Ficsonium)', mw: 2500 },
	];
	let totalMW = 0;
	for (const g of generators) {
		g.count = lpResult[g.key] || 0;
		g.totalMW = g.count * g.mw;
		totalMW += g.totalMW;
	}

	// Resource usage
	const resourceUsage = {};
	for (const k of Object.keys(RESOURCE_MAX)) {
		resourceUsage[k] = lpResult['mine_' + k] || 0;
	}

	process.stderr.write('\n--- Power (' + Math.round(totalMW) + ' MW) ---\n');
	for (const g of generators) {
		if (g.count > 0.01) process.stderr.write('  ' + g.name + ': ' + g.count.toFixed(1) + ' (' + Math.round(g.totalMW) + ' MW)\n');
	}
	for (const s of sinkItems) {
		process.stderr.write('  Sink ' + s.name + ': ' + s.quantity.toFixed(2) + '/min (' + s.totalSink + ' pts)\n');
	}

	// Collect active recipes for the sheet
	const activeRecipes = [];
	for (const k in lpResult) {
		if (k.startsWith('recipe_') && lpResult[k] > 0.001) {
			const recipeName = k.slice(7); // remove 'recipe_'
			const recipe = allRecipes[Object.keys(allRecipes).find(s => allRecipes[s].className === recipeName)];
			activeRecipes.push({
				name: recipe ? recipe.name : recipeName,
				className: recipeName,
				machines: Math.round(lpResult[k] * 100) / 100,
				machine: recipe ? recipe.producedIn[0] : '',
			});
		}
	}
	activeRecipes.sort((a, b) => b.machines - a.machines);

	// Write sheet
	const ws4 = workbook.addWorksheet('Full LP Optimization');

	// Summary
	addHeaderRow(ws4, ['Full LP Optimization', '']);
	ws4.addRow(['Total Sink Points /min', Math.round(highsResult.ObjectiveValue || 0)]);
	ws4.addRow([]);
	addHeaderRow(ws4, ['Power Generation', 'Count', 'MW']);
	for (const g of generators) {
		if (g.count > 0.01) ws4.addRow([g.name, Math.round(g.count * 10) / 10, Math.round(g.totalMW)]);
	}
	ws4.addRow(['TOTAL', '', Math.round(totalMW)]);
	ws4.addRow([]);

	// Sinked items
	addHeaderRow(ws4, ['Sinked Item', 'Sink (unit)', 'Qty /min', 'Sink /min']);
	for (const s of sinkItems) {
		ws4.addRow([s.name, s.sinkPoints, Math.round(s.quantity * 100) / 100, s.totalSink]);
	}
	ws4.addRow([]);

	// Active recipes
	addHeaderRow(ws4, ['Recipe', 'Machines', 'Building']);
	for (const r of activeRecipes) {
		ws4.addRow([r.name, r.machines, r.machine]);
	}
	ws4.addRow([]);

	// Resource usage
	addHeaderRow(ws4, ['Resource', 'Map Max', 'Used', 'Remaining', '% Used']);
	for (const k of Object.keys(RESOURCE_MAX)) {
		if (RESOURCE_MAX[k] >= 9999999) continue;
		const max = RESOURCE_MAX[k];
		const used = resourceUsage[k] || 0;
		if (max === 0 && used === 0) continue;
		ws4.addRow([
			RES_NAMES[k] || k,
			max,
			Math.round(used),
			Math.round(max - used),
			Math.round((used / max) * 1000) / 10,
		]);
	}

	ws4.getColumn(1).width = 28;
	ws4.getColumn(2).width = 14;
	ws4.getColumn(3).width = 12;
	ws4.getColumn(4).width = 14;

	// --- Generate GraphML for yEd ---
	const graphml = generateGraphML(lpResult, model, allRecipes, allItems, RESOURCE_MAX, RES_NAMES);

	const now = new Date();
	const ts = [now.getHours(), now.getMinutes(), now.getSeconds()].map(n => String(n).padStart(2, '0')).join('');
	const outputPath = require('path').join(__dirname, 'sinkAnalysis_' + ts + '.xlsx');
	await workbook.xlsx.writeFile(outputPath);
	process.stderr.write('\nWrote ' + outputPath + '\n');

	const graphmlPath = require('path').join(__dirname, 'sinkAnalysis_' + ts + '.graphml');
	require('fs').writeFileSync(graphmlPath, graphml);
	process.stderr.write('Wrote ' + graphmlPath + '\n');
}

// ========================================================================
// GraphML generation (yEd compatible, same conventions as SatisfactoryTools)
// ========================================================================

// Node colors (matching the web app)
const NODE_COLORS = {
	recipe:    '#DF691A', // orange
	miner:     '#4E5D6C', // dark gray-blue
	sink:      '#D9534F', // red
	byproduct: '#1B7089', // teal
	generator: '#8E44AD', // purple (custom for NPP)
};

// Edge colors by item category
const WATER_ITEMS = ['Water'];
const NUCLEAR_ITEMS = [
	'Uranium', 'Uranium Waste', 'Non-Fissile Uranium', 'Plutonium Pellet',
	'Encased Plutonium Cell', 'Encased Uranium Cell', 'Uranium Fuel Rod',
	'Plutonium Fuel Rod', 'Plutonium Waste',
];
const FLUID_ITEMS = [
	'Crude Oil', 'Heavy Oil Residue', 'Fuel', 'Alumina Solution',
	'Sulfuric Acid', 'Nitric Acid', 'Nitrogen Gas', 'Dissolved Silica',
	'Liquid Biofuel', 'Rocket Fuel', 'Ionized Fuel',
];

function getEdgeColor(itemName) {
	if (WATER_ITEMS.includes(itemName)) return '#3498DB';
	if (NUCLEAR_ITEMS.includes(itemName)) return '#E74C3C';
	if (FLUID_ITEMS.includes(itemName)) return '#F1C40F';
	return '#697D91';
}

function escXml(s) {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtNum(n) {
	const r = Math.round(n * 1000) / 1000;
	return r.toString().replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

function generateGraphML(lpResult, model, allRecipes, allItems, RESOURCE_MAX, RES_NAMES) {
	const nodes = [];
	const producers = {}; // itemClass -> [{ nodeId, amount }]
	const consumers = {}; // itemClass -> [{ nodeId, amount }]
	let nextId = 0;

	function trackFlow(itemClass, nodeId, netAmount) {
		if (netAmount > 0.001) {
			(producers[itemClass] = producers[itemClass] || []).push({ nodeId, amount: netAmount });
		} else if (netAmount < -0.001) {
			(consumers[itemClass] = consumers[itemClass] || []).push({ nodeId, amount: -netAmount });
		}
	}

	// Build recipe lookup by className
	const recipeByClass = {};
	for (const slug in allRecipes) recipeByClass[allRecipes[slug].className] = allRecipes[slug];

	// Machine display names
	const MACHINE_NAMES = {
		Desc_ConstructorMk1_C: 'Constructor', Desc_SmelterMk1_C: 'Smelter',
		Desc_FoundryMk1_C: 'Foundry', Desc_AssemblerMk1_C: 'Assembler',
		Desc_ManufacturerMk1_C: 'Manufacturer', Desc_OilRefinery_C: 'Refinery',
		Desc_Blender_C: 'Blender', Desc_Packager_C: 'Packager',
		Desc_HadronCollider_C: 'Particle Accelerator', Desc_QuantumEncoder_C: 'Quantum Encoder',
		Desc_Converter_C: 'Converter',
	};

	// --- NPP node ---
	const nppVal = lpResult['npp_convert'] || 0;
	if (nppVal > 0.001) {
		const nid = nextId++;
		nodes.push({
			id: nid, type: 'generator',
			label: 'Nuclear Power Plant\n' + fmtNum(nppVal) + 'x (' + Math.round(nppVal * 2500) + ' MW)',
		});
		const varDef = model.variables['npp_convert'];
		for (const k in varDef) {
			if (k.startsWith('flow_') && k !== 'flow_PowerUnit') {
				trackFlow(k.slice(5), nid, varDef[k] * nppVal);
			}
		}
	}

	// --- Miner nodes ---
	for (const resClass of Object.keys(RESOURCE_MAX)) {
		const val = lpResult['mine_' + resClass] || 0;
		if (val < 0.01) continue;
		const nid = nextId++;
		const name = RES_NAMES[resClass] || allItems[resClass]?.name || resClass;
		nodes.push({
			id: nid, type: 'miner',
			label: name + '\n' + fmtNum(val) + ' / min',
		});
		trackFlow(resClass, nid, val);
	}

	// --- Recipe nodes ---
	for (const key in lpResult) {
		if (!key.startsWith('recipe_') || lpResult[key] < 0.001) continue;
		const className = key.slice(7);
		const recipe = recipeByClass[className];
		if (!recipe) continue;
		const machines = lpResult[key];
		const nid = nextId++;
		// Label: primary product name (like web app), fallback to recipe name
		const primaryProduct = recipe.products.length > 0 ? allItems[recipe.products[0].item] : null;
		const productName = primaryProduct ? primaryProduct.name : recipe.name;
		const suffix = recipe.alternate ? ' (alternate)' : '';
		const machineName = MACHINE_NAMES[recipe.producedIn[0]] || recipe.producedIn[0];
		nodes.push({
			id: nid, type: 'recipe',
			label: productName + suffix + '\n' + fmtNum(machines) + 'x ' + machineName,
		});
		const varDef = model.variables[key];
		for (const fk in varDef) {
			if (fk.startsWith('flow_') && fk !== 'flow_PowerUnit') {
				trackFlow(fk.slice(5), nid, varDef[fk] * machines);
			}
		}
	}

	// --- Sink nodes ---
	for (const key in lpResult) {
		if (!key.startsWith('sink_') || lpResult[key] < 0.01) continue;
		const itemClass = key.slice(5);
		const item = allItems[itemClass];
		if (!item) continue;
		const qty = lpResult[key];
		const nid = nextId++;
		const pts = Math.round(qty * item.sinkPoints);
		nodes.push({
			id: nid, type: 'sink',
			label: 'Sink: ' + item.name + '\n' + fmtNum(qty) + ' / min\n' + pts.toLocaleString() + ' points / min',
		});
		trackFlow(itemClass, nid, -qty);
	}

	// --- Byproduct nodes (items produced but not consumed and not sunk) ---
	for (const itemClass in producers) {
		const totalProd = producers[itemClass].reduce((s, p) => s + p.amount, 0);
		const totalCons = (consumers[itemClass] || []).reduce((s, c) => s + c.amount, 0);
		const excess = totalProd - totalCons;
		if (excess > 0.01) {
			const item = allItems[itemClass];
			const name = item?.name || itemClass;
			const nid = nextId++;
			nodes.push({
				id: nid, type: 'byproduct',
				label: 'Byproduct: ' + name + '\n' + fmtNum(excess) + ' / min',
			});
			trackFlow(itemClass, nid, -excess);
		}
	}

	// --- Build edges ---
	const edges = [];
	let edgeId = 0;

	for (const itemClass in consumers) {
		const prods = producers[itemClass] || [];
		const cons = consumers[itemClass] || [];
		if (prods.length === 0 || cons.length === 0) continue;

		const itemName = allItems[itemClass]?.name || itemClass;
		const totalProduced = prods.reduce((s, p) => s + p.amount, 0);

		if (prods.length === 1) {
			for (const c of cons) {
				edges.push({ id: edgeId++, from: prods[0].nodeId, to: c.nodeId, item: itemName, amount: c.amount });
			}
		} else if (cons.length === 1) {
			for (const p of prods) {
				edges.push({ id: edgeId++, from: p.nodeId, to: cons[0].nodeId, item: itemName, amount: p.amount });
			}
		} else {
			for (const p of prods) {
				for (const c of cons) {
					const amount = (p.amount / totalProduced) * c.amount;
					if (amount > 0.001) {
						edges.push({ id: edgeId++, from: p.nodeId, to: c.nodeId, item: itemName, amount });
					}
				}
			}
		}
	}

	// --- Emit GraphML ---
	const L = [];
	L.push('<?xml version="1.0" encoding="UTF-8" standalone="no"?>');
	L.push('<graphml xmlns="http://graphml.graphdrawing.org/xmlns"');
	L.push('  xmlns:y="http://www.yworks.com/xml/graphml"');
	L.push('  xmlns:yed="http://www.yworks.com/xml/yed/3">');
	L.push('  <key for="node" id="d0" yfiles.type="nodegraphics"/>');
	L.push('  <key for="edge" id="d1" yfiles.type="edgegraphics"/>');
	L.push('  <key id="nodeType" for="node" attr.name="nodeType" attr.type="string"/>');
	L.push('  <key id="item" for="edge" attr.name="item" attr.type="string"/>');
	L.push('  <key id="amount" for="edge" attr.name="amount" attr.type="double"/>');
	L.push('  <graph id="production" edgedefault="directed">');

	for (const n of nodes) {
		const color = NODE_COLORS[n.type] || '#888888';
		const lineCount = n.label.split('\n').length;
		const height = Math.max(40, lineCount * 20 + 20);
		L.push('    <node id="n' + n.id + '">');
		L.push('      <data key="nodeType">' + n.type + '</data>');
		L.push('      <data key="d0">');
		L.push('        <y:ShapeNode>');
		L.push('          <y:Geometry height="' + height + '.0" width="220.0" x="0.0" y="0.0"/>');
		L.push('          <y:Fill color="' + color + '" transparent="false"/>');
		L.push('          <y:BorderStyle color="#000000" type="line" width="1.0"/>');
		L.push('          <y:NodeLabel alignment="center" autoSizePolicy="content"'
			+ ' fontFamily="Dialog" fontSize="12" fontStyle="plain"'
			+ ' textColor="#EEEEEE" visible="true">' + escXml(n.label) + '</y:NodeLabel>');
		L.push('          <y:Shape type="roundrectangle"/>');
		L.push('        </y:ShapeNode>');
		L.push('      </data>');
		L.push('    </node>');
	}

	for (const e of edges) {
		const label = e.item + '\n' + fmtNum(e.amount) + ' / min';
		const color = getEdgeColor(e.item);
		L.push('    <edge id="e' + e.id + '" source="n' + e.from + '" target="n' + e.to + '">');
		L.push('      <data key="item">' + escXml(e.item) + '</data>');
		L.push('      <data key="amount">' + e.amount + '</data>');
		L.push('      <data key="d1">');
		L.push('        <y:PolyLineEdge>');
		L.push('          <y:LineStyle color="' + color + '" type="line" width="2.0"/>');
		L.push('          <y:Arrows source="none" target="standard"/>');
		L.push('          <y:EdgeLabel alignment="center" backgroundColor="#333333"'
			+ ' fontFamily="Dialog" fontSize="11" fontStyle="plain"'
			+ ' textColor="#EEEEEE" visible="true"'
			+ ' modelName="center_slider" modelPosition="center">'
			+ escXml(label) + '</y:EdgeLabel>');
		L.push('        </y:PolyLineEdge>');
		L.push('      </data>');
		L.push('    </edge>');
	}

	L.push('  </graph>');
	L.push('</graphml>');

	process.stderr.write('GraphML: ' + nodes.length + ' nodes, ' + edges.length + ' edges\n');
	return L.join('\n');
}

// Convert internal model dict to CPLEX LP format for HiGHS
function modelToCplexLP(model) {
	// Sanitize variable/constraint names for CPLEX format
	// Replace problematic chars with underscores
	function san(name) {
		return name.replace(/[^a-zA-Z0-9_]/g, '_');
	}

	const varNames = Object.keys(model.variables);
	const conNames = Object.keys(model.constraints);

	const lines = [];

	// Objective
	lines.push('Maximize');
	const objTerms = [];
	for (const v of varNames) {
		const coeff = model.variables[v]['sink'] || 0;
		if (coeff !== 0) {
			objTerms.push((coeff >= 0 ? '+ ' : '- ') + Math.abs(coeff) + ' ' + san(v));
		}
	}
	lines.push('  obj: ' + objTerms.join(' '));

	// Constraints
	lines.push('Subject To');
	for (const cName of conNames) {
		const con = model.constraints[cName];
		const terms = [];
		for (const v of varNames) {
			const coeff = model.variables[v][cName] || 0;
			if (coeff !== 0) {
				terms.push((coeff >= 0 ? '+ ' : '- ') + Math.abs(coeff) + ' ' + san(v));
			}
		}
		if (terms.length === 0) continue;
		const expr = terms.join(' ');
		if (con.min !== undefined && con.max !== undefined) {
			// Range: split into two constraints
			lines.push('  ' + san(cName) + '_lo: ' + expr + ' >= ' + con.min);
			lines.push('  ' + san(cName) + '_hi: ' + expr + ' <= ' + con.max);
		} else if (con.min !== undefined) {
			lines.push('  ' + san(cName) + ': ' + expr + ' >= ' + con.min);
		} else if (con.max !== undefined) {
			lines.push('  ' + san(cName) + ': ' + expr + ' <= ' + con.max);
		}
	}

	// Bounds (all variables >= 0)
	lines.push('Bounds');
	for (const v of varNames) {
		lines.push('  ' + san(v) + ' >= 0');
	}

	lines.push('End');
	return lines.join('\n');
}

main().catch(console.error);
