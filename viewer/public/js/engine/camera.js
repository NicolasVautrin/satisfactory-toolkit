import * as THREE from 'three';
import { camera, renderer, requestRender } from './scene.js';

// ── Camera state ────────────────────────────────────────────
// Base sensitivity values are frozen — only modifiable via the setters below.
const DEFAULTS = { flyStep: 2500, panSpeed: 1.5, rotateSpeed: 0.003 };
const LIMITS = {
  flyStep:     { min: 100,    max: 100000 },
  panSpeed:    { min: 0.1,    max: 20 },
  rotateSpeed: { min: 0.0005, max: 0.02 },
};

const _base = { ...DEFAULTS };

export const camState = {
  yaw: -Math.PI / 4,
  pitch: -Math.PI / 6,
  get rotateSpeed() { return _base.rotateSpeed; },
  get panSpeed()    { return _base.panSpeed; },
  get flyStep()     { return _base.flyStep; },
  adaptive: true,
};

export function setFlyStep(v)     { _base.flyStep = Math.max(LIMITS.flyStep.min, Math.min(LIMITS.flyStep.max, v)); }
export function setPanSpeed(v)    { _base.panSpeed = Math.max(LIMITS.panSpeed.min, Math.min(LIMITS.panSpeed.max, v)); }
export function setRotateSpeed(v) { _base.rotateSpeed = Math.max(LIMITS.rotateSpeed.min, Math.min(LIMITS.rotateSpeed.max, v)); }

// ── Change notification ─────────────────────────────────────
let _onChanged = null;
export function onCameraChanged(cb) { _onChanged = cb; }

function notifyChanged() {
  requestRender();
  if (_onChanged) _onChanged();
}

// Adaptive sensitivity: scale values based on camera height
// Reference height = 5000 (where effective = base)
function hRatio() { return Math.max(0.02, Math.abs(camera.position.z) / 5000); }
export function effectiveFlyStep()    { return camState.adaptive ? _base.flyStep * Math.pow(hRatio(), 0.6) : _base.flyStep; }
export function effectivePanSpeed()   { return camState.adaptive ? Math.max(1.5, _base.panSpeed * Math.pow(hRatio(), 0.6)) : _base.panSpeed; }
export function effectiveRotSpeed()   { return camState.adaptive ? _base.rotateSpeed * Math.pow(hRatio(), 0.3) : _base.rotateSpeed; }

// ── Reset camera (also available from console) ──────────────
window._camState = camState;
window._resetCamera = (x, y, z, yaw, pitch) => {
  camera.position.set(x, y, z);
  camState.yaw = yaw ?? -Math.PI / 4;
  camState.pitch = pitch ?? -Math.PI / 6;
  updateCameraRotation();
};

export function updateCameraRotation() {
  const dir = new THREE.Vector3(
    Math.cos(camState.pitch) * Math.sin(camState.yaw),
    Math.cos(camState.pitch) * Math.cos(camState.yaw),
    Math.sin(camState.pitch),
  );
  const target = camera.position.clone().add(dir);
  camera.lookAt(target);
  notifyChanged();
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
  notifyChanged();
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
    const step = effectiveFlyStep() * (e.deltaY < 0 ? 1 : -1);
    camera.position.addScaledVector(fwd, step);
    notifyChanged();
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
      camState.yaw -= dx * effectiveRotSpeed();
      camState.pitch -= dy * effectiveRotSpeed();
      camState.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, camState.pitch));
      updateCameraRotation();
    } else if (activeButton === 2) {
      const fwd = new THREE.Vector3();
      camera.getWorldDirection(fwd);
      const right = new THREE.Vector3().crossVectors(fwd, camera.up).normalize();
      const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
      const scale = effectivePanSpeed() * effectiveFlyStep() / 500;
      camera.position.addScaledVector(right, -dx * scale);
      camera.position.addScaledVector(up, dy * scale);
      notifyChanged();
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
    adaptive: camState.adaptive,
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
    if (s.flyStep) setFlyStep(s.flyStep);
    if (s.panSpeed) setPanSpeed(s.panSpeed);
    if (s.rotateSpeed) setRotateSpeed(s.rotateSpeed);
    if (s.adaptive !== undefined) camState.adaptive = s.adaptive;
    updateCameraRotation();
    return true;
  } catch { return false; }
}
