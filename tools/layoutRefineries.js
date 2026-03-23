/**
 * layoutRefineries.js — Génère un SVG du complexe de raffineries sur l'eau,
 * superposé à la carte topo Satisfactory.
 *
 * Usage:
 *   node bin/tools/layoutRefineries.js
 *
 * Sortie:
 *   bin/copperFactory_map.svg
 */

const fs   = require('fs');
const path = require('path');

// ─── Calibration coordonnées jeu ↔ SVG (5000×5000) ─────────────────────────
const GAME_X_MIN = -324698.832031;
const GAME_X_MAX =  425301.832031;
const GAME_Y_MIN = -375000;
const GAME_Y_MAX =  375000;
const MAP_W = 5000;
const MAP_H = 5000;
const UU_PX = MAP_W / (GAME_X_MAX - GAME_X_MIN);

function gameToSvg(gx, gy) {
	return {
		x: (gx - GAME_X_MIN) / (GAME_X_MAX - GAME_X_MIN) * MAP_W,
		y: (gy - GAME_Y_MIN) / (GAME_Y_MAX - GAME_Y_MIN) * MAP_H,
	};
}

function svgToGame(sx, sy) {
	return {
		x: sx / MAP_W * (GAME_X_MAX - GAME_X_MIN) + GAME_X_MIN,
		y: sy / MAP_H * (GAME_Y_MAX - GAME_Y_MIN) + GAME_Y_MIN,
	};
}

// ─── Clearance des bâtiments (UU) ───────────────────────────────────────────
const REF_W = 1000;   // raffinerie largeur (X)
const REF_D = 2200;   // raffinerie profondeur (Y)

// ─── Paramètres du layout ───────────────────────────────────────────────────
const GAP_X    = 200;   // 2m entre colonnes
const GAP_Y    = 1200;  // 12m entre rangées
const CELL_X   = REF_W + GAP_X;   // 1200 UU = 12m pitch par colonne
const CELL_Y   = REF_D + GAP_Y;   // 3400 UU = 34m pitch par rangée
const BLOCK_GAP = CELL_Y;         // même espacement entre blocs

// ─── Zone cible sur l'eau (coordonnées SVG) ─────────────────────────────────
// Bottom-left et bottom-right de la zone autorisée
const SVG_LEFT   = 4400;
const SVG_RIGHT  = 4965;
const SVG_BOTTOM = 3160;

const bottomLeft  = svgToGame(SVG_LEFT, SVG_BOTTOM);
const bottomRight = svgToGame(SVG_RIGHT, SVG_BOTTOM);
const PER_ROW     = Math.floor((bottomRight.x - bottomLeft.x) / CELL_X);

// ─── Définition des blocs ───────────────────────────────────────────────────

// Aluminium : alternance 3 Alumina + 4 Scrap par groupe, 10 groupes/rangée
const ALUMINUM = {
	alumina: { total: 98,  perGroup: 3, color: '#9b59b6', colorDark: '#7d3c98', name: 'Alumina Solution (Sloppy)' },
	scrap:   { total: 130, perGroup: 4, color: '#8e44ad', colorDark: '#6c3483', name: 'Electrode Al Scrap' },
	rows:    4,    // plain-pied
	groupsPerRow: 10,
};

// Fer + Cuivre : 4 étages
const STACKED_BLOCKS = [
	{ name: 'Pure Iron Ingot',      total: 2594, floors: 4, color: '#ff6b6b', colorDark: '#c0392b' },
	{ name: 'Pure Copper Ingot',    total: 2234, floors: 4, color: '#e67e22', colorDark: '#d35400' },
	{ name: 'Steamed Copper Sheet', total: 1103, floors: 4, color: '#e74c3c', colorDark: '#a93226' },
];

// ─── Gares cuivre ───────────────────────────────────────────────────────────
const STATIONS = [
	{ x: 335302,  y:  60000,  label: 'G1 Usine Cu', tp: 600 },
	{ x: 287446,  y: -83856,  label: 'G2 Cu',       tp: 6300 },
	{ x: 317763,  y: -197225, label: 'G3 Cu',       tp: 6600 },
	{ x: -157314, y: -120342, label: 'G4 Cu',       tp: 7800 },
	{ x: -50412,  y:  193931, label: 'G5 Cu',       tp: 7500 },
	{ x: 131108,  y:  111952, label: 'G6 Cu',       tp: 8100 },
];

