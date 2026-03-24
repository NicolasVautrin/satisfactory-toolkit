import { renderer, scene, camera, resize, initRenderer } from './engine/scene.js';
import { camState, initCameraControls, fitCamera, saveCameraState, restoreCameraState } from './engine/camera.js';
import { getSaveData, getCbpData, buildSaveScene, buildCbpScene, setCatVisible, setCbpVisible } from './engine/entities.js';
import { selectedIndices, onSelectionChange, pickAt, pickRect, toggleSelection, addSelection, clearSelection, removeClassFromSelection } from './engine/selection.js';
import { buildTerrain, setTerrainVisible } from './engine/terrain.js';
import { buildGrid, setGridVisible, adjustGridSpacing, getGridSpacing } from './engine/grid.js';
import { gameToViewer } from './engine/scene.js';

import { createToolbar } from './ui/toolbar.js';
import { createFilters } from './ui/filters.js';
import { createControls } from './ui/controls.js';
import { createSelPanel } from './ui/selPanel.js';
import { initUpload, uploadFile } from './upload.js';

// ── DOM refs ────────────────────────────────────────────────
const loadingEl = document.getElementById('loading');
const canvasEl = document.getElementById('canvas');
const selRect = document.getElementById('selection-rect');

// ── Loading helper ──────────────────────────────────────────
function setLoading(text) {
  if (text) {
    loadingEl.style.display = '';
    loadingEl.textContent = text;
  } else {
    loadingEl.style.display = 'none';
  }
}

// ── Camera persistence key ──────────────────────────────────
function camKey() {
  return getSaveData() ? 'save' : getCbpData() ? 'cbp' : null;
}

// ── Status update ───────────────────────────────────────────
function updateStatus() {
  const saveCount = getSaveData() ? getSaveData().entities.length : 0;
  const cbpCount = getCbpData() ? getCbpData().entities.length : 0;
  const parts = [];
  if (saveCount) parts.push(`${saveCount} save`);
  if (cbpCount) parts.push(`${cbpCount} cbp`);
  const total = parts.length ? parts.join(' + ') + ' entities' : 'No data';
  toolbar.updateStatus(`${total} | ${selectedIndices.size} selected | Click to select, Shift+drag for box select`);
  toolbar.setButtonStates({
    merge: !!(getSaveData() && getCbpData()),
    export: selectedIndices.size > 0 && !!getSaveData(),
    clear: selectedIndices.size > 0,
  });
}

// ── UI: Toolbar ─────────────────────────────────────────────
const toolbar = createToolbar(document.getElementById('topbar'), {
  onOpen(file) {
    uploadFile(file, { onSaveLoaded, onCbpLoaded, setLoading });
  },
  async onMerge() {
    if (!confirm('Merge CBP into save? This will download a new _edit.sav file.')) return;
    setLoading('Merging CBP into save...');
    try {
      const res = await fetch('/api/merge', { method: 'POST' });
      if (!res.ok) {
        const err = await res.json();
        setLoading('Merge error: ' + err.error);
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') || '';
      const match = disposition.match(/filename="(.+)"/);
      const filename = match ? match[1] : 'merged_edit.sav';
      const entityCount = res.headers.get('X-Entity-Count') || '?';
      const totalCount = res.headers.get('X-Total-Count') || '?';

      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);

      setLoading(null);
      alert(`Merge complete: ${entityCount} entities (${totalCount} total objects) injected.\nDownloaded: ${filename}`);
    } catch (err) {
      setLoading('Merge error: ' + err.message);
    }
  },
  async onExport() {
    const name = prompt('Blueprint name:', 'my_blueprint');
    if (!name) return;
    const res = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ indices: [...selectedIndices], name }),
    });
    const result = await res.json();
    if (!result.success) {
      alert(`Export failed: ${result.error}`);
      return;
    }
    // Download .sbp
    const sbpBlob = new Blob([Uint8Array.from(atob(result.sbp), c => c.charCodeAt(0))]);
    const sbpUrl = URL.createObjectURL(sbpBlob);
    const a1 = document.createElement('a');
    a1.href = sbpUrl; a1.download = `${name}.sbp`; a1.click();
    URL.revokeObjectURL(sbpUrl);

    // Download .sbpcfg
    const cfgBlob = new Blob([Uint8Array.from(atob(result.sbpcfg), c => c.charCodeAt(0))]);
    const cfgUrl = URL.createObjectURL(cfgBlob);
    const a2 = document.createElement('a');
    a2.href = cfgUrl; a2.download = `${name}.sbpcfg`; a2.click();
    URL.revokeObjectURL(cfgUrl);

    const lwMsg = result.lwCount ? ` + ${result.lwCount} lightweight` : '';
    alert(`Blueprint exported: ${result.count} entities${lwMsg}\nDownloaded: ${name}.sbp + ${name}.sbpcfg`);
  },
  onClear() {
    clearSelection();
  },
});

