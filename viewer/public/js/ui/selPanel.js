import { CAT_COLORS } from '../engine/scene.js';
import { refreshIcons } from './icons.js';

// ── Selection panel (right side) ────────────────────────────

export function createSelPanel(container, { onRemoveClass, onClear, onExport, onDelete }) {
  container.innerHTML = `
    <div id="sel-panel-header">
      <strong>Selection (<span id="sel-total">0</span>)</strong>
    </div>
    <div id="sel-panel-actions">
      <button id="btn-export-panel" title="Export as blueprint"><i data-lucide="download" class="icon"></i> Export</button>
      <button id="btn-delete-panel" title="Delete from save"><i data-lucide="trash-2" class="icon"></i> Delete</button>
      <button id="btn-clear-panel" title="Clear selection"><i data-lucide="x" class="icon"></i> Clear</button>
    </div>
    <div id="sel-panel-list"></div>
  `;

  container.querySelector('#btn-clear-panel').addEventListener('click', onClear);
  container.querySelector('#btn-export-panel').addEventListener('click', onExport);
  container.querySelector('#btn-delete-panel').addEventListener('click', onDelete);
  refreshIcons(container);

  const totalSpan = container.querySelector('#sel-total');
  const listDiv = container.querySelector('#sel-panel-list');

  return {
    update(selectedIndices, entityData) {
      const shouldShow = selectedIndices.size > 0;
      container.classList.toggle('visible', shouldShow);

      if (!shouldShow || !entityData) return;

      totalSpan.textContent = selectedIndices.size;

      const groups = {};
      for (const idx of selectedIndices) {
        const e = entityData.entities[idx];
        const cls = entityData.classNames[e.c];
        if (!groups[cls]) groups[cls] = { count: 0, cat: e.cat };
        groups[cls].count++;
      }

      const sorted = Object.entries(groups).sort((a, b) => b[1].count - a[1].count);
      listDiv.innerHTML = '';

      for (const [cls, { count, cat }] of sorted) {
        const colorHex = '#' + CAT_COLORS[cat].toString(16).padStart(6, '0');
        const row = document.createElement('div');
        row.className = 'sel-row';
        row.innerHTML = `
          <span class="sel-color" style="background:${colorHex}"></span>
          <span class="sel-name" title="${cls}">${cls}</span>
          <span class="sel-count">\u00d7${count}</span>
          <button class="sel-remove" title="Remove from selection"><i data-lucide="x" class="icon-sm"></i></button>
        `;
        row.querySelector('.sel-remove').addEventListener('click', () => onRemoveClass(cls));
        listDiv.appendChild(row);
      }
      refreshIcons(listDiv);
    },
  };
}