// ─── Calcul de la hauteur totale ────────────────────────────────────────────
let totalH_UU = ALUMINUM.rows * CELL_Y + BLOCK_GAP;
for (let i = 0; i < STACKED_BLOCKS.length; i++) {
	const b = STACKED_BLOCKS[i];
	totalH_UU += Math.ceil(Math.ceil(b.total / b.floors) / PER_ROW) * CELL_Y;
	if (i < STACKED_BLOCKS.length - 1) totalH_UU += BLOCK_GAP;
}

const ANCHOR_X = bottomLeft.x;
const ANCHOR_Y = bottomLeft.y - totalH_UU;

// ─── Génération SVG ─────────────────────────────────────────────────────────
let svg = '';
let offY = 0;

// --- Aluminium (alternance 3+4) ---
const al  = ALUMINUM.alumina;
const sc  = ALUMINUM.scrap;
let alPlaced = 0, scPlaced = 0;

for (let r = 0; r < ALUMINUM.rows; r++) {
	const rowY = ANCHOR_Y + offY + r * CELL_Y;

	for (let g = 0; g < ALUMINUM.groupsPerRow; g++) {
		const groupCol = g * (al.perGroup + sc.perGroup);

		// Alumina (3 par groupe)
		const alCount = Math.min(al.perGroup, al.total - alPlaced);
		if (alCount > 0) {
			const tl = gameToSvg(ANCHOR_X + groupCol * CELL_X, rowY);
			const w  = alCount * CELL_X * UU_PX;
			const h  = REF_D * UU_PX;
			svg += `  <rect x="${tl.x.toFixed(1)}" y="${tl.y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${al.color}" fill-opacity="0.6" stroke="${al.colorDark}" stroke-width="0.5"/>\n`;
			alPlaced += alCount;
		}

		// Scrap (4 par groupe)
		const scCount = Math.min(sc.perGroup, sc.total - scPlaced);
		if (scCount > 0) {
			const tl = gameToSvg(ANCHOR_X + (groupCol + al.perGroup) * CELL_X, rowY);
			const w  = scCount * CELL_X * UU_PX;
			const h  = REF_D * UU_PX;
			svg += `  <rect x="${tl.x.toFixed(1)}" y="${tl.y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${sc.color}" fill-opacity="0.6" stroke="${sc.colorDark}" stroke-width="0.5"/>\n`;
			scPlaced += scCount;
		}
	}

	// Label sur la première rangée
	if (r === 0) {
		const tl = gameToSvg(ANCHOR_X, rowY);
		svg += `  <text x="${(tl.x + 4).toFixed(1)}" y="${(tl.y - 3).toFixed(1)}" font-size="9" font-weight="bold" fill="white" font-family="sans-serif" stroke="black" stroke-width="0.4">Aluminium (3 Alumina + 4 Scrap) x${ALUMINUM.groupsPerRow} - ${ALUMINUM.rows} rangs plain-pied</text>\n`;
	}
}

console.log(`Alumina: ${alPlaced}/${al.total}, Scrap: ${scPlaced}/${sc.total}`);
offY += ALUMINUM.rows * CELL_Y + BLOCK_GAP;

