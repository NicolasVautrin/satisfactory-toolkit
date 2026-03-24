import { CAT_COLORS, CAT_NAMES } from '../engine/scene.js';

const LS_KEY = 'viewer_layers';

function loadState() {
  try {
    const s = localStorage.getItem(LS_KEY);
    return s ? JSON.parse(s) : null;
  } catch { return null; }
}

function saveState(state) {
  localStorage.setItem(LS_KEY, JSON.stringify(state));
}

// ── Layers dropdown menu ────────────────────────────────────

export function createFilters(menuDropdown, { onCategoryToggle, onCbpToggle, onTerrainToggle, onGridToggle, onPortsToggle }) {
  const saved = loadState() || {};
  const state = {
    cats: saved.cats || [true, true, true, true, true, true, true, true],
    terrain: saved.terrain !== undefined ? saved.terrain : true,
    grid: saved.grid !== undefined ? saved.grid : true,
    ports: saved.ports || false,
    cbp: saved.cbp !== undefined ? saved.cbp : true,
  };

  function persist() { saveState(state); }

  // Category toggles
  for (let cat = 0; cat < 8; cat++) {
    const colorHex = '#' + CAT_COLORS[cat].toString(16).padStart(6, '0');
    const checked = state.cats[cat];
    const label = document.createElement('label');
    label.className = 'menu-toggle';
    label.innerHTML = `
      <input type="checkbox" ${checked ? 'checked' : ''}>
      <span class="menu-dot" style="background:${colorHex}"></span>
      ${CAT_NAMES[cat]}
    `;
    label.querySelector('input').addEventListener('change', (e) => {
      state.cats[cat] = e.target.checked;
      persist();
      onCategoryToggle(cat, e.target.checked);
    });
    menuDropdown.appendChild(label);

    // Apply saved state
    if (!checked) onCategoryToggle(cat, false);
  }

  // Separator
  menuDropdown.appendChild(Object.assign(document.createElement('div'), { className: 'menu-separator' }));

  // Terrain toggle
  const terrainLabel = document.createElement('label');
  terrainLabel.className = 'menu-toggle';
  terrainLabel.innerHTML = `
    <input type="checkbox" ${state.terrain ? 'checked' : ''}>
    <span class="menu-dot" style="background:#4a7a28"></span>
    Terrain
  `;
  terrainLabel.querySelector('input').addEventListener('change', (e) => {
    state.terrain = e.target.checked;
    persist();
    onTerrainToggle(e.target.checked);
  });
  menuDropdown.appendChild(terrainLabel);
  if (!state.terrain) onTerrainToggle(false);

  // Grid toggle
  const gridLabel = document.createElement('label');
  gridLabel.className = 'menu-toggle';
  gridLabel.innerHTML = `
    <input type="checkbox" ${state.grid ? 'checked' : ''}>
    <span class="menu-dot" style="background:#666"></span>
    Grid
  `;
  gridLabel.querySelector('input').addEventListener('change', (e) => {
    state.grid = e.target.checked;
    persist();
    onGridToggle(e.target.checked);
  });
  menuDropdown.appendChild(gridLabel);
  if (!state.grid) onGridToggle(false);

  // Ports toggle
  const portsLabel = document.createElement('label');
  portsLabel.className = 'menu-toggle';
  portsLabel.innerHTML = `
    <input type="checkbox" ${state.ports ? 'checked' : ''}>
    <span class="menu-dot" style="background:#44ff44"></span>
    Ports
  `;
  portsLabel.querySelector('input').addEventListener('change', (e) => {
    state.ports = e.target.checked;
    persist();
    onPortsToggle(e.target.checked);
  });
  menuDropdown.appendChild(portsLabel);
  if (state.ports) onPortsToggle(true);

  // CBP toggle
  const cbpLabel = document.createElement('label');
  cbpLabel.className = 'menu-toggle';
  cbpLabel.innerHTML = `
    <input type="checkbox" ${state.cbp ? 'checked' : ''}>
    <span class="menu-dot" style="background:#44ffcc"></span>
    CBP
  `;
  cbpLabel.querySelector('input').addEventListener('change', (e) => {
    state.cbp = e.target.checked;
    persist();
    onCbpToggle(e.target.checked);
  });
  menuDropdown.appendChild(cbpLabel);
  if (!state.cbp) onCbpToggle(false);
}
