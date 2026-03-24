import { CAT_COLORS, CAT_NAMES } from '../engine/scene.js';
import { refreshIcons } from './icons.js';
import { toggleGrid, hasGrid } from '../engine/entityGrid.js';

// ── Properties panel (left side) ─────────────────────────────

export function createPropsPanel(container) {
  container.innerHTML = `
    <div id="props-panel-header">
      <strong>Properties</strong>
      <span>
        <button id="btn-grid-props" title="Toggle grid box"><i data-lucide="grid-3x3" class="icon"></i></button>
        <button id="btn-copy-props" title="Copy to clipboard"><i data-lucide="clipboard-copy" class="icon"></i></button>
        <button id="btn-close-props"><i data-lucide="x" class="icon"></i></button>
      </span>
    </div>
    <div id="props-panel-content"></div>
  `;

  container.querySelector('#btn-close-props').addEventListener('click', () => {
    container.classList.remove('visible');
  });

  let currentSerializedProps = '';
  let currentEntityIndex = -1;
  let currentEntityData = null;

  refreshIcons(container);

  const gridBtn = container.querySelector('#btn-grid-props');
  gridBtn.addEventListener('click', () => {
    if (currentEntityIndex < 0 || !currentEntityData) return;
    const active = toggleGrid(currentEntityIndex, currentEntityData);
    gridBtn.classList.toggle('active', active);
  });

  const copyBtn = container.querySelector('#btn-copy-props');
  copyBtn.addEventListener('click', () => {
    if (!currentSerializedProps) return;
    navigator.clipboard.writeText(currentSerializedProps).then(() => {
      copyBtn.innerHTML = '<i data-lucide="check" class="icon"></i>';
      refreshIcons(copyBtn);
      setTimeout(() => {
        copyBtn.innerHTML = '<i data-lucide="clipboard-copy" class="icon"></i>';
        refreshIcons(copyBtn);
      }, 1000);
    });
  });

  const contentDiv = container.querySelector('#props-panel-content');

  return {
    show(entityIndex, entityData) {
      if (entityIndex < 0 || !entityData) {
        container.classList.remove('visible');
        currentEntityIndex = -1;
        currentEntityData = null;
        return;
      }

      const e = entityData.entities[entityIndex];
      const cls = entityData.classNames[e.c];
      const catColor = '#' + CAT_COLORS[e.cat].toString(16).padStart(6, '0');
      const catName = CAT_NAMES[e.cat] || 'Other';
      const filename = entityData.filename || '';

      let html = '';

      // Save name
      if (filename) {
        html += `<div class="props-section">`;
        html += `<div class="props-section-title">Save</div>`;
        html += `<div class="props-row"><span class="props-value">${filename}</span></div>`;
        html += `</div>`;
      }

      // Class name
      html += `<div class="props-section">`;
      html += `<div class="props-section-title">Entity</div>`;
      html += `<div class="props-row"><span class="props-value" title="${cls}">${cls}</span></div>`;
      html += `</div>`;

      // Category
      html += `<div class="props-section">`;
      html += `<div class="props-section-title">Category</div>`;
      html += `<div class="props-row"><span class="props-port-dot" style="background:${catColor}; border-radius:50%"></span><span class="props-value">${catName}</span></div>`;
      html += `</div>`;

      // Position (Unreal coordinates)
      html += `<div class="props-section">`;
      html += `<div class="props-section-title">Position</div>`;
      html += `<div class="props-row"><span class="props-label">X</span><span class="props-value">${fmt(e.tx)}</span></div>`;
      html += `<div class="props-row"><span class="props-label">Y</span><span class="props-value">${fmt(e.ty)}</span></div>`;
      html += `<div class="props-row"><span class="props-label">Z</span><span class="props-value">${fmt(e.tz)}</span></div>`;
      html += `</div>`;

      // Rotation (quaternion)
      html += `<div class="props-section">`;
      html += `<div class="props-section-title">Rotation</div>`;
      html += `<div class="props-row"><span class="props-label">X</span><span class="props-value">${fmt(e.rx, 6)}</span></div>`;
      html += `<div class="props-row"><span class="props-label">Y</span><span class="props-value">${fmt(e.ry, 6)}</span></div>`;
      html += `<div class="props-row"><span class="props-label">Z</span><span class="props-value">${fmt(e.rz, 6)}</span></div>`;
      html += `<div class="props-row"><span class="props-label">W</span><span class="props-value">${fmt(e.rw, 6)}</span></div>`;
      html += `</div>`;

      // Ports
      const portLayout = entityData.portLayouts ? entityData.portLayouts[e.c] : null;
      if (portLayout && portLayout.length > 0) {
        html += `<div class="props-section">`;
        html += `<div class="props-section-title">Ports</div>`;
        for (let pi = 0; pi < portLayout.length; pi++) {
          const p = portLayout[pi];
          const connected = e.cn ? e.cn[pi] : 0;
          const flowClass = p.flow === 0 ? 'input' : 'output';
          const typeClass = p.type === 0 ? 'belt' : 'pipe';
          const statusClass = connected ? 'connected' : 'disconnected';
          const statusText = connected ? 'connected' : 'disconnected';
          const flowLabel = p.flow === 0 ? 'in' : 'out';
          html += `<div class="props-port-row">`;
          html += `<span class="props-port-dot ${typeClass} ${flowClass}"></span>`;
          html += `<span class="props-port-name">${p.n}</span>`;
          html += `<span class="props-port-status ${statusClass}">${flowLabel} \u2022 ${statusText}</span>`;
          html += `</div>`;
        }
        html += `</div>`;
      }

      // Index
      html += `<div class="props-section">`;
      html += `<div class="props-section-title">Index</div>`;
      html += `<div class="props-row"><span class="props-label">#</span><span class="props-value">${entityIndex}</span></div>`;
      html += `</div>`;

      contentDiv.innerHTML = html;
      container.classList.add('visible');

      currentEntityIndex = entityIndex;
      currentEntityData = entityData;
      gridBtn.classList.toggle('active', hasGrid(entityIndex));

      // Build serialized props for clipboard
      const props = {
        save: filename || undefined,
        class: cls,
        category: catName,
        index: entityIndex,
        position: { x: e.tx, y: e.ty, z: e.tz },
        rotation: { x: e.rx, y: e.ry, z: e.rz, w: e.rw },
      };
      if (portLayout && portLayout.length > 0) {
        props.ports = portLayout.map((p, pi) => ({
          name: p.n,
          type: p.type === 0 ? 'belt' : 'pipe',
          flow: p.flow === 0 ? 'input' : 'output',
          connected: !!(e.cn && e.cn[pi]),
          offset: { x: p.ox, y: p.oy, z: p.oz },
          dir: { x: p.dx, y: p.dy, z: p.dz },
        }));
      }
      currentSerializedProps = JSON.stringify(props, null, 2);
    },

    hide() {
      container.classList.remove('visible');
    },
  };
}

function fmt(val, decimals = 1) {
  return typeof val === 'number' ? val.toFixed(decimals) : String(val);
}