// ── UI: Filters (Layers menu) ───────────────────────────────
createFilters(toolbar.layersMenu, {
  onCategoryToggle: setCatVisible,
  onCbpToggle: setCbpVisible,
  onTerrainToggle: setTerrainVisible,
  onGridToggle: setGridVisible,
});

// ── UI: Controls (Camera menu) ──────────────────────────────
const controls = createControls(toolbar.cameraMenu, {
  camState,
  onGridSpacingChange(dir) {
    if (dir === 0) return getGridSpacing();
    return adjustGridSpacing(dir);
  },
});

// ── UI: Selection panel ─────────────────────────────────────
const selPanel = createSelPanel(document.getElementById('sel-panel'), {
  onRemoveClass: removeClassFromSelection,
  onClear: clearSelection,
});

// ── Selection change handler ────────────────────────────────
onSelectionChange(() => {
  updateStatus();
  selPanel.update(selectedIndices, getSaveData());
  // Trigger resize when panel shows/hides
  requestAnimationFrame(resize);
});

// ── Data load handlers ──────────────────────────────────────
function onSaveLoaded(data, filename) {
  buildSaveScene(data);
  clearSelection();
  if (!restoreCameraState(camKey())) fitCamera(data.entities, gameToViewer);
  setLoading(null);
  updateStatus();
  toolbar.setFileLabel('save', filename);
  controls.updateAll();
}

function onCbpLoaded(data, filename) {
  buildCbpScene(data);
  if (!getSaveData() && !restoreCameraState(camKey())) fitCamera(data.entities, gameToViewer);
  setLoading(null);
  updateStatus();
  toolbar.setFileLabel('cbp', filename);
}

// ── Mouse interaction (selection) ───────────────────────────
let dragStart = null;
let isDragging = false;
let pointerDownPos = null;
const CLICK_THRESHOLD = 5;

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  pointerDownPos = { x: e.clientX, y: e.clientY };
  if (e.shiftKey) {
    isDragging = true;
    dragStart = { x: e.clientX, y: e.clientY };
    selRect.style.display = 'block';
    selRect.style.left = e.clientX + 'px';
    selRect.style.top = e.clientY + 'px';
    selRect.style.width = '0px';
    selRect.style.height = '0px';
    e.preventDefault();
  }
});

window.addEventListener('pointermove', (e) => {
  if (!isDragging) return;
  const x = Math.min(dragStart.x, e.clientX);
  const y = Math.min(dragStart.y, e.clientY);
  selRect.style.left = x + 'px';
  selRect.style.top = y + 'px';
  selRect.style.width = Math.abs(e.clientX - dragStart.x) + 'px';
  selRect.style.height = Math.abs(e.clientY - dragStart.y) + 'px';
});

window.addEventListener('pointerup', (e) => {
  if (isDragging) {
    isDragging = false;
    selRect.style.display = 'none';

    const rect = renderer.domElement.getBoundingClientRect();
    const x1 = Math.round(Math.min(dragStart.x, e.clientX) - rect.left);
    const y1 = Math.round(Math.min(dragStart.y, e.clientY) - rect.top);
    const x2 = Math.round(Math.max(dragStart.x, e.clientX) - rect.left);
    const y2 = Math.round(Math.max(dragStart.y, e.clientY) - rect.top);

    if (x2 - x1 > 2 && y2 - y1 > 2) {
      const found = pickRect(x1, y1, x2, y2);
      if (!e.ctrlKey) selectedIndices.clear();
      addSelection(found);
    }
    dragStart = null;
    return;
  }

  if (e.button === 0 && !e.shiftKey && pointerDownPos) {
    const dx = Math.abs(e.clientX - pointerDownPos.x);
    const dy = Math.abs(e.clientY - pointerDownPos.y);
    if (dx < CLICK_THRESHOLD && dy < CLICK_THRESHOLD) {
      const rect = renderer.domElement.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const idx = pickAt(x, y);
      if (idx >= 0) toggleSelection(idx);
    }
    pointerDownPos = null;
  }
});

// ── Init ────────────────────────────────────────────────────
initRenderer(canvasEl);
initCameraControls();
buildGrid();

// Upload (drag & drop)
initUpload({ onSaveLoaded, onCbpLoaded, setLoading });

// Camera persistence
setInterval(() => saveCameraState(camKey()), 3000);

// Load terrain
fetch('/api/terrain')
  .then(r => r.ok ? r.json() : null)
  .then(terrain => { if (terrain) buildTerrain(terrain); })
  .catch(() => {});

// Animation loop
function animate() {
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
}
resize();
animate();
