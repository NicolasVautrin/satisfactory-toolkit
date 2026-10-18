import { refreshIcons } from './icons.js';

// ── Game save picker (browse the game's SaveGames folder) ────

const EXT_COLORS = { sav: '#6cf', sbp: '#fc6', cbp: '#c9f' };

function fmtSize(bytes) {
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  if (bytes >= 1024) return Math.round(bytes / 1024) + ' KB';
  return bytes + ' B';
}

function fmtDate(ms) {
  const d = new Date(ms);
  const days = Math.floor((Date.now() - ms) / 86400000);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (days === 0) return `today ${time}`;
  if (days === 1) return `yesterday ${time}`;
  if (days < 7) return `${days}d ago ${time}`;
  return d.toLocaleDateString();
}

export function openSavePicker(onPick) {
  const overlay = document.createElement('div');
  overlay.className = 'picker-overlay';

  const panel = document.createElement('div');
  panel.className = 'picker-panel';
  overlay.appendChild(panel);

  const header = document.createElement('div');
  header.className = 'picker-header';
  header.innerHTML = '<i data-lucide="folder-open" class="icon"></i><span>Game saves</span>';
  panel.appendChild(header);

  const rootLabel = document.createElement('div');
  rootLabel.className = 'picker-root';
  rootLabel.textContent = 'Loading...';
  panel.appendChild(rootLabel);

  const search = document.createElement('input');
  search.className = 'picker-search';
  search.type = 'text';
  search.placeholder = 'Filter...';
  panel.appendChild(search);

  const list = document.createElement('div');
  list.className = 'picker-list';
  panel.appendChild(list);

  document.body.appendChild(overlay);
  refreshIcons(panel);
  search.focus();

  function close() {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
  }

  document.addEventListener('keydown', onKey);
  overlay.addEventListener('pointerdown', (e) => { if (e.target === overlay) close(); });

  let files = [];

  function render() {
    const q = search.value.trim().toLowerCase();
    const shown = q
      ? files.filter((f) => (f.name + ' ' + f.group).toLowerCase().includes(q))
      : files;

    list.innerHTML = '';
    if (!shown.length) {
      const empty = document.createElement('div');
      empty.className = 'picker-empty';
      empty.textContent = files.length ? 'No match' : 'No save file found';
      list.appendChild(empty);
      return;
    }

    for (const f of shown) {
      const row = document.createElement('div');
      row.className = 'picker-row';

      const ext = document.createElement('span');
      ext.className = 'picker-ext';
      ext.textContent = f.ext;
      ext.style.color = EXT_COLORS[f.ext] || '#aaa';
      row.appendChild(ext);

      const name = document.createElement('span');
      name.className = 'picker-name';
      name.textContent = f.name;
      row.appendChild(name);

      // Same file name can exist in several folders (blueprints/<session>)
      if (f.group && f.group !== '.') {
        const group = document.createElement('span');
        group.className = 'picker-group';
        group.textContent = f.group;
        row.appendChild(group);
      }

      const meta = document.createElement('span');
      meta.className = 'picker-meta';
      meta.textContent = `${fmtDate(f.mtime)} · ${fmtSize(f.size)}`;
      row.appendChild(meta);

      row.title = f.path;
      row.addEventListener('click', () => { close(); onPick(f); });
      list.appendChild(row);
    }
  }

  search.addEventListener('input', render);
  search.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const first = list.querySelector('.picker-row');
    if (first) first.click();
  });

  fetch('/api/game/saves')
    .then((res) => res.json())
    .then((data) => {
      files = data.files || [];
      rootLabel.textContent = data.root || '';
      rootLabel.title = data.root || '';
      render();
    })
    .catch((err) => {
      rootLabel.textContent = 'Error: ' + err.message;
    });
}
