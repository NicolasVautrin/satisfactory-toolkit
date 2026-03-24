// ── Lucide icons helper ──────────────────────────────────────
// Lucide is loaded via UMD script in index.html → available as window.lucide

export function refreshIcons(container) {
  if (window.lucide) {
    window.lucide.createIcons({ nodes: container ? [container] : undefined });
  }
}