// --- Blocs fer/cuivre (4 étages) ---
for (const b of STACKED_BLOCKS) {
	const perFloor = Math.ceil(b.total / b.floors);
	const nRows    = Math.ceil(perFloor / PER_ROW);
	const blockH   = nRows * CELL_Y;
	const blockW   = PER_ROW * CELL_X;

	for (let r = 0; r < nRows; r++) {
		const rowY = ANCHOR_Y + offY + r * CELL_Y;
		const tl   = gameToSvg(ANCHOR_X, rowY);
		const rowW = blockW * UU_PX;
		const rowH = REF_D * UU_PX;

		svg += `  <rect x="${tl.x.toFixed(1)}" y="${tl.y.toFixed(1)}" width="${rowW.toFixed(1)}" height="${rowH.toFixed(1)}" fill="${b.color}" fill-opacity="0.6" stroke="${b.colorDark}" stroke-width="0.5"/>\n`;

		if (r === 0) {
			svg += `  <text x="${(tl.x + 4).toFixed(1)}" y="${(tl.y + 11).toFixed(1)}" font-size="9" font-weight="bold" fill="white" font-family="sans-serif" stroke="black" stroke-width="0.4">${b.name} (${b.total}x, ${nRows} rangs x ${b.floors} et.)</text>\n`;
		}
	}

	// Annotation du gap sur le premier espacement
	if (nRows > 1) {
		const rightX = gameToSvg(ANCHOR_X + blockW, 0).x;
		const gapTop = gameToSvg(0, ANCHOR_Y + offY + REF_D).y;
		const gapBot = gameToSvg(0, ANCHOR_Y + offY + CELL_Y).y;
		const midY   = (gapTop + gapBot) / 2;
		svg += `  <line x1="${(rightX + 5).toFixed(1)}" y1="${gapTop.toFixed(1)}" x2="${(rightX + 5).toFixed(1)}" y2="${gapBot.toFixed(1)}" stroke="white" stroke-width="1"/>\n`;
		svg += `  <line x1="${(rightX + 2).toFixed(1)}" y1="${gapTop.toFixed(1)}" x2="${(rightX + 8).toFixed(1)}" y2="${gapTop.toFixed(1)}" stroke="white" stroke-width="1"/>\n`;
		svg += `  <line x1="${(rightX + 2).toFixed(1)}" y1="${gapBot.toFixed(1)}" x2="${(rightX + 8).toFixed(1)}" y2="${gapBot.toFixed(1)}" stroke="white" stroke-width="1"/>\n`;
		svg += `  <text x="${(rightX + 12).toFixed(1)}" y="${(midY + 3).toFixed(1)}" font-size="7" fill="white" font-family="sans-serif" stroke="black" stroke-width="0.2">${GAP_Y / 100}m</text>\n`;
	}

	console.log(`${b.name}: ${nRows} rows x ${b.floors} floors = ${Math.round(blockH / 100)}m`);
	offY += blockH + BLOCK_GAP;
}

// --- Gares ---
for (const st of STATIONS) {
	const p = gameToSvg(st.x, st.y);
	svg += `  <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="5" fill="#00ccff" stroke="white" stroke-width="1"/>\n`;
	svg += `  <text x="${(p.x + 7).toFixed(1)}" y="${(p.y + 4).toFixed(1)}" font-size="9" font-weight="bold" fill="#00ccff" font-family="sans-serif" stroke="black" stroke-width="0.3">${st.label} (${st.tp}/m)</text>\n`;
}

// --- Légende ---
svg += `  <rect x="20" y="20" width="420" height="155" fill="black" fill-opacity="0.7" rx="5"/>\n`;
svg += `  <text x="30" y="40" font-size="13" font-weight="bold" fill="white" font-family="sans-serif">Complexe Raffineries sur eau</text>\n`;
svg += `  <text x="30" y="58" font-size="9" fill="${al.color}" font-family="sans-serif">■ ${al.name}: ${al.total} Ref  } alternees 3+4, plain-pied</text>\n`;
svg += `  <text x="30" y="72" font-size="9" fill="${sc.color}" font-family="sans-serif">■ ${sc.name}: ${sc.total} Ref }</text>\n`;
for (const b of STACKED_BLOCKS) {
	const yOff = 88 + STACKED_BLOCKS.indexOf(b) * 14;
	svg += `  <text x="30" y="${yOff}" font-size="9" fill="${b.color}" font-family="sans-serif">■ ${b.name}: ${b.total} Ref (${b.floors} et.)</text>\n`;
}
const totalRef = al.total + sc.total + STACKED_BLOCKS.reduce((s, b) => s + b.total, 0);
svg += `  <text x="30" y="136" font-size="9" fill="#aaa" font-family="sans-serif">Total: ${totalRef} raffineries | ${GAP_Y / 100}m entre rangees | ${PER_ROW}/rang</text>\n`;
svg += `  <text x="30" y="150" font-size="9" fill="#aaa" font-family="sans-serif">Eau totale: ~77 000 m3/min</text>\n`;

// --- Assemblage final ---
const output = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${MAP_W}" height="${MAP_H}" viewBox="0 0 ${MAP_W} ${MAP_H}">
  <image href="map_topo.svg" x="0" y="0" width="${MAP_W}" height="${MAP_H}"/>
${svg}
</svg>`;

const outputPath = path.join(__dirname, '..', 'data', 'copperFactory_map.svg');
fs.writeFileSync(outputPath, output);
console.log(`\nTotal: ${totalRef} raffineries, hauteur ${Math.round(totalH_UU / 100)}m`);
console.log(`Written: ${outputPath}`);