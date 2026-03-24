import { CAT_COLORS, CAT_NAMES } from '../engine/scene.js';

// ── Layers dropdown menu ────────────────────────────────────

export function createFilters(menuDropdown, { onCategoryToggle, onCbpToggle, onTerrainToggle, onGridToggle }) {
  // Category toggles
  for (let cat = 0; cat < 8; cat++) {
    const colorHex = '#' + CAT_COLORS[cat].toString(16).padStart(6, '0');
    const label = document.createElement('label');
    label.className = 'menu-toggle';
    label.innerHTML = `
      <input type="checkbox" checked>
      <span class="menu-dot" style="background:${colorHex}"></span>
      ${CAT_NAMES[cat]}
    `;
    label.querySelector('input').addEventListener('change', (e) => {
      onCategoryToggle(cat, e.target.checked);
    });
    menuDropdown.appendChild(label);
  }

  // Separator
  menuDropdown.appendChild(Object.assign(document.createElement('div'), { className: 'menu-separator' }));

  // Terrain toggle
  const terrainLabel = document.createElement('label');
  terrainLabel.className = 'menu-toggle';
  terrainLabel.innerHTML = `
    <input type="checkbox" checked>
    <span class="menu-dot" style="background:#4a7a28"></span>
    Terrain
  `;
  terrainLabel.querySelector('input').addEventListener('change', (e) => {
    onTerrainToggle(e.target.checked);
  });
  menuDropdown.appendChild(terrainLabel);

  // Grid toggle
  const gridLabel = document.createElement('label');
  gridLabel.className = 'menu-toggle';
  gridLabel.innerHTML = `
    <input type="checkbox" checked>
    <span class="menu-dot" style="background:#666"></span>
    Grid
  `;
  gridLabel.querySelector('input').addEventListener('change', (e) => {
    onGridToggle(e.target.checked);
  });
  menuDropdown.appendChild(gridLabel);

  // CBP toggle
  const cbpLabel = document.createElement('label');
  cbpLabel.className = 'menu-toggle';
  cbpLabel.innerHTML = `
    <input type="checkbox" checked>
    <span class="menu-dot" style="background:#44ffcc"></span>
    CBP
  `;
  cbpLabel.querySelector('input').addEventListener('change', (e) => {
    onCbpToggle(e.target.checked);
  });
  menuDropdown.appendChild(cbpLabel);
}
