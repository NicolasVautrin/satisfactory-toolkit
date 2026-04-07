import * as THREE from 'three';
import { scene, gameToViewer, gameToViewerQuat, requestRender } from './scene.js';

// ── State ───────────────────────────────────────────────
const labelMeshes = [];  // Mesh instances in scene
let labelsVisible = true;

// Panel transform relative to station center, in UE space (cm, UE axes)
const PANEL_OFFSET_UE = { x: -400, y: 0, z: 1500 };
// Local rotation: PlaneGeo (normal=+Z, width=X, height=Y) → panel vertical facing along track
const PANEL_LOCAL_ROT_UE = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, Math.PI / 2, 0));

// Panel size in UE units
const PANEL_WIDTH = 2000;
const PANEL_HEIGHT = 250;

// Canvas dimensions (pixels)
const CANVAS_W = 512;
const CANVAS_H = 64;

// Shared geometry (created once)
const _planeGeo = new THREE.PlaneGeometry(PANEL_WIDTH, PANEL_HEIGHT);

// ── Create canvas texture for a label ───────────────────
function createLabelTexture(text) {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // Border
  ctx.strokeStyle = 'rgba(187, 68, 255, 0.8)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, CANVAS_W - 2, CANVAS_H - 2);

  // Adaptive font size
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let fontSize = 48;
  do {
    ctx.font = `bold ${fontSize}px monospace`;
    if (ctx.measureText(text).width <= CANVAS_W - 20) break;
    fontSize -= 2;
  } while (fontSize > 12);

  ctx.fillText(text, CANVAS_W / 2, CANVAS_H / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

// ── Build station labels from entity data ───────────────
export function buildStationLabels(entityData) {
  clearStationLabels();
  if (!entityData?.stationLabels) return;

  const _offset = new THREE.Vector3();
  const _quat = new THREE.Quaternion();
  const _flipY = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);

  for (const { ei, name } of entityData.stationLabels) {
    const e = entityData.entities[ei];
    if (!e) continue;

    // Station quaternion in viewer space
    _quat.copy(gameToViewerQuat(e.rx, e.ry, e.rz, e.rw));

    // Compute world position: station pos + offset (UE) rotated by station quat
    _offset.copy(gameToViewer(PANEL_OFFSET_UE.x, PANEL_OFFSET_UE.y, PANEL_OFFSET_UE.z));
    _offset.applyQuaternion(_quat);
    const pos = gameToViewer(e.tx, e.ty, e.tz);
    pos.add(_offset);

    // Create texture
    const texture = createLabelTexture(name);
    const material = new THREE.MeshBasicMaterial({ map: texture });

    // Front face
    const frontQuat = _quat.clone().multiply(PANEL_LOCAL_ROT_UE);
    const front = new THREE.Mesh(_planeGeo, material);
    front.position.copy(pos);
    front.quaternion.copy(frontQuat);
    front.userData.cat = 5;
    scene.add(front);
    labelMeshes.push(front);

    // Back face (flipped 180° around local Y, own offset)
    _offset.copy(gameToViewer(PANEL_OFFSET_UE.x + 50, PANEL_OFFSET_UE.y, PANEL_OFFSET_UE.z));
    _offset.applyQuaternion(_quat);
    const backPos = gameToViewer(e.tx, e.ty, e.tz);
    backPos.add(_offset);

    const back = new THREE.Mesh(_planeGeo, material);
    back.position.copy(backPos);
    back.quaternion.copy(frontQuat).multiply(_flipY);
    back.userData.cat = 5;
    scene.add(back);
    labelMeshes.push(back);
  }
}

// ── Clear ───────────────────────────────────────────────
export function clearStationLabels() {
  for (const mesh of labelMeshes) {
    scene.remove(mesh);
    if (mesh.material.map) mesh.material.map.dispose();
    mesh.material.dispose();
  }
  labelMeshes.length = 0;
}

// ── Visibility ──────────────────────────────────────────
export function setLabelsVisible(visible) {
  labelsVisible = visible;
  for (const mesh of labelMeshes) mesh.visible = visible;
  requestRender();
}

export function isLabelsVisible() { return labelsVisible; }
