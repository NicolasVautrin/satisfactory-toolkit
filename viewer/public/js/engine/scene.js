import * as THREE from 'three';

// ── Coordinate transform (Unreal → Viewer) ─────────────────
export function gameToViewer(x, y, z) {
  return new THREE.Vector3(-x, y, z);
}

// ── Constants ───────────────────────────────────────────────
export const CAT_COLORS = [
  0xff8c00, 0x44bb44, 0x4488ff, 0x44dddd,
  0xffdd44, 0xbb44ff, 0x888888, 0xcccccc,
];
export const CAT_NAMES = ['Producers', 'Extractors', 'Belts', 'Pipes', 'Power', 'Railway', 'Structural', 'Other'];
export const HIGHLIGHT_COLOR = new THREE.Color(0xff4444);
export const CBP_COLOR = new THREE.Color(0x44ffcc);
export const DEFAULT_BOX_SIZE = 200;

// ── Three.js core ───────────────────────────────────────────
export const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);

export const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a1a);

export const camera = new THREE.PerspectiveCamera(60, 1, 100, 2000000);
camera.up.set(0, 0, 1);

// ── Lights ──────────────────────────────────────────────────
scene.add(new THREE.AmbientLight(0xffffff, 1.5));
const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
dirLight.position.set(1, 1, 2);
scene.add(dirLight);
const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.5);
dirLight2.position.set(-1, -1, -1);
scene.add(dirLight2);

// ── Init & Resize ───────────────────────────────────────────
let container = null;

export function initRenderer(el) {
  container = el;
  container.appendChild(renderer.domElement);
  resize();
}

export function resize() {
  if (!container) return;
  const w = container.clientWidth;
  const h = container.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

window.addEventListener('resize', resize);
