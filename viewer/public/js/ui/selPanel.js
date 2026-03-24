import { CAT_COLORS } from '../engine/scene.js';

// ── Selection panel (right side) ────────────────────────────

export function createSelPanel(container, { onRemoveClass, onClear }) {
  container.innerHTML = `
    <div id="sel-panel-header">
      <strong>Selection (<span id="sel-total">0</span>)</strong>
      <button id="btn-clear-panel">Clear all</button>
    </div>
    <div id="sel-panel-list"></div>
  `;

  container.querySelector('#btn-clear-panel').addEventListener('click', onClear);

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
          <button class="sel-remove" title="Remove from selection">\u2715</button>
        `;
        row.querySelector('.sel-remove').addEventListener('click', () => onRemoveClass(cls));
        listDiv.appendChild(row);
      }
    },
  };
}
