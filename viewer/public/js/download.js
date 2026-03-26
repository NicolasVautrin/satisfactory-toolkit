// ── Download helpers ─────────────────────────────────────────

export function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function downloadBase64(b64, filename) {
  const blob = new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))]);
  downloadBlob(blob, filename);
}

export function filenameFromResponse(res, fallback) {
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="(.+)"/);
  return match ? match[1] : fallback;
}
