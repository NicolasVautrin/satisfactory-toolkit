// ── Top bar with dropdown menus ──────────────────────────────

let openMenu = null;

function closeAll() {
  if (!openMenu) return;
  openMenu.trigger.classList.remove('open');
  openMenu.dropdown.classList.remove('open');
  openMenu = null;
}

// Close menus on click outside
document.addEventListener('pointerdown', (e) => {
  if (openMenu && !openMenu.menu.contains(e.target)) closeAll();
});

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

export function createToolbar(container, { onOpen, onMerge, onExport, onClear }) {
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.sav,.cbp';
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
  openItem.textContent = 'Open...';
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

  fileMenu.appendChild(Object.assign(document.createElement('div'), { className: 'menu-separator' }));

  const mergeItem = document.createElement('div');
  mergeItem.className = 'menu-item disabled';
  mergeItem.id = 'btn-merge';
  mergeItem.textContent = 'Merge CBP \u2192 Save';
  mergeItem.addEventListener('click', () => { closeAll(); onMerge(); });
  fileMenu.appendChild(mergeItem);

  const exportItem = document.createElement('div');
  exportItem.className = 'menu-item disabled';
  exportItem.id = 'btn-export';
  exportItem.textContent = 'Export Blueprint';
  exportItem.addEventListener('click', () => { closeAll(); onExport(); });
  fileMenu.appendChild(exportItem);

  // ── Layers menu ─────────────────────────────────────────
  const layersMenu = createMenu(container, 'Layers');

  // ── Camera menu ────────────────────────────────────────
  const cameraMenu = createMenu(container, 'Camera');

  // ── Spacer + status ───────────────────────────────────────
  container.appendChild(Object.assign(document.createElement('div'), { className: 'spacer' }));

  const clearBtn = document.createElement('button');
  clearBtn.id = 'btn-clear';
  clearBtn.textContent = 'Clear Selection';
  clearBtn.disabled = true;
  clearBtn.style.cssText = 'background:#444;color:#ddd;border:1px solid #666;padding:4px 12px;cursor:pointer;font-family:monospace;font-size:12px;margin-right:8px';
  clearBtn.addEventListener('click', onClear);
  container.appendChild(clearBtn);

  const status = document.createElement('span');
  status.id = 'status';
  container.appendChild(status);

  return {
    layersMenu,
    cameraMenu,

    updateStatus(text) {
      status.textContent = text;
    },

    setFileLabel(type, name) {
      const el = container.querySelector(type === 'save' ? '#file-save' : '#file-cbp');
      el.textContent = name;
    },

    setButtonStates({ merge, export: exp, clear }) {
      mergeItem.classList.toggle('disabled', !merge);
      exportItem.classList.toggle('disabled', !exp);
      clearBtn.disabled = !clear;
    },
  };
}
