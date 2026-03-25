/**
 * Generate a topographic SVG map of Satisfactory from the wiki JPEG.
 *
 * Classifies pixels by blue excess (B - (R+G)/2):
 *   > 10  → water
 *   < -2  → continent (if luminance > 15)
 *   else  → off-map (black)
 *
 * Traces each altitude level with potrace (zone = black pixels).
 * Stacks layers: black bg → continent (low→high) → water on top.
 *
 * Dependencies: canvas, potrace
 * Source image: data/map.jpg (https://satisfactory.wiki.gg/images/Map.jpg)
 *
 * Usage:
 *   node tools/generateTopoMap.js
 */

const path = require('path');
const fs   = require('fs');
const { loadMapPixels, traceBlackMask, cleanup } = require('./mapHelper');

const OUTPUT_SVG = path.join(__dirname, '..', 'data', 'map_topo.svg');

// Altitude thresholds (grayscale luminance of terrain pixels)
const LEVELS = [120, 135, 150, 165, 180, 195];

// Colors: index 0 = continent base (lowest), 1..6 = altitude levels
const COLORS = [
  '#2d5016',  // continent base
  '#4a7a28',  // ≥ 120
  '#7aa53c',  // ≥ 135
  '#b8c95a',  // ≥ 150
  '#d4c07a',  // ≥ 165
  '#e8daa0',  // ≥ 180
  '#f5edd0',  // ≥ 195 (summits)
];

const WATER_COLOR  = '#2a7ab5';
const BG_COLOR     = '#111111';

async function run() {
  const { gray, isCont, isWater, W, H } = await loadMapPixels();

  const total  = W * H;
  const wCount = isWater.reduce((s, v) => s + v, 0);
  const cCount = isCont.reduce((s, v) => s + v, 0);
  console.log(`Source: ${W}x${H}`);
  console.log(`Water: ${(wCount / total * 100).toFixed(1)}%  Continent: ${(cCount / total * 100).toFixed(1)}%  Off-map: ${((total - wCount - cCount) / total * 100).toFixed(1)}%`);

  // --- Trace all layers ---

  // Water
  console.log('Tracing water...');
  const waterD = await traceBlackMask(i => isWater[i], W, H);

  // Continent outline (all continent pixels)
  console.log('Tracing continent...');
  const contD = await traceBlackMask(i => isCont[i], W, H);

  // Altitude levels
  const levelDs = [];
  for (let t = 0; t < LEVELS.length; t++) {
    console.log(`Tracing level ${LEVELS[t]}...`);
    const d = await traceBlackMask(i => isCont[i] && gray[i] >= LEVELS[t], W, H);
    levelDs.push(d);
  }

  // --- Build SVG ---
  console.log('Building SVG...');
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">\n`;
  svg += `<rect width="${W}" height="${H}" fill="${BG_COLOR}"/>\n`;

  // Continent layers: base first (largest, darkest), then altitude levels on top (lighter)
  const allCont = [contD, ...levelDs];
  for (let i = 0; i < allCont.length; i++) {
    if (allCont[i]) {
      svg += `<path d="${allCont[i]}" fill="${COLORS[i]}" stroke="none"/>\n`;
    }
  }

  // Water on top
  if (waterD) {
    svg += `<path d="${waterD}" fill="${WATER_COLOR}" stroke="none"/>\n`;
  }

  svg += '</svg>';

  fs.writeFileSync(OUTPUT_SVG, svg);
  console.log(`Done! ${OUTPUT_SVG} (${(svg.length / 1024).toFixed(0)} KB)`);

  cleanup();
}

run().catch(e => { console.error(e); cleanup(); process.exit(1); });