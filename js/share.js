/* ═══════════════════════════════════════
   SHAREABLE CODE — URL hash encoding
   ═══════════════════════════════════════ */

export function getCodeFromURL() {
  const h = window.location.hash;
  if (!h || h.length < 2) return null;
  let enc = h.substring(1);
  if (enc.startsWith('code=')) enc = enc.substring(5);
  try { return decodeURIComponent(escape(atob(enc))); }
  catch { return null; }
}

export function generateShareURL(code) {
  try {
    const enc = btoa(unescape(encodeURIComponent(code)));
    const url = new URL(window.location.href);
    url.hash = 'code=' + enc;
    return url.toString();
  } catch { return null; }
}

export async function copyToClipboard(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.cssText = 'position:fixed;left:-9999px';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch {}
    document.body.removeChild(ta);
    return true;
  }
}
