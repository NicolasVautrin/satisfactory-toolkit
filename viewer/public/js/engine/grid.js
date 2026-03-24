import * as THREE from 'three';
import { scene, gameToViewer } from './scene.js';

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

  const gridMat = new THREE.LineBasicMaterial({ color: GRID_COLOR, transparent: true, opacity: 0.2 });
  const xMat = new THREE.LineBasicMaterial({ color: AXIS_COLORS.x, transparent: true, opacity: 0.5 });
  const yMat = new THREE.LineBasicMaterial({ color: AXIS_COLORS.y, transparent: true, opacity: 0.5 });
  const zMat = new THREE.LineBasicMaterial({ color: AXIS_COLORS.z, transparent: true, opacity: 0.5 });

  function addLine(p1, p2, mat) {
    const geom = new THREE.BufferGeometry().setFromPoints([
      gameToViewer(p1[0], p1[1], p1[2]),
      gameToViewer(p2[0], p2[1], p2[2]),
    ]);
    gridGroup.add(new THREE.Line(geom, mat));
  }

  for (let x = xStart; x <= xMax; x += step) {
    addLine([x, yMin, zMin], [x, yMax, zMin], x === 0 ? yMat : gridMat);
  }
  for (let y = yStart; y <= yMax; y += step) {
    addLine([xMin, y, zMin], [xMax, y, zMin], y === 0 ? xMat : gridMat);
  }

  for (let x = xStart; x <= xMax; x += step) {
    addLine([x, yMin, zMin], [x, yMin, zMax], gridMat);
  }
  for (let z = zStart; z <= zMax; z += step) {
    addLine([xMin, yMin, z], [xMax, yMin, z], z === 0 ? xMat : gridMat);
  }

  for (let y = yStart; y <= yMax; y += step) {
    addLine([xMin, y, zMin], [xMin, y, zMax], gridMat);
  }
  for (let z = zStart; z <= zMax; z += step) {
    addLine([xMin, yMin, z], [xMin, yMax, z], z === 0 ? yMat : gridMat);
  }

  addLine([xMin, yMin, zMin], [xMax, yMin, zMin], xMat);
  addLine([xMin, yMin, zMin], [xMin, yMax, zMin], yMat);
  addLine([xMin, yMin, zMin], [xMin, yMin, zMax], zMat);

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
}
