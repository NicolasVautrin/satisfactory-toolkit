/**
 * Generates copperFactory_map.svg with updated layout parameters.
 * 48 refineries per row instead of 70.
 */
const fs = require('fs');

// ── Layout parameters ──────────────────────────────────────────────
const PER_ROW        = 48;
const CELL_X_PX      = 8;       // pixels per refinery in SVG
const ROW_WIDTH_PX   = PER_ROW * CELL_X_PX;  // 384px
const ROW_HEIGHT_PX  = 14.7;
const ROW_GAP_PX     = 8;       // 12m gap between rows (in SVG scale)
const ROW_PITCH_PX   = ROW_HEIGHT_PX + ROW_GAP_PX;  // ~22.7px per row
const BLOCK_GAP_PX   = 8;       // 12m gap between blocks (same as between rows)
const FLOORS         = 8;

// Anchor: player position "métalurgie" — factory extends NORTH (into the ocean)
const ANCHOR_X = 4112;
const ANCHOR_Y = 3175;  // southern edge, factory goes UP (decreasing Y)

// ── Aluminium block (plain-pied, alternating groups) ───────────────
// 3 Alumina + 4 Scrap per group
const ALUMINA_COUNT  = 98;
const SCRAP_COUNT    = 130;
const GROUP_SIZE     = 7; // 3+4
const GROUPS_PER_ROW = Math.floor(PER_ROW / GROUP_SIZE); // 6 groups = 42 machines/row
const ALUMINA_PER_GROUP = 3;
const SCRAP_PER_GROUP   = 4;
const AL_MACHINES_PER_ROW = GROUPS_PER_ROW * GROUP_SIZE; // 42
const TOTAL_AL = ALUMINA_COUNT + SCRAP_COUNT; // 228
const AL_ROWS = Math.ceil(TOTAL_AL / AL_MACHINES_PER_ROW); // 6

// ── Production blocks ──────────────────────────────────────────────
const blocks = [
  { name: 'Pure Iron Ingot',      count: 2594, color: '#ff6b6b', stroke: '#c0392b' },
  { name: 'Pure Copper Ingot',    count: 2234, color: '#e67e22', stroke: '#d35400' },
  { name: 'Steamed Copper Sheet', count: 1103, color: '#e74c3c', stroke: '#a93226' },
];

for (const b of blocks) {
  b.totalRows    = Math.ceil(b.count / PER_ROW);
  b.rowsPerFloor = Math.ceil(b.totalRows / FLOORS);
}

// ── SVG generation ─────────────────────────────────────────────────
let svg = '';
const lines = [];

function rect(x, y, w, h, fill, stroke, opacity = 0.6) {
  lines.push(`  <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${fill}" fill-opacity="${opacity}" stroke="${stroke}" stroke-width="0.5"/>`);
}

function text(x, y, size, fill, content, opts = {}) {
  const fw = opts.bold ? ' font-weight="bold"' : '';
  const st = opts.stroke ? ` stroke="${opts.stroke}" stroke-width="${opts.strokeWidth || 0.4}"` : '';
  lines.push(`  <text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${size}"${fw} fill="${fill}" font-family="sans-serif"${st}>${content}</text>`);
}

function dimLine(x, y1, y2, label) {
  lines.push(`  <line x1="${x.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="white" stroke-width="1"/>`);
  lines.push(`  <line x1="${(x - 3).toFixed(1)}" y1="${y1.toFixed(1)}" x2="${(x + 3).toFixed(1)}" y2="${y1.toFixed(1)}" stroke="white" stroke-width="1"/>`);
  lines.push(`  <line x1="${(x - 3).toFixed(1)}" y1="${y2.toFixed(1)}" x2="${(x + 3).toFixed(1)}" y2="${y2.toFixed(1)}" stroke="white" stroke-width="1"/>`);
  text(x + 7, y2 - 1, 7, 'white', label, { stroke: 'black', strokeWidth: 0.2 });
}

// ── Header ─────────────────────────────────────────────────────────
lines.push('<?xml version="1.0" encoding="UTF-8"?>');
lines.push('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="5000" height="5000" viewBox="0 0 5000 5000">');
lines.push('  <image href="map_topo.svg" x="0" y="0" width="5000" height="5000"/>');

let curY = ANCHOR_Y;

// ── Factory extends NORTH (decreasing Y = into the ocean) ─────────

// ── Aluminium (plain-pied, alternating groups) ─────────────────────
curY -= AL_ROWS * ROW_PITCH_PX;
text(ANCHOR_X + 4, curY - 3, 9, 'white',
  `Aluminium (3 Alumina + 4 Scrap) x${GROUPS_PER_ROW} - ${AL_ROWS} rangs plain-pied`,
  { bold: true, stroke: 'black' });

for (let row = 0; row < AL_ROWS; row++) {
  const y = curY + row * ROW_PITCH_PX;
  for (let g = 0; g < GROUPS_PER_ROW; g++) {
    const baseX = ANCHOR_X + g * GROUP_SIZE * CELL_X_PX;
    rect(baseX, y, ALUMINA_PER_GROUP * CELL_X_PX, ROW_HEIGHT_PX, '#9b59b6', '#7d3c98');
    rect(baseX + ALUMINA_PER_GROUP * CELL_X_PX, y, SCRAP_PER_GROUP * CELL_X_PX, ROW_HEIGHT_PX, '#8e44ad', '#6c3483');
  }
}

