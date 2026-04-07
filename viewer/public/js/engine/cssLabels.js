import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { scene, gameToViewer, requestRender } from './scene.js';

// ── State ───────────────────────────────────────────────
let cssRenderer = null;
const labelObjects = [];  // CSS2DObject instances in scene
let visible = true;
let fontSize = 11;  // default font size in px

// ── Init CSS2D renderer overlay ─────────────────────────
export function initCssRenderer(container) {
  cssRenderer = new CSS2DRenderer();
  cssRenderer.setSize(container.clientWidth, container.clientHeight);
  cssRenderer.domElement.id = 'css-labels';
  cssRenderer.domElement.style.position = 'absolute';
  cssRenderer.domElement.style.top = '0';
  cssRenderer.domElement.style.left = '0';
  cssRenderer.domElement.style.pointerEvents = 'none';
  container.style.position = 'relative';
  container.appendChild(cssRenderer.domElement);
}

// ── Resize (call alongside WebGL resize) ────────────────
export function resizeCssRenderer(w, h) {
  if (cssRenderer) cssRenderer.setSize(w, h);
}

// ── Build labels from entity data ───────────────────────
// Reads item.lb (label string) directly from entities array.
// Works both at initial load and after WebSocket editResult updates.
export function buildCssLabels(entityData) {
  clearCssLabels();
  if (!entityData?.entities) return;

  for (let i = 0; i < entityData.entities.length; i++) {
    const e = entityData.entities[i];
    if (!e || !e.cssLb) continue;

    const div = document.createElement('div');
    div.className = 'css-label';
    div.style.fontSize = fontSize + 'px';
    div.textContent = e.lb;

    const obj = new CSS2DObject(div);
    const pos = gameToViewer(e.tx, e.ty, e.tz);
    obj.position.copy(pos);
    obj.userData._cssLabel = true;

    scene.add(obj);
    labelObjects.push(obj);
  }

  if (!visible) setCssLabelsVisible(false);
}

// ── Clear ───────────────────────────────────────────────
export function clearCssLabels() {
  for (const obj of labelObjects) {
    scene.remove(obj);
    if (obj.element?.parentNode) obj.element.parentNode.removeChild(obj.element);
  }
  labelObjects.length = 0;
}

// ── Visibility ──────────────────────────────────────────
export function setCssLabelsVisible(v) {
  visible = v;
  for (const obj of labelObjects) obj.visible = v;
  requestRender();
}

export function isCssLabelsVisible() { return visible; }

// ── Font size ───────────────────────────────────────────
export function getLabelFontSize() { return fontSize; }

export function setLabelFontSize(size) {
  fontSize = Math.max(6, Math.min(24, size));
  for (const obj of labelObjects) {
    obj.element.style.fontSize = fontSize + 'px';
  }
  requestRender();
}

// ── Render (call in animation loop) ─────────────────────
export function renderCssLabels(camera) {
  if (cssRenderer && visible) cssRenderer.render(scene, camera);
}
