import * as THREE from 'three';
import { renderer, scene, camera, resize, initRenderer, consumeRender } from './engine/scene.js';
import { camState, initCameraControls, fitCamera, saveCameraState, restoreCameraState } from './engine/camera.js';
import { getSaveData, getCbpData, buildSaveScene, buildCbpScene, setCatVisible, setCbpVisible, setPortsVisible } from './engine/entities.js';
import { selectedIndices, onSelectionChange, clearSelection, removeClassFromSelection } from './engine/selection.js';
import { buildTerrain, setTerrainVisible } from './engine/terrain.js';
import { buildGrid, setGridVisible, adjustGridSpacing, getGridSpacing } from './engine/grid.js';
import { gameToViewer } from './engine/scene.js';

import { createToolbar } from './ui/toolbar.js';
import { createFilters } from './ui/filters.js';
import { createControls } from './ui/controls.js';
import { createSelPanel } from './ui/selPanel.js';
import { createPropsPanel } from './ui/propsPanel.js';
import { isPlacementActive, startPlacement, stopPlacement, handleKey as placementKey, getTransform } from './engine/placement.js';
import { initUpload, uploadFile } from './upload.js';
import { downloadBlob, downloadBase64, filenameFromResponse } from './download.js';
import { initMouseHandlers } from './engine/mouse.js';
import { initWebSocket } from './webSocket.js';

// ── DOM refs ────────────────────────────────────────────────
const loadingEl = document.getElementById('loading');
const canvasEl = document.getElementById('canvas');

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
    merge: !!(getSaveData() && getCbpData()) && !isPlacementActive(),
    refresh: true,
    downloadSave: !!getSaveData(),
  });
}

// ── UI: Toolbar ─────────────────────────────────────────────
const toolbar = createToolbar(document.getElementById('topbar'), {
  onOpen(file) {
    uploadFile(file, { onSaveLoaded, onCbpLoaded, setLoading });
  },
  async onRefresh() {
    setLoading('Refreshing...');
    try {
      const res = await fetch('/api/entities');
      if (!res.ok) { setLoading(null); return; }
      const result = await res.json();
      if (result.save) onSaveLoaded(result.save, result.saveName || getSaveData()?.filename || 'save');
      if (result.cbp) onCbpLoaded(result.cbp, result.cbpName || getCbpData()?.filename || 'cbp');
      if (!result.save && !result.cbp) setLoading(null);
    } catch (err) {
      setLoading('Refresh error: ' + err.message);
    }
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
      const filename = filenameFromResponse(res, 'merged_edit.sav');
      const entityCount = res.headers.get('X-Entity-Count') || '?';
      const totalCount = res.headers.get('X-Total-Count') || '?';
      downloadBlob(blob, filename);
      setLoading(null);
      alert(`Merge complete: ${entityCount} entities (${totalCount} total objects) injected.\nDownloaded: ${filename}`);
    } catch (err) {
      setLoading('Merge error: ' + err.message);
    }
  },
  async onDownloadSave() {
    try {
      const res = await fetch('/api/download-save');
      if (!res.ok) { alert('Download failed'); return; }
      const blob = await res.blob();
      downloadBlob(blob, filenameFromResponse(res, 'save_edit.sav'));
    } catch (err) {
      alert('Download error: ' + err.message);
    }
  },
});

// ── UI: Filters (Layers menu) ───────────────────────────────
createFilters(toolbar.layersMenu, {
  onCategoryToggle: setCatVisible,
  onCbpToggle: setCbpVisible,
  onTerrainToggle: setTerrainVisible,
  onGridToggle: setGridVisible,
  onPortsToggle: setPortsVisible,
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
  async onExport() {
    if (!selectedIndices.size) return;
    const name = prompt('Blueprint name:', 'my_blueprint');
    if (!name) return;
    const res = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ indices: [...selectedIndices], name }),
    });
    const result = await res.json();
    if (!result.success) { alert(`Export failed: ${result.error}`); return; }
    downloadBase64(result.sbp, `${name}.sbp`);
    downloadBase64(result.sbpcfg, `${name}.sbpcfg`);
    const lwMsg = result.lwCount ? ` + ${result.lwCount} lightweight` : '';
    alert(`Blueprint exported: ${result.count} entities${lwMsg}`);
  },
  async onDelete() {
    if (!selectedIndices.size) return;
    if (!confirm(`Delete ${selectedIndices.size} entities from save?`)) return;
    setLoading('Deleting...');
    try {
      const entities = [...selectedIndices].map(index => ({ index, deleted: true }));
      const res = await fetch('/api/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entities }),
      });
      const result = await res.json();
      if (!result.success) { setLoading('Delete error: ' + result.error); return; }
      // Scene rebuild handled by WS 'editResult' message
      clearSelection();
      setLoading(null);
    } catch (err) {
      setLoading('Delete error: ' + err.message);
    }
  },
});

