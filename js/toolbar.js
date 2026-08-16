/* ═══════════════════════════════════════
   MOBILE SYMBOL TOOLBAR — Quick insert
   ═══════════════════════════════════════ */

import { insertAtCursor, focusEditor } from './editor.js';

export function initToolbar() {
  const toolbar = document.getElementById('symbol-toolbar');

  // Use mousedown instead of click so we fire before blur
  toolbar.addEventListener('pointerdown', e => {
    const btn = e.target.closest('.sym-btn');
    if (!btn) return;
    e.preventDefault(); // prevent textarea blur
    e.stopPropagation();
    const text = btn.dataset.insert;
    if (text) {
      insertAtCursor(text);
      requestAnimationFrame(() => focusEditor());
    }
  });
}
