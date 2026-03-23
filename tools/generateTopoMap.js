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
 * Source image: bin/map.jpg (https://satisfactory.wiki.gg/images/Map.jpg)
 *
 * Usage:
 *   node bin/tools/generateTopoMap.js
 */

const path = require('path');
const fs   = require('fs');
const { loadImage, createCanvas } = require('canvas');
const potrace = require('potrace');

const MAP_JPG    = path.join(__dirname, '..', 'data', 'map.jpg');
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
const TURD_SIZE    = 500;
const OPT_TOL      = 5.0;

async function run() {
  if (!fs.existsSync(MAP_JPG)) {
    console.error('Source image not found:', MAP_JPG);
    console.error('Download it: curl -sL -o bin/map.jpg "https://satisfactory.wiki.gg/images/Map.jpg"');
    process.exit(1);
  }

  const img = await loadImage(MAP_JPG);
  const W = img.width, H = img.height;
  console.log(`Source: ${W}x${H}`);

  // Read pixel data
  const srcCanvas = createCanvas(W, H);
  const srcCtx    = srcCanvas.getContext('2d');
  srcCtx.drawImage(img, 0, 0);
  const srcData = srcCtx.getImageData(0, 0, W, H).data;

  // Classify pixels
  const gray    = new Uint8Array(W * H);
  const isCont  = new Uint8Array(W * H);
  const isWater = new Uint8Array(W * H);

  for (let i = 0; i < W * H; i++) {
    const r = srcData[i * 4], g = srcData[i * 4 + 1], b = srcData[i * 4 + 2];
    const lum = r * 0.3 + g * 0.59 + b * 0.11;
    gray[i] = lum;

    const blueExcess = b - (r + g) / 2;
    isWater[i] = (blueExcess > 10) ? 1 : 0;
    isCont[i]  = (blueExcess < -2 && lum > 15) ? 1 : 0;
  }

  const total  = W * H;
  const wCount = isWater.reduce((s, v) => s + v, 0);
  const cCount = isCont.reduce((s, v) => s + v, 0);
  console.log(`Water: ${(wCount / total * 100).toFixed(1)}%  Continent: ${(cCount / total * 100).toFixed(1)}%  Off-map: ${((total - wCount - cCount) / total * 100).toFixed(1)}%`);

  // --- Trace helper: zone = BLACK pixels → potrace fills the zone ---
  const tmpPath = path.join(__dirname, '..', '_tmp_topo.png');

  function traceBlackMask(maskFn) {
    const c   = createCanvas(W, H);
    const ctx = c.getContext('2d');
    const im  = ctx.createImageData(W, H);
    for (let i = 0; i < W * H; i++) {
      const v = maskFn(i) ? 0 : 255;  // zone = BLACK
      im.data[i * 4]     = v;
      im.data[i * 4 + 1] = v;
      im.data[i * 4 + 2] = v;
      im.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(im, 0, 0);
    fs.writeFileSync(tmpPath, c.toBuffer('image/png'));

    return new Promise((resolve, reject) => {
      potrace.trace(tmpPath, {
        turdSize:     TURD_SIZE,
        threshold:    128,
        optTolerance: OPT_TOL,
      }, (err, svg) => {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
        if (err) return reject(err);
        resolve(svg.match(/<path d="([^"]+)"/)?.[1] || null);
      });
    });
  }

  // --- Trace all layers ---

  // Water
  console.log('Tracing water...');
  const waterD = await traceBlackMask(i => isWater[i]);

  // Continent outline (all continent pixels)
  console.log('Tracing continent...');
  const contD = await traceBlackMask(i => isCont[i]);

  // Altitude levels
  const levelDs = [];
  for (let t = 0; t < LEVELS.length; t++) {
    console.log(`Tracing level ${LEVELS[t]}...`);
    const d = await traceBlackMask(i => isCont[i] && gray[i] >= LEVELS[t]);
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
}

run().catch(e => { console.error(e); process.exit(1); });
