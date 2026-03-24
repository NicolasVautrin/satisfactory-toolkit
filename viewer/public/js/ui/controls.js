import { refreshIcons } from './icons.js';
import { getGridBoxAlign, setGridBoxAlign } from '../engine/entityGrid.js';

// ── Camera & grid controls dropdown ─────────────────────────

export function createControls(menuDropdown, { camState, onGridSpacingChange }) {
  function makeRow(label, getValue, onDown, onUp) {
    const row = document.createElement('div');
    row.className = 'ctrl-row';
    row.innerHTML = `
      <span class="ctrl-label">${label}</span>
      <button class="ctrl-down"><i data-lucide="minus" class="icon-sm"></i></button>
      <span class="ctrl-val"></span>
      <button class="ctrl-up"><i data-lucide="plus" class="icon-sm"></i></button>
    `;
    const valSpan = row.querySelector('.ctrl-val');
    const update = () => { valSpan.textContent = getValue(); };
    update();

    row.querySelector('.ctrl-down').addEventListener('click', () => { onDown(); update(); });
    row.querySelector('.ctrl-up').addEventListener('click', () => { onUp(); update(); });

    menuDropdown.appendChild(row);
    return { update };
  }

  const zoomRow = makeRow('Zoom',
    () => camState.flyStep,
    () => { camState.flyStep = Math.max(100, camState.flyStep / 2); },
    () => { camState.flyStep = Math.min(100000, camState.flyStep * 2); },
  );

  const panRow = makeRow('Pan',
    () => camState.panSpeed.toFixed(1),
    () => { camState.panSpeed = Math.max(0.1, camState.panSpeed / 1.5); },
    () => { camState.panSpeed = Math.min(20, camState.panSpeed * 1.5); },
  );

  const rotRow = makeRow('Rot',
    () => (camState.rotateSpeed * 1000).toFixed(1),
    () => { camState.rotateSpeed = Math.max(0.0005, camState.rotateSpeed / 1.5); },
    () => { camState.rotateSpeed = Math.min(0.02, camState.rotateSpeed * 1.5); },
  );

  const gridRow = makeRow('Grid',
    () => onGridSpacingChange(0),
    () => onGridSpacingChange(-1),
    () => onGridSpacingChange(1),
  );

  // GridBox alignment toggle
  menuDropdown.appendChild(Object.assign(document.createElement('div'), { className: 'menu-separator' }));
  const alignLabel = document.createElement('label');
  alignLabel.className = 'menu-toggle';
  const isEntity = getGridBoxAlign() === 'entity';
  alignLabel.innerHTML = `
    <input type="checkbox" ${isEntity ? 'checked' : ''}>
    <span class="menu-dot" style="background:#ffaa00"></span>
    GridBox: entity axes
  `;
  alignLabel.querySelector('input').addEventListener('change', (e) => {
    setGridBoxAlign(e.target.checked ? 'entity' : 'world');
  });
  menuDropdown.appendChild(alignLabel);

  refreshIcons(menuDropdown);

  return {
    updateAll() {
      zoomRow.update();
      panRow.update();
      rotRow.update();
      gridRow.update();
    },
  };
}
