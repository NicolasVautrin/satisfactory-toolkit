import { renderer, resize } from './scene.js';
import { getSaveData, getCbpData } from './entities.js';
import { selectedIndices, pickAt, pickPortAt, pickSceneryAt, pickRect, toggleSelection, addSelection } from './selection.js';

const CLICK_THRESHOLD = 5;

export function initMouseHandlers({ propsPanel }) {
  let dragStart = null;
  let isDragging = false;
  let pointerDownPos = null;
  let rightDownPos = null;

  const selRect = document.getElementById('selection-rect');

  renderer.domElement.addEventListener('pointerdown', (e) => {
    if (e.button === 2) {
      rightDownPos = { x: e.clientX, y: e.clientY };
      return;
    }
    if (e.button !== 0) return;
    pointerDownPos = { x: e.clientX, y: e.clientY };
    if (e.shiftKey) {
      isDragging = true;
      dragStart = { x: e.clientX, y: e.clientY };
      selRect.style.display = 'block';
      selRect.style.left = e.clientX + 'px';
      selRect.style.top = e.clientY + 'px';
      selRect.style.width = '0px';
      selRect.style.height = '0px';
      e.preventDefault();
    }
  });

  window.addEventListener('pointermove', (e) => {
    if (!isDragging) return;
    const x = Math.min(dragStart.x, e.clientX);
    const y = Math.min(dragStart.y, e.clientY);
    selRect.style.left = x + 'px';
    selRect.style.top = y + 'px';
    selRect.style.width = Math.abs(e.clientX - dragStart.x) + 'px';
    selRect.style.height = Math.abs(e.clientY - dragStart.y) + 'px';
  });

  window.addEventListener('pointerup', (e) => {
    // Right-click without drag = close props panel
    if (e.button === 2 && rightDownPos) {
      const dx = Math.abs(e.clientX - rightDownPos.x);
      const dy = Math.abs(e.clientY - rightDownPos.y);
      if (dx < CLICK_THRESHOLD && dy < CLICK_THRESHOLD) {
        propsPanel.hide();
        requestAnimationFrame(resize);
      }
      rightDownPos = null;
      return;
    }

    if (isDragging) {
      isDragging = false;
      selRect.style.display = 'none';

      const rect = renderer.domElement.getBoundingClientRect();
      const x1 = Math.round(Math.min(dragStart.x, e.clientX) - rect.left);
      const y1 = Math.round(Math.min(dragStart.y, e.clientY) - rect.top);
      const x2 = Math.round(Math.max(dragStart.x, e.clientX) - rect.left);
      const y2 = Math.round(Math.max(dragStart.y, e.clientY) - rect.top);

      if (x2 - x1 > 2 && y2 - y1 > 2) {
        const found = pickRect(x1, y1, x2, y2);
        if (!e.ctrlKey) selectedIndices.clear();
        addSelection(found);
      }
      dragStart = null;
      return;
    }

    if (e.button === 0 && !e.shiftKey && pointerDownPos) {
      const dx = Math.abs(e.clientX - pointerDownPos.x);
      const dy = Math.abs(e.clientY - pointerDownPos.y);
      if (dx < CLICK_THRESHOLD && dy < CLICK_THRESHOLD) {
        const rect = renderer.domElement.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const idx = pickAt(x, y);
        if (e.ctrlKey) {
          // Ctrl+click = toggle selection (skip ports)
          if (idx >= 0) toggleSelection(idx);
        } else {
          // Click = inspect properties (ports first, then entities)
          const portEntityIdx = pickPortAt(x, y);
          const inspectIdx = portEntityIdx >= 0 ? portEntityIdx : idx;
          if (inspectIdx >= 0) {
            propsPanel.show(inspectIdx, getSaveData() || getCbpData());
            requestAnimationFrame(resize);
          } else {
            // Try scenery pick (console log only)
            pickSceneryAt(x, y);
            propsPanel.hide();
            requestAnimationFrame(resize);
          }
        }
      }
      pointerDownPos = null;
    }
  });
}
