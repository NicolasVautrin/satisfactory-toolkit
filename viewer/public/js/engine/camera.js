import * as THREE from 'three';
import { camera, renderer } from './scene.js';

// ── Camera state ────────────────────────────────────────────
export const camState = {
  yaw: -Math.PI / 4,
  pitch: -Math.PI / 6,
  rotateSpeed: 0.003,
  panSpeed: 1.5,
  flyStep: 5000,
};

// ── Rotation ────────────────────────────────────────────────
export function updateCameraRotation() {
  const dir = new THREE.Vector3(
    Math.cos(camState.pitch) * Math.sin(camState.yaw),
    Math.cos(camState.pitch) * Math.cos(camState.yaw),
    Math.sin(camState.pitch),
  );
  const target = camera.position.clone().add(dir);
  camera.lookAt(target);
}

// ── Fit camera to bounding box ──────────────────────────────
export function fitCamera(entities, gameToViewer) {
  const bbox = new THREE.Box3();
  for (const e of entities) bbox.expandByPoint(gameToViewer(e.tx, e.ty, e.tz));
  const center = new THREE.Vector3();
  bbox.getCenter(center);
  const size = new THREE.Vector3();
  bbox.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z);

  camera.position.set(
    center.x + maxDim * 0.5, center.y - maxDim * 0.5, center.z + maxDim * 0.3,
  );
  camera.lookAt(center);
  const initDir = new THREE.Vector3();
  camera.getWorldDirection(initDir);
  camState.yaw = Math.atan2(initDir.x, initDir.y);
  camState.pitch = Math.asin(initDir.z);
}

// ── Pointer controls ────────────────────────────────────────
let activeButton = -1;
let lastMouse = null;

export function initCameraControls() {
  const dom = renderer.domElement;

  dom.addEventListener('contextmenu', e => e.preventDefault());

  dom.addEventListener('wheel', (e) => {
    e.preventDefault();
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    const step = camState.flyStep * (e.deltaY < 0 ? 1 : -1);
    camera.position.addScaledVector(fwd, step);
  }, { passive: false });

  dom.addEventListener('pointerdown', (e) => {
    if (e.button === 0 && e.shiftKey) return;
    activeButton = e.button;
    lastMouse = { x: e.clientX, y: e.clientY };
    dom.setPointerCapture(e.pointerId);
  });

  dom.addEventListener('pointermove', (e) => {
    if (activeButton < 0 || !lastMouse) return;
    const dx = e.clientX - lastMouse.x;
    const dy = e.clientY - lastMouse.y;
    lastMouse = { x: e.clientX, y: e.clientY };

    if (activeButton === 0) {
      camState.yaw -= dx * camState.rotateSpeed;
      camState.pitch -= dy * camState.rotateSpeed;
      camState.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, camState.pitch));
      updateCameraRotation();
    } else if (activeButton === 2) {
      const fwd = new THREE.Vector3();
      camera.getWorldDirection(fwd);
      const right = new THREE.Vector3().crossVectors(fwd, camera.up).normalize();
      const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
      const scale = camState.panSpeed * camState.flyStep / 500;
      camera.position.addScaledVector(right, -dx * scale);
      camera.position.addScaledVector(up, dy * scale);
    }
  });

  dom.addEventListener('pointerup', (e) => {
    if (e.button === activeButton) {
      activeButton = -1;
      lastMouse = null;
    }
  });
}

// ── Persistence ─────────────────────────────────────────────
export function saveCameraState(key) {
  if (!key) return;
  const state = {
    x: camera.position.x, y: camera.position.y, z: camera.position.z,
    yaw: camState.yaw, pitch: camState.pitch,
    flyStep: camState.flyStep, panSpeed: camState.panSpeed, rotateSpeed: camState.rotateSpeed,
  };
  localStorage.setItem(`viewer-cam-${key}`, JSON.stringify(state));
}

export function restoreCameraState(key) {
  if (!key) return false;
  const raw = localStorage.getItem(`viewer-cam-${key}`);
  if (!raw) return false;
  try {
    const s = JSON.parse(raw);
    camera.position.set(s.x, s.y, s.z);
    camState.yaw = s.yaw;
    camState.pitch = s.pitch;
    if (s.flyStep) camState.flyStep = s.flyStep;
    if (s.panSpeed) camState.panSpeed = s.panSpeed;
    if (s.rotateSpeed) camState.rotateSpeed = s.rotateSpeed;
    updateCameraRotation();
    return true;
  } catch { return false; }
}
