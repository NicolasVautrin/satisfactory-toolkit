// ── File upload & drag/drop ─────────────────────────────────

export function initUpload({ onSaveLoaded, onCbpLoaded, setLoading }) {
  // Drag & drop on body
  document.body.addEventListener('dragover', (e) => e.preventDefault());
  document.body.addEventListener('drop', async (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith('.sav') || file.name.endsWith('.cbp'))) {
      await uploadFile(file, { onSaveLoaded, onCbpLoaded, setLoading });
    }
  });
}

export async function uploadFile(file, { onSaveLoaded, onCbpLoaded, setLoading }) {
  setLoading(`Uploading ${file.name}...`);

  try {
    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'X-Save-Name': file.name },
      body: file,
    });
    const result = await res.json();
    if (!res.ok) {
      setLoading('Error: ' + result.error);
      return;
    }

    if (result.type === 'cbp') {
      onCbpLoaded(result.cbp, file.name);
    } else {
      onSaveLoaded(result.save, file.name);
    }
  } catch (err) {
    setLoading('Error: ' + err.message);
  }
}