// ── UI: Properties panel ────────────────────────────────────
const propsPanel = createPropsPanel(document.getElementById('props-panel'));

// ── Selection change handler ────────────────────────────────
onSelectionChange(() => {
  updateStatus();
  selPanel.update(selectedIndices, getSaveData());
  // Trigger resize when panel shows/hides
  requestAnimationFrame(resize);
});

// ── Data load handlers ──────────────────────────────────────
function onSaveLoaded(data, filename) {
  data.filename = filename;
  buildSaveScene(data);
  clearSelection();
  if (!restoreCameraState(camKey())) fitCamera(data.entities, gameToViewer);
  setLoading(null);
  updateStatus();
  toolbar.setFileLabel('save', filename);
  controls.updateAll();
}

function onCbpLoaded(data, filename) {
  data.filename = filename;

  // If it's a blueprint (.sbp), start placement mode
  if (filename.endsWith('.sbp')) {
    // Compute camera target position in Unreal coords for initial placement
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const target = camera.position.clone().addScaledVector(fwd, 5000);
    // Viewer → Unreal: flip X back
    const initialPos = { x: -target.x, y: target.y, z: target.z };

    startPlacement(data, initialPos, {
      onMove(transformedData) {
        transformedData.filename = filename;
        buildCbpScene(transformedData);
      },
      async onConfirm() {
        if (!getSaveData()) return;
        setLoading('Injecting...');
        try {
          const t = getTransform();
          const res = await fetch('/api/inject-blueprint', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transform: t }),
          });
          const result = await res.json();
          if (!result.success) { setLoading('Inject error: ' + result.error); return; }
          stopPlacement();
          const d = result.save;
          d.filename = getSaveData()?.filename || '';
          buildSaveScene(d);
          buildCbpScene({ classNames: [], clearance: {}, entities: [] });
          clearSelection();
          setLoading(null);
          updateStatus();
          toolbar.setFileLabel('cbp', '');
        } catch (err) {
          setLoading('Inject error: ' + err.message);
        }
      },
      onCancel() {
        stopPlacement();
        buildCbpScene({ classNames: [], clearance: {}, entities: [] });
        updateStatus();
        toolbar.setFileLabel('cbp', '');
      },
    });

    // Trigger initial build
    setLoading(null);
    updateStatus();
    toolbar.setFileLabel('cbp', filename + ' [placing]');
    return;
  }

  buildCbpScene(data);
  if (!getSaveData() && !restoreCameraState(camKey())) fitCamera(data.entities, gameToViewer);
  setLoading(null);
  updateStatus();
  toolbar.setFileLabel('cbp', filename);
}

// ── Keyboard handler for blueprint placement ────────────────
window.addEventListener('keydown', (e) => {
  // Don't intercept when typing in an input
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (placementKey(e)) {
    e.preventDefault();
    // Update status with current transform
    const t = getTransform();
    toolbar.updateStatus(`Placing: X=${t.tx} Y=${t.ty} Z=${t.tz} Rot=${t.yaw}° | Q/D=X Z/S=Y R/F=Z A/E=Rot`);
  }
});

// ── Init ────────────────────────────────────────────────────
initRenderer(canvasEl);
initCameraControls();
buildGrid();
updateStatus();

// Mouse interaction
initMouseHandlers({ propsPanel });

// Upload (drag & drop)
initUpload({ onSaveLoaded, onCbpLoaded, setLoading });

// Camera persistence
setInterval(() => saveCameraState(camKey()), 3000);

// Auto-refresh if server already has data loaded
fetch('/api/entities')
  .then(r => r.ok ? r.json() : null)
  .then(result => {
    if (result?.save) onSaveLoaded(result.save, result.saveName || 'save');
    if (result?.cbp) onCbpLoaded(result.cbp, result.cbpName || 'cbp');
  })
  .catch(() => {});

// WebSocket
initWebSocket({ onEditResult: () => updateStatus() });

// Load terrain
fetch('/api/terrain')
  .then(r => r.ok ? r.json() : null)
  .then(terrain => { if (terrain) buildTerrain(terrain); })
  .catch(() => {});

// Animation loop (render on demand)
function animate() {
  requestAnimationFrame(animate);
  if (consumeRender()) renderer.render(scene, camera);
}
resize();
animate();