// ── Production blocks (going north) ────────────────────────────────
for (const b of blocks) {
  const rowsShown = b.rowsPerFloor;
  curY -= rowsShown * ROW_PITCH_PX + BLOCK_GAP_PX;

  // Label
  rect(ANCHOR_X, curY, ROW_WIDTH_PX, ROW_HEIGHT_PX, b.color, b.stroke);
  text(ANCHOR_X + 4, curY + 11, 9, 'white',
    `${b.name} (${b.count}x, ${b.rowsPerFloor} rangs x ${FLOORS} et.)`,
    { bold: true, stroke: 'black' });

  // Rows
  for (let r = 1; r < rowsShown; r++) {
    rect(ANCHOR_X, curY + r * ROW_PITCH_PX, ROW_WIDTH_PX, ROW_HEIGHT_PX, b.color, b.stroke);
  }

  // Dimension line (12m gap)
  const dimX = ANCHOR_X + ROW_WIDTH_PX + 5;
  dimLine(dimX, curY + ROW_HEIGHT_PX, curY + ROW_PITCH_PX, '12m');
}

// ── Gares cuivre (from original) ──────────────────────────────────
const stations = [
  { label: 'G1 Usine Cu (600/m)',  svgX: ANCHOR_X, svgY: ANCHOR_Y },
  { label: 'G2 Cu (6300/m)',       svgX: 4081, svgY: 1941 },
  { label: 'G3 Cu (6600/m)',       svgX: 4283, svgY: 1185 },
  { label: 'G4 Cu (7800/m)',       svgX: 1116, svgY: 1698 },
  { label: 'G5 Cu (7500/m)',       svgX: 1829, svgY: 3793 },
  { label: 'G6 Cu (8100/m)',       svgX: 3039, svgY: 3246 },
];
for (const s of stations) {
  lines.push(`  <circle cx="${s.svgX.toFixed(1)}" cy="${s.svgY.toFixed(1)}" r="5" fill="#00ccff" stroke="white" stroke-width="1"/>`);
  text(s.svgX + 7, s.svgY + 4, 9, '#00ccff', s.label, { bold: true, stroke: 'black', strokeWidth: 0.3 });
}

// ── Legend ──────────────────────────────────────────────────────────
const totalRef = ALUMINA_COUNT + SCRAP_COUNT + blocks.reduce((s, b) => s + b.count, 0);
rect(20, 20, 440, 170, 'black', 'black', 0.7);
lines[lines.length - 1] = lines[lines.length - 1].replace('/>', ' rx="5"/>');

text(30, 40, 13, 'white', 'Complexe Raffineries sur eau (48/rang, 5 et.)', { bold: true });
text(30, 58, 9, '#9b59b6', `■ Alumina Solution (Sloppy): ${ALUMINA_COUNT} Ref  } alternees 3+4, plain-pied`);
text(30, 72, 9, '#8e44ad', `■ Electrode Al Scrap: ${SCRAP_COUNT} Ref }`);
text(30, 88, 9, '#ff6b6b', `■ Pure Iron Ingot: ${blocks[0].count} Ref (${FLOORS} et., ${blocks[0].rowsPerFloor} rangs/et.)`);
text(30, 102, 9, '#e67e22', `■ Pure Copper Ingot: ${blocks[1].count} Ref (${FLOORS} et., ${blocks[1].rowsPerFloor} rangs/et.)`);
text(30, 116, 9, '#e74c3c', `■ Steamed Copper Sheet: ${blocks[2].count} Ref (${FLOORS} et., ${blocks[2].rowsPerFloor} rangs/et.)`);
text(30, 136, 9, '#aaa', `Total: ${totalRef} raffineries | 12m entre rangees | ${PER_ROW}/rang`);
text(30, 150, 9, '#aaa', 'Eau totale: ~77 000 m3/min');
text(30, 164, 9, '#aaa', `Largeur rangee: ${PER_ROW * 12}m (${PER_ROW} x 12m)`);

lines.push('');
lines.push('</svg>');

// ── Write ──────────────────────────────────────────────────────────
const out = lines.join('\n');
fs.writeFileSync('bin/copperFactory_map.svg', out);
console.log(`Written bin/copperFactory_map.svg (${out.length} chars)`);
console.log(`\n=== Layout summary ===`);
console.log(`Per row: ${PER_ROW} (was 70)`);
console.log(`Row width: ${PER_ROW * 12}m (was 840m)`);
console.log(`Aluminium: ${AL_ROWS} rangs plain-pied (${GROUPS_PER_ROW} groups of 3+4)`);
for (const b of blocks) {
  console.log(`${b.name}: ${b.totalRows} rangs → ${b.rowsPerFloor} rangs/etage x ${FLOORS}`);
}
console.log(`Total: ${totalRef} raffineries`);