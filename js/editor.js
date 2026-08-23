/* ═══════════════════════════════════════
   EDITOR — Syntax highlighting & editing
   Custom regex-based Python highlighter
   ═══════════════════════════════════════ */

import { getSettings, saveSettings } from './storage.js';

let textarea, highlightLayer, gutter, scrollArea, fontSizeLabel;
let fontSize = 14;
let currentLine = 0;
let errorLine = -1;
let onChangeCallback = null;

/* ─── SYNTAX PATTERNS ─── */
const PATTERNS = [
  { n: 'str', r: /"""[\s\S]*?"""|'''[\s\S]*?'''/g },
  { n: 'str', r: /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g },
  { n: 'cmt', r: /#.*/g },
  { n: 'dec', r: /@\w+/g },
  { n: 'kw',  r: /\b(?:False|None|True|and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|raise|return|try|while|with|yield)\b/g },
  { n: 'bi',  r: /\b(?:print|input|len|range|int|float|str|list|dict|set|tuple|type|isinstance|enumerate|zip|map|filter|sorted|reversed|abs|max|min|sum|any|all|open|round|format|super|property|staticmethod|classmethod|hasattr|getattr|setattr|delattr|callable|iter|next|id|hash|hex|oct|bin|chr|ord|repr|eval|exec|compile|globals|locals|vars|dir|help)\b(?=\s*\()/g },
  { n: 'fn',  r: /\bdef\s+(\w+)/g, g: 1 },
  { n: 'cls', r: /\bclass\s+(\w+)/g, g: 1 },
  { n: 'sf',  r: /\bself\b/g },
  { n: 'num', r: /\b(?:0[xXoObB][\da-fA-F_]+|\d[\d_]*(?:\.[\d_]*)?(?:[eE][+-]?\d+)?j?)\b/g },
];

function esc(t) { return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function highlight(code) {
  const tokens = [];
  for (const p of PATTERNS) {
    const re = new RegExp(p.r.source, p.r.flags);
    let m;
    while ((m = re.exec(code)) !== null) {
      if (p.g !== undefined && m[p.g]) {
        const gt = m[p.g], gs = m.index + m[0].indexOf(gt);
        tokens.push({ s: gs, e: gs + gt.length, c: p.n, t: gt });
      } else {
        tokens.push({ s: m.index, e: m.index + m[0].length, c: p.n, t: m[0] });
      }
    }
  }
  tokens.sort((a, b) => a.s - b.s);
  const filt = []; let last = 0;
  for (const t of tokens) { if (t.s >= last) { filt.push(t); last = t.e; } }
  let html = '', pos = 0;
  for (const t of filt) {
    if (t.s > pos) html += esc(code.slice(pos, t.s));
    html += `<span class="syn-${t.c}">${esc(t.t)}</span>`;
    pos = t.e;
  }
  if (pos < code.length) html += esc(code.slice(pos));
  return html + '\n';
}

function updateAll() {
  const code = textarea.value;
  highlightLayer.innerHTML = highlight(code);
  updateGutter(code);
}

function updateGutter(code) {
  const n = code.split('\n').length;
  let h = '';
  for (let i = 1; i <= n; i++) {
    let c = '';
    if (i === currentLine + 1) c = ' class="ln-active"';
    if (i === errorLine) c = ' class="ln-error"';
    h += `<div${c}>${i}</div>`;
  }
  gutter.innerHTML = h;
}

/* The textarea scrolls natively; keep the highlight layer and gutter
   aligned to its scrollTop (same padding/font/wrap => same metrics). */
function syncEditorScroll() {
  const top = textarea.scrollTop;
  highlightLayer.scrollTop = top;
  gutter.scrollTop = top;
}

function curLine() {
  return textarea.value.substring(0, textarea.selectionStart).split('\n').length - 1;
}

function insertText(text) {
  textarea.focus();
  if (document.execCommand && document.execCommand('insertText', false, text)) {
    return true;
  }
  const s = textarea.selectionStart, en = textarea.selectionEnd, v = textarea.value;
  textarea.value = v.substring(0, s) + text + v.substring(en);
  textarea.selectionStart = textarea.selectionEnd = s + text.length;
  return false;
}

function setRange(start, end) {
  textarea.selectionStart = start;
  textarea.selectionEnd = end == null ? start : end;
}

/* ─── TAB handling ─── */
function handleTab(e) {
  e.preventDefault();
  const s = textarea.selectionStart, en = textarea.selectionEnd, v = textarea.value;
  if (e.shiftKey) {
    const ls = v.lastIndexOf('\n', s - 1) + 1;
    const sel = v.substring(ls, en).split('\n');
    let rm = 0;
    const nl = sel.map((l, i) => { const m = l.match(/^ {1,4}/); if (m) { if (i === 0) rm = m[0].length; return l.slice(m[0].length); } return l; });
    const nt = nl.join('\n');
    textarea.value = v.substring(0, ls) + nt + v.substring(en);
    textarea.selectionStart = Math.max(ls, s - rm);
    textarea.selectionEnd = ls + nt.length;
  } else if (s !== en) {
    const ls = v.lastIndexOf('\n', s - 1) + 1;
    const sel = v.substring(ls, en).split('\n');
    const nt = sel.map(l => '    ' + l).join('\n');
    textarea.value = v.substring(0, ls) + nt + v.substring(en);
    textarea.selectionStart = s + 4;
    textarea.selectionEnd = ls + nt.length;
  } else {
    textarea.value = v.substring(0, s) + '    ' + v.substring(en);
    textarea.selectionStart = textarea.selectionEnd = s + 4;
  }
  updateAll(); triggerChange(); rawChanged(textarea.value);
}

/* ─── Enter with auto-indent ─── */
function handleEnter(e) {
  e.preventDefault();
  const s = textarea.selectionStart, v = textarea.value;
  const before = v.substring(0, s);
  const lineStart = before.lastIndexOf('\n') + 1;
  const lineText = before.substring(lineStart);
  const im = lineText.match(/^(\s*)/);
  let indent = im ? im[1] : '';
  if (lineText.trimEnd().endsWith(':')) indent += '    ';
  const ins = '\n' + indent;
  textarea.value = v.substring(0, s) + ins + v.substring(textarea.selectionEnd);
  textarea.selectionStart = textarea.selectionEnd = s + ins.length;
  updateAll(); triggerChange(); rawChanged(textarea.value);
}

/* ─── Auto-close brackets/quotes ─── */
const PAIRS = { '(': ')', '[': ']', '{': '}' };
const QUOTES = ['"', "'"];
// Only auto-close a quote after a character that plausibly begins a
// string: whitespace, openers, comma, colon, assignment/operators.
// (After `}` / `)` / `]` / word chars the quote is a closing quote —
// auto-closing it there is what corrupted f-strings like f"...{i**2}".
const OPEN_BEFORE = /[\s([{,:=+\-*/%<>&|^~]/;

// Pending auto-inserted closers: { pos, ch, sel? }
//   pos — index of the auto-inserted closing char in the current value
//   sel — set when a selection was wrapped; the skip may then jump over
//         the wrapped content instead of only whitespace
let pend = [];
let lastRaw = '';

function pendAdd(pos, ch, sel) {
  pend.push(sel !== undefined ? { pos, ch, sel } : { pos, ch });
}
function pendRemove(pos, ch) {
  pend = pend.filter(p => !(p.pos === pos && p.ch === ch));
}
function pendClear() {
  pend = [];
}

// Keep pending-closer positions in sync with the value after ANY edit
// (programmatic or native), using a common-prefix/suffix diff.
function reconcilePend(oldV, newV) {
  if (oldV === newV) return;
  const o = oldV.length, n = newV.length;
  let p = 0;
  while (p < o && p < n && oldV[p] === newV[p]) p++;
  let q = 0;
  while (q < o - p && q < n - p && oldV[o - 1 - q] === newV[n - 1 - q]) q++;
  const oldEnd = o - q, delta = (n - q) - oldEnd;
  const out = [];
  for (const e of pend) {
    if (e.pos < p) {
      out.push(e);
    } else if (e.pos >= oldEnd) {
      out.push({ pos: e.pos + delta, ch: e.ch, ...(e.sel !== undefined ? { sel: e.sel } : {}) });
    }
  }
  pend = out;
}

// Record a raw value change (called after every mutation) so the pending
// stack can be diff-reconciled against the previous value.
function rawChanged(v) {
  reconcilePend(lastRaw, v);
  lastRaw = v;
}

// Position right after the closer the user is typing over, or -1 if a new
// closing char should be inserted instead. Handles both the adjacent case
// (v[s] === ch) and drift cases (auto-indent pushed the cursor away from
// a pending closer, or the cursor sits inside a wrapped selection).
function findSkip(v, s, ch) {
  if (v[s] === ch) return s + 1;
  let best = -1;
  for (const e of pend) {
    if (e.ch !== ch || e.pos < s || e.pos > v.length) continue;
    if (e.sel !== undefined) {
      if (v.substring(s, e.pos) === e.sel) best = best < 0 || e.pos < best ? e.pos : best;
    } else {
      let ok = true;
      for (let i = s; i < e.pos; i++) { if (!/\s/.test(v[i])) { ok = false; break; } }
      if (ok) best = best < 0 || e.pos < best ? e.pos : best;
    }
  }
  return best >= 0 ? best + 1 : -1;
}
function handleAutoClose(e) {
  const ch = e.key, s = textarea.selectionStart, en = textarea.selectionEnd, v = textarea.value;

  if (PAIRS[ch]) {
    e.preventDefault();
    const cl = PAIRS[ch];
    if (s !== en) {
      const sel = v.substring(s, en);
      textarea.value = v.substring(0, s) + ch + sel + cl + v.substring(en);
      textarea.selectionStart = s + 1; textarea.selectionEnd = en + 1;
      updateAll(); triggerChange(); rawChanged(textarea.value);
      pendAdd(en + 1, cl, sel);
    } else {
      textarea.value = v.substring(0, s) + ch + cl + v.substring(en);
      textarea.selectionStart = textarea.selectionEnd = s + 1;
      updateAll(); triggerChange(); rawChanged(textarea.value);
      pendAdd(s + 1, cl);
    }
    return true;
  }

  if (')]}'.includes(ch)) {
    const skip = findSkip(v, s, ch);
    if (skip >= 0) {
      e.preventDefault();
      pendRemove(skip - 1, ch);
      textarea.selectionStart = textarea.selectionEnd = skip;
      return true;
    }
  }

  if (QUOTES.includes(ch)) {
    const skip = findSkip(v, s, ch);
    if (skip >= 0) {
      e.preventDefault();
      pendRemove(skip - 1, ch);
      textarea.selectionStart = textarea.selectionEnd = skip;
      return true;
    }
    if (s > 0 && !OPEN_BEFORE.test(v[s - 1])) return false;
    e.preventDefault();
    if (s !== en) {
      const sel = v.substring(s, en);
      textarea.value = v.substring(0, s) + ch + sel + ch + v.substring(en);
      textarea.selectionStart = s + 1; textarea.selectionEnd = en + 1;
      updateAll(); triggerChange(); rawChanged(textarea.value);
      pendAdd(en + 1, ch, sel);
    } else {
      textarea.value = v.substring(0, s) + ch + ch + v.substring(en);
      textarea.selectionStart = textarea.selectionEnd = s + 1;
      updateAll(); triggerChange(); rawChanged(textarea.value);
      pendAdd(s + 1, ch);
    }
    return true;
  }

  if (ch === 'Backspace' && s === en && s > 0) {
    const bef = v[s - 1], aft = v[s];
    if ((PAIRS[bef] === aft) || (QUOTES.includes(bef) && bef === aft)) {
      e.preventDefault();
      textarea.value = v.substring(0, s - 1) + v.substring(s + 1);
      textarea.selectionStart = textarea.selectionEnd = s - 1;
      updateAll(); triggerChange(); rawChanged(textarea.value); return true;
    }
  }
  return false;
}

/* ─── Debounced auto-save ─── */
let changeTimer = null;
function triggerChange() {
  if (changeTimer) clearTimeout(changeTimer);
  changeTimer = setTimeout(() => { if (onChangeCallback) onChangeCallback(textarea.value); }, 1000);
}

/* ─── PUBLIC ─── */

/* Pin the textarea/highlight box to the visible area with explicit pixel
   heights (CSS already does this with absolute inset offsets; this is a
   belt-and-braces guard so a browser that fails to resolve the layout can
   never end up with an auto-height textarea, which would silently disable
   scrolling). Also shifts the highlight layer's right edge to match a
   visible desktop scrollbar so wrapped lines stay pixel-aligned. */
function sizeEditor() {
  if (!scrollArea || !textarea || !highlightLayer) return;
  const h = scrollArea.clientHeight || window.innerHeight * 0.6;
  if (h > 0) {
    textarea.style.height = h + 'px';
    highlightLayer.style.height = h + 'px';
    highlightLayer.style.top = '0px';
    highlightLayer.style.left = '0px';
    highlightLayer.style.right = '0px';
    highlightLayer.style.bottom = '0px';
  }
  const sbw = textarea.offsetWidth - textarea.clientWidth;
  const want = sbw > 0 ? sbw + 'px' : '0px';
  if (highlightLayer.style.right !== want) highlightLayer.style.right = want;
}

export function initEditor() {
  textarea = document.getElementById('editor-textarea');
  highlightLayer = document.getElementById('highlight-layer');
  gutter = document.getElementById('line-numbers');
  scrollArea = document.getElementById('editor-scroll-area');
  fontSizeLabel = document.getElementById('font-size-label');

  const s = getSettings();
  fontSize = s.fontSize || 14;
  applyFontSize();
  lastRaw = textarea.value;

  textarea.addEventListener('input', () => { updateAll(); triggerChange(); rawChanged(textarea.value); });
  textarea.addEventListener('keydown', e => {
    if (e.key === 'Tab') { handleTab(e); return; }
    if (e.key === 'Enter' && !e.shiftKey) { handleEnter(e); return; }
    handleAutoClose(e);
  });

  // Sync highlight layer + gutter with the textarea's native scrolling
  textarea.addEventListener('scroll', syncEditorScroll);

  // Track cursor line
  const updateCur = () => { const nl = curLine(); if (nl !== currentLine) { currentLine = nl; updateGutter(textarea.value); } };
  textarea.addEventListener('click', updateCur);
  textarea.addEventListener('keyup', updateCur);
  textarea.addEventListener('focus', updateCur);

  requestAnimationFrame(() => {
    sizeEditor();
    updateAll();
    textarea.focus({ preventScroll: true });
    textarea.blur();
  });
  if (window.ResizeObserver) new ResizeObserver(() => sizeEditor()).observe(scrollArea);
  window.addEventListener('resize', sizeEditor);
  window.addEventListener('orientationchange', sizeEditor);
}

export function setCode(code) { textarea.value = code; currentLine = 0; errorLine = -1; pendClear(); lastRaw = code; updateAll(); }
export function getCode() { return textarea.value; }
export function onChange(cb) { onChangeCallback = cb; }

export function setFontSize(size) {
  fontSize = Math.max(10, Math.min(24, size));
  applyFontSize();
  const s = getSettings(); s.fontSize = fontSize; saveSettings(s);
}
export function getFontSize() { return fontSize; }

function applyFontSize() {
  document.documentElement.style.setProperty('--editor-font-size', fontSize + 'px');
  if (fontSizeLabel) fontSizeLabel.textContent = fontSize;
}

export function highlightErrorLine(ln) { errorLine = ln; updateGutter(textarea.value); }
export function clearErrorLine() { errorLine = -1; updateGutter(textarea.value); }

export function goToLine(ln) {
  const lines = textarea.value.split('\n');
  let pos = 0;
  for (let i = 0; i < ln - 1 && i < lines.length; i++) pos += lines[i].length + 1;
  textarea.focus();
  textarea.selectionStart = textarea.selectionEnd = pos;
  currentLine = ln - 1;
  updateGutter(textarea.value);
  const lh = fontSize * 1.6;
  textarea.scrollTop = Math.max(0, (ln - 1) * lh - textarea.clientHeight / 2);
}

export function insertAtCursor(text) {
  insertText(text);
  updateAll(); triggerChange(); rawChanged(textarea.value);
}

export function focusEditor() { textarea.focus(); }

export function toggleComment() {
  const s = textarea.selectionStart, en = textarea.selectionEnd, v = textarea.value;
  const ls = v.lastIndexOf('\n', s - 1) + 1;
  let le = v.indexOf('\n', Math.max(en - (en > ls && v[en - 1] === '\n' ? 1 : 0), ls));
  if (le < 0) le = v.length;
  const lines = v.substring(ls, le).split('\n');
  const allCommented = lines.every(l => !l.trim() || l.trimStart().startsWith('#'));
  const next = lines.map(l => {
    if (!l.trim()) return l;
    if (allCommented) return l.replace(/^(\s*)# ?/, '$1');
    return l.replace(/^(\s*)/, '$1# ');
  }).join('\n');
  textarea.focus();
  textarea.setSelectionRange(ls, le);
  insertText(next);
  updateAll(); triggerChange(); rawChanged(textarea.value);
}

export function findMatches(query) {
  if (!query) return [];
  const v = textarea.value;
  const out = [];
  let i = 0;
  while (i < v.length) {
    const j = v.indexOf(query, i);
    if (j < 0) break;
    out.push(j);
    i = j + Math.max(1, query.length);
  }
  return out;
}

export function selectRange(start, len) {
  textarea.focus();
  textarea.setSelectionRange(start, start + len);
  const ln = textarea.value.substring(0, start).split('\n').length;
  const lh = fontSize * 1.6;
  textarea.scrollTop = Math.max(0, (ln - 1) * lh - textarea.clientHeight / 2);
  currentLine = ln - 1;
  updateGutter(textarea.value);
}

export function replaceRange(start, len, text) {
  textarea.focus();
  textarea.setSelectionRange(start, start + len);
  insertText(text);
  updateAll(); triggerChange(); rawChanged(textarea.value);
}

export function replaceAll(query, text) {
  if (!query) return 0;
  const v = textarea.value;
  if (!v.includes(query)) return 0;
  const parts = v.split(query);
  const n = parts.length - 1;
  textarea.focus();
  textarea.setSelectionRange(0, v.length);
  insertText(parts.join(text));
  updateAll(); triggerChange(); rawChanged(textarea.value);
  return n;
}

export function getLineCount() {
  return textarea.value.split('\n').length;
}
