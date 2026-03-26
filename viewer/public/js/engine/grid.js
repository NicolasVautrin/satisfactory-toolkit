import * as THREE from 'three';
import { scene, gameToViewer, requestRender } from './scene.js';

// ── Constants ───────────────────────────────────────────────
const GRID_BOUNDS = {
  xMin: -324699, xMax: 425302,
  yMin: -375000, yMax: 375000,
  zMin: -25000,  zMax: 200000,
};
const AXIS_COLORS = { x: 0xff4444, y: 0x44ff44, z: 0x4488ff };
const GRID_COLOR = 0x444444;
const LABEL_COLOR = '#aaaaaa';

// ── State ───────────────────────────────────────────────────
let gridGroup = null;
let gridSpacing = 10000;

export function getGridSpacing() { return gridSpacing; }

export function setGridVisible(visible) {
  if (gridGroup) gridGroup.visible = visible;
  requestRender();
}

export function setGridSpacing(spacing) {
  gridSpacing = spacing;
  buildGrid();
}

export function adjustGridSpacing(direction) {
  if (direction > 0) {
    gridSpacing = Math.min(100000, gridSpacing * 2);
  } else {
    gridSpacing = Math.max(1000, gridSpacing / 2);
  }
  buildGrid();
  return gridSpacing;
}

// ── Build grid ──────────────────────────────────────────────
export function buildGrid() {
  if (gridGroup) scene.remove(gridGroup);
  gridGroup = new THREE.Group();

  const { xMin, xMax, yMin, yMax, zMin, zMax } = GRID_BOUNDS;
  const step = gridSpacing;

  const xStart = Math.ceil(xMin / step) * step;
  const yStart = Math.ceil(yMin / step) * step;
  const zStart = Math.ceil(zMin / step) * step;

  const gridPts = [];
  const xAxisPts = [];
  const yAxisPts = [];
  const zAxisPts = [];

  function addPt(arr, x1, y1, z1, x2, y2, z2) {
    const v1 = gameToViewer(x1, y1, z1);
    const v2 = gameToViewer(x2, y2, z2);
    arr.push(v1.x, v1.y, v1.z, v2.x, v2.y, v2.z);
  }

  // Floor (XY at zMin)
  for (let x = xStart; x <= xMax; x += step) {
    addPt(x === 0 ? yAxisPts : gridPts, x, yMin, zMin, x, yMax, zMin);
  }
  for (let y = yStart; y <= yMax; y += step) {
    addPt(y === 0 ? xAxisPts : gridPts, xMin, y, zMin, xMax, y, zMin);
  }

  // Back wall (XZ at yMin)
  for (let x = xStart; x <= xMax; x += step) {
    addPt(gridPts, x, yMin, zMin, x, yMin, zMax);
  }
  for (let z = zStart; z <= zMax; z += step) {
    addPt(z === 0 ? xAxisPts : gridPts, xMin, yMin, z, xMax, yMin, z);
  }

  // Left wall (YZ at xMin)
  for (let y = yStart; y <= yMax; y += step) {
    addPt(gridPts, xMin, y, zMin, xMin, y, zMax);
  }
  for (let z = zStart; z <= zMax; z += step) {
    addPt(z === 0 ? yAxisPts : gridPts, xMin, yMin, z, xMin, yMax, z);
  }

  // Axes
  addPt(xAxisPts, xMin, yMin, zMin, xMax, yMin, zMin);
  addPt(yAxisPts, xMin, yMin, zMin, xMin, yMax, zMin);
  addPt(zAxisPts, xMin, yMin, zMin, xMin, yMin, zMax);

  function addBatch(pts, color, opacity) {
    if (pts.length === 0) return;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
    gridGroup.add(new THREE.LineSegments(geom, mat));
  }

  addBatch(gridPts, GRID_COLOR, 0.4);
  addBatch(xAxisPts, AXIS_COLORS.x, 0.5);
  addBatch(yAxisPts, AXIS_COLORS.y, 0.5);
  addBatch(zAxisPts, AXIS_COLORS.z, 0.5);

  // ── Labels ──────────────────────────────────────────────
  function makeLabel(text, position, color) {
    const canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 32;
    const ctx = canvas.getContext('2d');
    ctx.font = '20px monospace';
    ctx.fillStyle = color || LABEL_COLOR;
    ctx.textAlign = 'center';
    ctx.fillText(text, 64, 22);
    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.position.copy(gameToViewer(position[0], position[1], position[2]));
    sprite.scale.set(step * 0.8, step * 0.2, 1);
    gridGroup.add(sprite);
  }

  for (let x = xStart; x <= xMax; x += step) {
    makeLabel((x / 1000).toFixed(0) + 'k', [x, yMin - step * 0.4, zMin], '#ff6666');
  }
  for (let y = yStart; y <= yMax; y += step) {
    makeLabel((y / 1000).toFixed(0) + 'k', [xMin - step * 0.4, y, zMin], '#66ff66');
  }
  for (let z = zStart; z <= zMax; z += step) {
    makeLabel((z / 1000).toFixed(0) + 'k', [xMin - step * 0.4, yMin, z], '#6688ff');
  }

  makeLabel('X', [xMax + step * 0.5, yMin, zMin], '#ff4444');
  makeLabel('Y', [xMin, yMax + step * 0.5, zMin], '#44ff44');
  makeLabel('Z', [xMin, yMin, zMax + step * 0.5], '#4488ff');

  scene.add(gridGroup);
  requestRender();
}
