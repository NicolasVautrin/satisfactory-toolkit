import * as THREE from 'three';
import { scene, gameToViewer, requestRender } from './scene.js';

const GRID_COLOR = 0x888888;
const EDGE_COLOR = 0xffaa00;
const GRID_STEP = 800;
const PADDING = 800;

// entityIndex → { group, entityIndex, entityData }
const activeGrids = new Map();

// Alignment mode: 'entity' (follows entity rotation) or 'world' (axis-aligned)
let gridBoxAlign = localStorage.getItem('viewer_gridBoxAlign') || 'entity';

export function getGridBoxAlign() { return gridBoxAlign; }

export function setGridBoxAlign(mode) {
  gridBoxAlign = mode;
  localStorage.setItem('viewer_gridBoxAlign', mode);
  // Rebuild all active gridboxes
  const entries = [...activeGrids.entries()];
  for (const [idx, { entityData }] of entries) {
    removeGrid(idx);
    addGrid(idx, entityData);
  }
}

export function hasGrid(entityIndex) {
  return activeGrids.has(entityIndex);
}

export function toggleGrid(entityIndex, entityData) {
  if (activeGrids.has(entityIndex)) {
    removeGrid(entityIndex);
    return false;
  } else {
    addGrid(entityIndex, entityData);
    return true;
  }
}

export function removeGrid(entityIndex) {
  const entry = activeGrids.get(entityIndex);
  if (entry) {
    scene.remove(entry.group);
    activeGrids.delete(entityIndex);
    requestRender();
  }
}

export function removeAllGrids() {
  for (const [idx, entry] of activeGrids) {
    scene.remove(entry.group);
  }
  activeGrids.clear();
  requestRender();
}

function addGrid(entityIndex, entityData) {
  const e = entityData.entities[entityIndex];
  if (!e) return;

  // Get entity clearance box(es) for sizing
  const boxes = entityData.clearance?.[e.c];
  let xMin, xMax, yMin, yMax, zMin, zMax;

  if (e.box) {
    xMin = e.box.min.x; xMax = e.box.max.x;
    yMin = e.box.min.y; yMax = e.box.max.y;
    zMin = e.box.min.z; zMax = e.box.max.z;
  } else if (boxes && boxes.length > 0) {
    xMin = Infinity; xMax = -Infinity;
    yMin = Infinity; yMax = -Infinity;
    zMin = Infinity; zMax = -Infinity;
    for (const b of boxes) {
      const ox = b.rt ? b.rt.x : 0, oy = b.rt ? b.rt.y : 0, oz = b.rt ? b.rt.z : 0;
      if (b.min.x + ox < xMin) xMin = b.min.x + ox;
      if (b.max.x + ox > xMax) xMax = b.max.x + ox;
      if (b.min.y + oy < yMin) yMin = b.min.y + oy;
      if (b.max.y + oy > yMax) yMax = b.max.y + oy;
      if (b.min.z + oz < zMin) zMin = b.min.z + oz;
      if (b.max.z + oz > zMax) zMax = b.max.z + oz;
    }
  } else {
    // Default size
    xMin = -400; xMax = 400;
    yMin = -400; yMax = 400;
    zMin = -200; zMax = 200;
  }

  // Snap outward to grid
  const G = GRID_STEP;
  xMin = Math.floor(xMin / G) * G - PADDING;
  xMax = Math.ceil(xMax / G) * G + PADDING;
  yMin = Math.floor(yMin / G) * G - PADDING;
  yMax = Math.ceil(yMax / G) * G + PADDING;
  zMin = Math.floor(zMin / G) * G - PADDING;
  zMax = Math.ceil(zMax / G) * G + PADDING;

  const group = new THREE.Group();
  const gridPts = [];
  const edgePts = [];

  function pushLine(arr, ax, ay, az, bx, by, bz) {
    arr.push(ax, ay, az, bx, by, bz);
  }

  // Build grid in local space (viewer coords, X flipped)
  function lv(x, y, z) { return [-x, y, z]; }

  for (let y = yMin; y <= yMax; y += G) {
    for (let z = zMin; z <= zMax; z += G) {
      const isEdge = (y === yMin || y === yMax) || (z === zMin || z === zMax);
      const a = lv(xMin, y, z), b = lv(xMax, y, z);
      pushLine(isEdge ? edgePts : gridPts, ...a, ...b);
    }
  }
  for (let x = xMin; x <= xMax; x += G) {
    for (let z = zMin; z <= zMax; z += G) {
      const isEdge = (x === xMin || x === xMax) || (z === zMin || z === zMax);
      const a = lv(x, yMin, z), b = lv(x, yMax, z);
      pushLine(isEdge ? edgePts : gridPts, ...a, ...b);
    }
  }
  for (let x = xMin; x <= xMax; x += G) {
    for (let y = yMin; y <= yMax; y += G) {
      const isEdge = (x === xMin || x === xMax) || (y === yMin || y === yMax);
      const a = lv(x, y, zMin), b = lv(x, y, zMax);
      pushLine(isEdge ? edgePts : gridPts, ...a, ...b);
    }
  }

  function addBatch(pts, color, opacity) {
    if (pts.length === 0) return;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
    group.add(new THREE.LineSegments(geom, mat));
  }

  addBatch(gridPts, GRID_COLOR, 0.1);
  addBatch(edgePts, EDGE_COLOR, 0.3);

  const pos = gameToViewer(e.tx, e.ty, e.tz);
  group.position.copy(pos);

  if (gridBoxAlign === 'entity') {
    // GridBox aligned with entity axes
    group.quaternion.set(e.rx, -e.ry, -e.rz, e.rw);
  }
  // else: world aligned — no rotation (default)

  scene.add(group);
  activeGrids.set(entityIndex, { group, entityData });
  requestRender();
}
