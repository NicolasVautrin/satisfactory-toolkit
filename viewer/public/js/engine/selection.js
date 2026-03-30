import * as THREE from 'three';
import { camera, renderer, gameToViewer, CAT_NAMES, HIGHLIGHT_COLOR, requestRender } from './scene.js';
import { getSaveData, getDisplayMeshes, getPortMeshes, getCatVisible, isPortsVisible } from './entities.js';
import { pickLandscapeAt } from './landscape.js';

// ── State ───────────────────────────────────────────────────
export const selectedIndices = new Set();

// ── Change callback ─────────────────────────────────────────
let _onChange = null;
export function onSelectionChange(cb) { _onChange = cb; }

function notify() { if (_onChange) _onChange(); }

// ── Raycaster picking ───────────────────────────────────────
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

export function pickAt(cssX, cssY) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = (cssX / rect.width) * 2 - 1;
  pointer.y = -(cssY / rect.height) * 2 + 1;

  raycaster.setFromCamera(pointer, camera);
  const displayMeshes = getDisplayMeshes();
  const intersects = raycaster.intersectObjects(displayMeshes, false);
  const catVisible = getCatVisible();
  const saveData = getSaveData();

  if (intersects.length === 0) return -1;

  for (const hit of intersects) {
    const { cat, instanceToEntity } = hit.object.userData;
    if (!catVisible[cat]) continue;
    const ei = instanceToEntity[hit.instanceId ?? 0];
    const e = saveData.entities[ei];
    if (!e) continue;
    console.log(`[pick] entity=${ei} class=${saveData.classNames[e.c]} cat=${CAT_NAMES[e.cat]}`);
    return ei;
  }
  return -1;
}

// ── Port picking (inspect only, no selection) ───────────────
export function pickPortAt(cssX, cssY) {
  if (!isPortsVisible()) return -1;
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = (cssX / rect.width) * 2 - 1;
  pointer.y = -(cssY / rect.height) * 2 + 1;

  raycaster.setFromCamera(pointer, camera);
  const portMeshes = getPortMeshes();
  const intersects = raycaster.intersectObjects(portMeshes, false);
  const catVisible = getCatVisible();

  for (const hit of intersects) {
    const { cat, instanceToEntity } = hit.object.userData;
    if (!catVisible[cat]) continue;
    return instanceToEntity[hit.instanceId ?? 0];
  }
  return -1;
}

// ── Environment picking (landscape + water + scenery — closest hit) ──
export function pickEnvironmentAt(cssX, cssY) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = (cssX / rect.width) * 2 - 1;
  pointer.y = -(cssY / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);

  const candidates = [];

  const landscapeHit = pickLandscapeAt(raycaster);
  if (landscapeHit) candidates.push({ distance: landscapeHit.distance, type: 'landscape', data: landscapeHit });

  const sceneryGroup = window._sceneryGroup;
  if (sceneryGroup?.visible) {
    const hits = raycaster.intersectObjects(sceneryGroup.children, false);
    if (hits.length > 0) candidates.push({ distance: hits[0].distance, type: 'scenery', raw: hits[0] });
  }

  const waterGroup = window._waterGroup;
  if (waterGroup?.visible) {
    const hits = raycaster.intersectObjects(waterGroup.children, false);
    if (hits.length > 0) candidates.push({ distance: hits[0].distance, type: 'water', raw: hits[0] });
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.distance - b.distance);
  const best = candidates[0];

  if (best.type === 'landscape') {
    const p = best.data.point;
    console.log(`[pick landscape] tile=${best.data.key} UE=(${-p.x|0}, ${p.y|0}, ${p.z|0})`);
    return { type: 'landscape', key: best.data.key, point: p, distance: best.distance };
  }

  const hit = best.raw;
  const name = hit.object.name || 'unknown';
  const instanceId = hit.instanceId ?? 0;
  const p = hit.point;
  console.log(`[pick ${best.type}] mesh=${name} instance=${instanceId}/${hit.object.count} dist=${Math.round(hit.distance)} UE=(${-p.x|0}, ${p.y|0}, ${p.z|0})`);
  return { type: best.type, name, instanceId, point: p, distance: best.distance };
}

// ── Box select ──────────────────────────────────────────────
export function pickRect(x1, y1, x2, y2) {
  const rect = renderer.domElement.getBoundingClientRect();
  const w = rect.width, h = rect.height;
  const ndcL = (x1 / w) * 2 - 1, ndcR = (x2 / w) * 2 - 1;
  const ndcT = -(y1 / h) * 2 + 1, ndcB = -(y2 / h) * 2 + 1;

  const found = new Set();
  const vec = new THREE.Vector3();
  const saveData = getSaveData();
  if (!saveData) return found;
  const entities = saveData.entities;
  const catVisible = getCatVisible();

  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    if (!catVisible[e.cat]) continue;
    vec.copy(gameToViewer(e.tx, e.ty, e.tz));
    vec.project(camera);
    if (vec.z > -1 && vec.z < 1 && vec.x >= ndcL && vec.x <= ndcR && vec.y >= ndcB && vec.y <= ndcT) {
      found.add(i);
    }
  }
  return found;
}

// ── Selection operations ────────────────────────────────────
export function toggleSelection(entityIdx) {
  if (selectedIndices.has(entityIdx)) {
    selectedIndices.delete(entityIdx);
  } else {
    selectedIndices.add(entityIdx);
  }
  refreshColors();
}

export function addSelection(indices) {
  for (const idx of indices) selectedIndices.add(idx);
  refreshColors();
}

export function clearSelection() {
  selectedIndices.clear();
  refreshColors();
}

export function removeClassFromSelection(className) {
  const saveData = getSaveData();
  if (!saveData) return;
  for (const idx of [...selectedIndices]) {
    const e = saveData.entities[idx];
    if (saveData.classNames[e.c] === className) selectedIndices.delete(idx);
  }
  refreshColors();
}

// ── Refresh instance colors ─────────────────────────────────
export function refreshColors() {
  const color = new THREE.Color();
  const displayMeshes = getDisplayMeshes();
  for (const mesh of displayMeshes) {
    const { instanceToEntity, baseColor } = mesh.userData;
    const arr = mesh.instanceColor.array;
    for (let j = 0; j < instanceToEntity.length; j++) {
      const ei = instanceToEntity[j];
      const sel = selectedIndices.has(ei);
      color.copy(sel ? HIGHLIGHT_COLOR : baseColor);
      arr[j * 3] = color.r;
      arr[j * 3 + 1] = color.g;
      arr[j * 3 + 2] = color.b;
    }
    mesh.instanceColor.needsUpdate = true;
  }
  requestRender();
  notify();
}
