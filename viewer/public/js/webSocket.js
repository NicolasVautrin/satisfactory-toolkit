import { camera } from './engine/scene.js';
import { camState } from './engine/camera.js';
import { getSaveData, applyEditResult } from './engine/entities.js';

export function initWebSocket({ onEditResult, onSaveLoaded }) {
  const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${wsProto}//${location.host}`);

  ws.onopen = () => {
    console.log('[WS] connected');
    // Send camera position periodically
    setInterval(() => {
      if (ws.readyState === 1) {
        const p = camera.position;
        // Viewer → Unreal: flip X, convert yaw to UE convention (0°=+X)
        const ueYaw = camState.yaw * 180 / Math.PI + 90;
        ws.send(JSON.stringify({
          type: 'camera',
          position: { x: -p.x, y: p.y, z: p.z },
          yaw: ueYaw,
          pitch: camState.pitch * 180 / Math.PI,
        }));
      }
    }, 1000);
  };

  ws.onclose = () => console.log('[WS] disconnected');

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'editResult' && getSaveData()) {
        applyEditResult(msg);
        onEditResult(msg);
        console.log(`[WS] editResult: +${msg.added.length} ~${msg.updated.length} -${msg.deleted.length}, ${msg.connections.length} conn`);
      } else if (msg.type === 'saveLoaded') {
        console.log(`[WS] saveLoaded: ${msg.name}`);
        if (onSaveLoaded) onSaveLoaded(msg.name);
      }
    } catch (err) {
      console.error('[WS] message error:', err);
    }
  };
}
