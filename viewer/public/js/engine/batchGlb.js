// ── Batch GLB loader ──────────────────────────────────────
// Shared by landscape.js and scenery.js

function parseBatchResponse(buffer) {
  const view = new DataView(buffer);
  let offset = 0;
  const count = view.getUint32(offset, true); offset += 4;
  const entries = [];
  for (let i = 0; i < count; i++) {
    const nameLen = view.getUint32(offset, true); offset += 4;
    const name = new TextDecoder().decode(new Uint8Array(buffer, offset, nameLen)); offset += nameLen;
    const glbLen = view.getUint32(offset, true); offset += 4;
    const glb = buffer.slice(offset, offset + glbLen); offset += glbLen;
    entries.push({ name, glb });
  }
  return entries;
}

export async function fetchBatchGlb(prefix, files, priority = 'auto') {
  const res = await fetch('/api/viewer/glb', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix, files }),
    priority,
  });
  return parseBatchResponse(await res.arrayBuffer());
}
