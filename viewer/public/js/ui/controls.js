import { refreshIcons } from './icons.js';
import { getGridBoxAlign, setGridBoxAlign } from '../engine/entityGrid.js';
import { camState, effectiveFlyStep, effectivePanSpeed, effectiveRotSpeed, setFlyStep, setPanSpeed, setRotateSpeed } from '../engine/camera.js';
import { getUELandscapeBounds } from '../engine/landscape.js';

// ── Camera & grid controls dropdown ─────────────────────────

export function createControls(menuDropdown, { camState, onGridSpacingChange }) {
  function makeRow(label, getValue, onDown, onUp, getEffective) {
    const row = document.createElement('div');
    row.className = 'ctrl-row';
    row.innerHTML = `
      <span class="ctrl-label">${label}</span>
      <button class="ctrl-down"><i data-lucide="minus" class="icon-sm"></i></button>
      <span class="ctrl-val"></span>
      <button class="ctrl-up"><i data-lucide="plus" class="icon-sm"></i></button>
      ${getEffective ? '<span class="ctrl-eff"></span>' : ''}
    `;
    const valSpan = row.querySelector('.ctrl-val');
    const effSpan = row.querySelector('.ctrl-eff');
    const update = () => {
      valSpan.textContent = getValue();
      if (effSpan && getEffective) {
        const eff = getEffective();
        effSpan.textContent = eff !== null ? eff : '';
      }
    };
    update();

    row.querySelector('.ctrl-down').addEventListener('click', () => { onDown(); update(); });
    row.querySelector('.ctrl-up').addEventListener('click', () => { onUp(); update(); });

    menuDropdown.appendChild(row);
    return { update };
  }

  // Center map button
  const centerBtn = document.createElement('button');
  centerBtn.className = 'ctrl-btn';
  centerBtn.textContent = 'Center map';
  centerBtn.addEventListener('click', () => {
    const ue = getUELandscapeBounds();
    if (!ue) return;
    const cx = (ue.minX + ue.maxX) / 2;
    const cy = (ue.minY + ue.maxY) / 2;
    const w = ue.maxX - ue.minX, h = ue.maxY - ue.minY;
    const alt = Math.max(w, h) * 0.5;
    window._resetCamera(-cx, cy, alt, -Math.PI / 4, -Math.PI / 3);
  });
  menuDropdown.appendChild(centerBtn);
  menuDropdown.appendChild(Object.assign(document.createElement('div'), { className: 'menu-separator' }));

  const zoomRow = makeRow('Zoom',
    () => Math.round(camState.flyStep),
    () => { setFlyStep(camState.flyStep / 2); },
    () => { setFlyStep(camState.flyStep * 2); },
    () => camState.adaptive ? Math.round(effectiveFlyStep()) : null,
  );

  const panRow = makeRow('Pan',
    () => camState.panSpeed.toFixed(1),
    () => { setPanSpeed(camState.panSpeed / 1.5); },
    () => { setPanSpeed(camState.panSpeed * 1.5); },
    () => camState.adaptive ? effectivePanSpeed().toFixed(1) : null,
  );

  const rotRow = makeRow('Rot',
    () => (camState.rotateSpeed * 1000).toFixed(1),
    () => { setRotateSpeed(camState.rotateSpeed / 1.5); },
    () => { setRotateSpeed(camState.rotateSpeed * 1.5); },
    () => camState.adaptive ? (effectiveRotSpeed() * 1000).toFixed(1) : null,
  );

  const gridRow = makeRow('Grid',
    () => onGridSpacingChange(0),
    () => onGridSpacingChange(-1),
    () => onGridSpacingChange(1),
  );


  // Adaptive sensitivity toggle
  menuDropdown.appendChild(Object.assign(document.createElement('div'), { className: 'menu-separator' }));
  const adaptiveLabel = document.createElement('label');
  adaptiveLabel.className = 'menu-toggle';
  adaptiveLabel.innerHTML = `
    <input type="checkbox" ${camState.adaptive ? 'checked' : ''}>
    <span class="menu-dot" style="background:#44aaff"></span>
    Adaptive sensitivity
  `;
  const adaptiveCheckbox = adaptiveLabel.querySelector('input');
  adaptiveCheckbox.addEventListener('change', (e) => {
    camState.adaptive = e.target.checked;
  });
  menuDropdown.appendChild(adaptiveLabel);

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
      adaptiveCheckbox.checked = camState.adaptive;
    },
  };
}
