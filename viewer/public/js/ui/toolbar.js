import { refreshIcons } from './icons.js';

// ── Top bar with dropdown menus ──────────────────────────────

let openMenu = null;

function closeAll() {
  if (!openMenu) return;
  openMenu.trigger.classList.remove('open');
  openMenu.dropdown.classList.remove('open');
  openMenu = null;
}

// Close menus on click outside or focus loss
document.addEventListener('pointerdown', (e) => {
  if (openMenu && !openMenu.menu.contains(e.target)) closeAll();
});
window.addEventListener('blur', closeAll);

function createMenu(container, label) {
  const menu = document.createElement('div');
  menu.className = 'menu';

  const trigger = document.createElement('button');
  trigger.className = 'menu-trigger';
  trigger.textContent = label;

  const dropdown = document.createElement('div');
  dropdown.className = 'menu-dropdown';

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    if (openMenu && openMenu.menu === menu) {
      closeAll();
    } else {
      closeAll();
      trigger.classList.add('open');
      dropdown.classList.add('open');
      openMenu = { menu, trigger, dropdown };
    }
  });

  menu.appendChild(trigger);
  menu.appendChild(dropdown);
  container.appendChild(menu);
  return dropdown;
}

export function createToolbar(container, { onOpen, onRefresh, onMerge, onDownloadSave, onDisplayChange }) {
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.sav,.cbp,.sbp';
  fileInput.style.display = 'none';
  container.appendChild(fileInput);

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) { closeAll(); onOpen(file); }
    e.target.value = '';
  });

  // ── File menu ─────────────────────────────────────────────
  const fileMenu = createMenu(container, 'File');

  const openItem = document.createElement('div');
  openItem.className = 'menu-item';
  openItem.innerHTML = '<i data-lucide="folder-open" class="icon"></i> Open...';
  openItem.addEventListener('click', () => fileInput.click());
  fileMenu.appendChild(openItem);

  const saveLabel = document.createElement('div');
  saveLabel.className = 'menu-item disabled';
  saveLabel.innerHTML = '<span class="menu-file-label" id="file-save">No save loaded</span>';
  fileMenu.appendChild(saveLabel);

  const cbpLabel = document.createElement('div');
  cbpLabel.className = 'menu-item disabled';
  cbpLabel.innerHTML = '<span class="menu-file-label" id="file-cbp">No CBP loaded</span>';
  fileMenu.appendChild(cbpLabel);

  const refreshItem = document.createElement('div');
  refreshItem.className = 'menu-item disabled';
  refreshItem.id = 'btn-refresh';
  refreshItem.innerHTML = '<i data-lucide="refresh-cw" class="icon"></i> Refresh';
  refreshItem.addEventListener('click', () => { closeAll(); onRefresh(); });
  fileMenu.appendChild(refreshItem);

  fileMenu.appendChild(Object.assign(document.createElement('div'), { className: 'menu-separator' }));

  const mergeItem = document.createElement('div');
  mergeItem.className = 'menu-item disabled';
  mergeItem.id = 'btn-merge';
  mergeItem.innerHTML = '<i data-lucide="git-merge" class="icon"></i> Merge CBP \u2192 Save';
  mergeItem.addEventListener('click', () => { closeAll(); onMerge(); });
  fileMenu.appendChild(mergeItem);

  const downloadItem = document.createElement('div');
  downloadItem.className = 'menu-item disabled';
  downloadItem.id = 'btn-download-save';
  downloadItem.innerHTML = '<i data-lucide="save" class="icon"></i> Download Save';
  downloadItem.addEventListener('click', () => { closeAll(); onDownloadSave(); });
  fileMenu.appendChild(downloadItem);

  // ── Display menu ────────────────────────────────────────
  const displayMenu = createMenu(container, 'Display');

  // Unified display options: Boxes (no meshes) + LOD levels
  let currentDisplay = localStorage.getItem('viewer_display') || 'lod2';
  const displayItems = {};

  function addDisplayOption(key, label) {
    const item = document.createElement('div');
    item.className = 'menu-item' + (key === currentDisplay ? ' checked' : '');
    item.textContent = label;
    item.addEventListener('click', () => {
      if (key === currentDisplay) return;
      currentDisplay = key;
      localStorage.setItem('viewer_display', key);
      for (const el of Object.values(displayItems)) el.classList.remove('checked');
      item.classList.add('checked');
      closeAll();
      if (onDisplayChange) onDisplayChange({ display: currentDisplay });
    });
    displayMenu.appendChild(item);
    displayItems[key] = item;
  }

  addDisplayOption('boxes', 'Boxes');

  function populateLods(lods) {
    // Add LOD items in reverse order (highest detail first after boxes)
    const sorted = [...lods].sort((a, b) => {
      const na = parseInt(a.replace('lod', ''), 10);
      const nb = parseInt(b.replace('lod', ''), 10);
      return na - nb;
    });
    for (const lod of sorted) {
      addDisplayOption(lod, lod.toUpperCase());
    }
  }

  // ── Layers menu ─────────────────────────────────────────
  const layersMenu = createMenu(container, 'Layers');

  // ── Camera menu ────────────────────────────────────────
  const cameraMenu = createMenu(container, 'Camera');

  // ── Spacer + status ───────────────────────────────────────
  container.appendChild(Object.assign(document.createElement('div'), { className: 'spacer' }));

  const status = document.createElement('span');
  status.id = 'status';
  container.appendChild(status);

  refreshIcons(container);

  return {
    layersMenu,
    cameraMenu,
    populateLods,

    updateStatus(text) {
      status.textContent = text;
    },

    setFileLabel(type, name) {
      const el = container.querySelector(type === 'save' ? '#file-save' : '#file-cbp');
      el.textContent = name;
    },

    setButtonStates({ merge, refresh, downloadSave }) {
      mergeItem.classList.toggle('disabled', !merge);
      refreshItem.classList.toggle('disabled', !refresh);
      downloadItem.classList.toggle('disabled', !downloadSave);
    },
  };
}
