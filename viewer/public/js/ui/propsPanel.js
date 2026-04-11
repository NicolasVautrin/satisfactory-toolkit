import { CAT_COLORS, CAT_NAMES } from '../engine/scene.js';
import { getPortLayout } from '../engine/entities.js';
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
    show(entityIndex, viewerEntityRepository) {
      if (entityIndex < 0 || !viewerEntityRepository) {
        container.classList.remove('visible');
        currentEntityIndex = -1;
        currentEntityData = null;
        return;
      }

      const e = viewerEntityRepository.entities[entityIndex];
      const cls = viewerEntityRepository.classNames[e.c];
      const catColor = '#' + CAT_COLORS[e.cat].toString(16).padStart(6, '0');
      const catName = CAT_NAMES[e.cat] || 'Other';
      const filename = viewerEntityRepository.filename || '';

      let html = '';

      // ── Header: condensed entity info ──
      html += `<div class="props-header">`;
      html += `<div class="props-header-row"><span class="props-cls" title="${cls}">${cls}</span><span class="props-idx">#${entityIndex}</span></div>`;
      html += `<div class="props-header-row"><span class="props-cat"><span class="props-cat-dot" style="background:${catColor}"></span>${catName}</span>`;
      if (filename) html += `<span class="props-dim">${filename}</span>`;
      html += `</div>`;
      html += `<div class="props-header-row"><span class="props-dim">pos</span><span class="props-val">{${fmt(e.tx)}, ${fmt(e.ty)}, ${fmt(e.tz)}}</span></div>`;
      html += `<div class="props-header-row"><span class="props-dim">rot</span><span class="props-val">{${fmt(e.rx, 4)}, ${fmt(e.ry, 4)}, ${fmt(e.rz, 4)}, ${fmt(e.rw, 4)}}</span></div>`;
      html += `</div>`;

      // ── Properties: custom key/value pairs ──
      const props = [];
      if (e.lb) props.push(['label', e.lb]);
      if (e.travel) props.push(['travel', e.travel]);

      if (props.length > 0) {
        html += `<div class="props-section">`;
        html += `<div class="props-section-title">Properties</div>`;
        for (const [key, val] of props) {
          html += `<div class="props-kv"><span class="props-key">${key}</span><span class="props-val">${val}</span></div>`;
        }
        html += `</div>`;
      }

      // ── Connections: label.port <-> label.port ──
      const portLayout = getPortLayout(e, viewerEntityRepository.portLayouts);
      if (portLayout && portLayout.length > 0 && e.cn) {
        const selfLabel = e.lb || `#${entityIndex}`;
        const connLines = [];
        for (let pi = 0; pi < portLayout.length; pi++) {
          const p = portLayout[pi];
          const ref = e.cn[pi];
          const portShort = shortPortName(p.n);
          if (!ref || ref === 0) {
            connLines.push({ self: `${selfLabel}.${portShort}`, other: null });
          } else {
            // ref can be "label.Port, label.Port" for switches
            for (const otherRef of String(ref).split(', ')) {
              connLines.push({ self: `${selfLabel}.${portShort}`, other: otherRef });
            }
          }
        }
        if (connLines.length > 0) {
          html += `<div class="props-section">`;
          html += `<div class="props-section-title">Connections</div>`;
          for (const c of connLines) {
            if (c.other) {
              html += `<div class="props-conn"><span class="props-conn-self">${c.self}</span><span class="props-conn-arrow">\u2194</span><span class="props-conn-other">${c.other}</span></div>`;
            } else {
              html += `<div class="props-conn disconnected"><span class="props-conn-self">${c.self}</span></div>`;
            }
          }
          html += `</div>`;
        }
      }

      contentDiv.innerHTML = html;
      container.classList.add('visible');

      currentEntityIndex = entityIndex;
      currentEntityData = viewerEntityRepository;
      gridBtn.classList.toggle('active', hasGrid(entityIndex));

      // Build serialized props for clipboard
      const clipProps = {
        save: filename || undefined,
        label: e.lb || undefined,
        class: cls,
        category: catName,
        index: entityIndex,
        position: `{${Math.round(e.tx)}, ${Math.round(e.ty)}, ${Math.round(e.tz)}}`,
        rotation: `{${e.rx.toFixed(4)}, ${e.ry.toFixed(4)}, ${e.rz.toFixed(4)}, ${e.rw.toFixed(4)}}`,
      };
      if (e.travel) clipProps.travel = e.travel;
      if (portLayout && portLayout.length > 0) {
        clipProps.ports = portLayout.map((p, pi) => {
          const cn = e.cn && e.cn[pi];
          const port = {
            name: p.n,
            type: p.type === 0 ? 'belt' : p.type === 1 ? 'pipe' : 'track',
            flow: p.flow === -1 ? 'any' : p.flow === 0 ? 'input' : 'output',
            connected: typeof cn === 'string' ? cn : !!cn,
          };
          if (p.ox !== undefined) port.offset = { x: p.ox, y: p.oy, z: p.oz };
          if (p.dx !== undefined) port.dir = { x: p.dx, y: p.dy, z: p.dz };
          return port;
        });
      }
      currentSerializedProps = JSON.stringify(clipProps, null, 2);
    },

    hide() {
      container.classList.remove('visible');
    },
  };
}

function fmt(val, decimals = 1) {
  return typeof val === 'number' ? val.toFixed(decimals) : String(val);
}

function shortPortName(name) {
  return name.replace('TrackConnection', 'TC').replace('PipelineConnection', 'PC').replace('ConveyorAny', 'CA');
}
