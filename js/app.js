/* ═══════════════════════════════════════
   PYLITE IDE — Main Application Entry
   ═══════════════════════════════════════ */

import { initEditor, setCode, getCode, onChange, setFontSize, getFontSize,
         highlightErrorLine, clearErrorLine, goToLine, toggleComment,
         findMatches, selectRange, replaceRange, replaceAll, getLineCount } from './editor.js';
import { initPyodide, setCallbacks, runCode, stopExecution,
         getIsRunning, isPyodideReady } from './executor.js';
import { initTheme, toggleTheme } from './theme.js';
import { getAllFiles, getActiveFileId, setActiveFileId, createFile,
         deleteFile, updateFileCode, ensureDefaultFile, getFileById,
         renameFile, duplicateFile, getSettings, saveSettings } from './storage.js';
import { initUI, switchPanel, clearConsole, appendConsole, appendPlot,
         showToast, setRunButtonState, showInlineInput, getConsolePlainText,
         showConfirm } from './ui.js';
import { initToolbar } from './toolbar.js';
import { renderPackageList, installCustomPackage, restoreSavedPackages } from './packages.js';
import { getCodeFromURL, generateShareURL, copyToClipboard } from './share.js';

let currentFileId = null;
let filesSidebarOpen = true;
let findIdx = 0;
let findHits = [];
let dirty = false;

const FILE_ICONS = {
  rename: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  dup: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  dl: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  del: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>',
};

const EXAMPLES = [
  {
    name: 'hello.py',
    title: 'Hello & input',
    desc: 'input() and a small loop',
    code: `name = input("What's your name? ")
print(f"Hello, {name}! Welcome to PyLite.")

for i in range(1, 6):
    print(f"  {i} squared = {i**2}")
`,
  },
  {
    name: 'plot.py',
    title: 'Matplotlib plot',
    desc: 'Install matplotlib first, then run',
    code: `import matplotlib.pyplot as plt
import math

xs = [i / 10 for i in range(0, 63)]
ys = [math.sin(x) for x in xs]
plt.plot(xs, ys)
plt.title("sine wave")
plt.xlabel("x")
plt.ylabel("sin(x)")
plt.show()
`,
  },
  {
    name: 'numpy_demo.py',
    title: 'NumPy stats',
    desc: 'Install numpy first, then run',
    code: `import numpy as np

data = np.random.default_rng(0).normal(size=8)
print("values:", np.round(data, 3))
print("mean:", round(float(data.mean()), 3))
print("std:", round(float(data.std()), 3))
`,
  },
  {
    name: 'guess.py',
    title: 'Number guess',
    desc: 'Interactive game using input()',
    code: `import random
secret = random.randint(1, 10)
print("Guess a number from 1 to 10")
for attempt in range(1, 6):
    guess = int(input(f"Attempt {attempt}: "))
    if guess == secret:
        print("You got it!")
        break
    print("Too low" if guess < secret else "Too high")
else:
    print("The number was", secret)
`,
  },
];

window._pylite_goToLine = ln => {
  goToLine(ln); switchPanel('editor'); highlightErrorLine(ln);
};

function revealApp() {
  document.getElementById('loading-screen').classList.add('fade-out');
  document.getElementById('app').classList.remove('hidden');
}

function setRuntimeChip(text, kind) {
  const el = document.getElementById('runtime-chip');
  if (!el) return;
  el.textContent = text;
  el.dataset.kind = kind || '';
  el.classList.toggle('hidden', !text);
}

function markSaved() {
  dirty = false;
  const d = document.getElementById('save-dot');
  if (d) { d.classList.remove('dirty'); d.title = 'All changes saved'; }
}

function markDirty() {
  dirty = true;
  const d = document.getElementById('save-dot');
  if (d) { d.classList.add('dirty'); d.title = 'Unsaved — autosaves shortly'; }
}

async function init() {
  initTheme();
  revealApp();
  initUI();
  initEditor();
  initToolbar();
  initFindBar();
  initSplit();
  applyFilesSidebar(getSettings().filesOpen !== false);

  ensureDefaultFile();
  loadActiveFile();

  onChange(code => {
    if (currentFileId) { updateFileCode(currentFileId, code); renderFilesList(); }
    markSaved();
  });

  const shared = getCodeFromURL();
  if (shared) {
    const f = createFile('shared.py');
    updateFileCode(f.id, shared);
    setActiveFileId(f.id);
    currentFileId = f.id;
    setCode(shared);
    updateFilename(f.name);
    renderFilesList();
    showToast('Loaded shared code');
    history.replaceState(null, '', window.location.pathname);
  }

  wireButtons();
  renderFilesList();
  renderExamples();

  setCallbacks({
    onStdout: t => appendConsole(t, 'stdout'),
    onStderr: t => {
      appendConsole(t, 'stderr');
      const m = t.match(/line (\d+)/);
      if (m) highlightErrorLine(parseInt(m[1]));
    },
    onPlot: d => appendPlot(d),
    onRunStateChange: s => setRunButtonState(s),
    onInputRequest: () => showInlineInput(),
    onLoadProgress: (msg, pct) => {
      const bar = document.getElementById('loading-bar');
      const st = document.getElementById('loading-status');
      if (st) st.textContent = msg;
      if (bar && pct !== undefined) { bar.classList.add('determinate'); bar.style.width = pct + '%'; }
      setRuntimeChip(msg || 'Loading Python…', 'loading');
    },
  });

  setRunButtonState('loading');
  setRuntimeChip('Loading Python…', 'loading');

  try {
    await initPyodide();
    setRuntimeChip('Restoring packages…', 'loading');
    await restoreSavedPackages(msg => setRuntimeChip(msg, 'loading'));
    setRuntimeChip('Python ready', 'ok');
    setRunButtonState('ready');
    setTimeout(() => setRuntimeChip('', ''), 2200);
  } catch (err) {
    setRuntimeChip('Python failed — editing only', 'err');
    showToast('Pyodide failed to load. Editing only.');
    const retry = document.getElementById('runtime-chip');
    if (retry) {
      retry.style.cursor = 'pointer';
      retry.title = 'Click to retry';
      retry.addEventListener('click', () => location.reload());
    }
  }
}

function loadActiveFile() {
  let id = getActiveFileId();
  const files = getAllFiles();
  if (!id || !files.find(f => f.id === id)) {
    if (files.length) { id = files[0].id; setActiveFileId(id); }
  }
  currentFileId = id;
  const f = getFileById(id);
  if (f) { setCode(f.code); updateFilename(f.name); }
}

function updateFilename(n) {
  const el = document.getElementById('current-filename');
  el.textContent = n;
}

function renderFilesList() {
  const c = document.getElementById('files-list');
  const files = getAllFiles();
  c.innerHTML = '';
  for (const f of files) {
    const div = document.createElement('div');
    div.className = 'file-item' + (f.id === currentFileId ? ' active' : '');
    const mod = new Date(f.lastModified);
    const ts = mod.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' +
               mod.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    const lines = (f.code || '').split('\n').length;
    div.innerHTML = `
      <div class="file-item-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>
      <div class="file-item-info"><div class="file-item-name">${esc(f.name)}</div><div class="file-item-meta">${lines} lines · ${ts}</div></div>
      <div class="file-item-actions">
        <button type="button" class="file-act-btn" data-act="rename" aria-label="Rename" title="Rename">${FILE_ICONS.rename}</button>
        <button type="button" class="file-act-btn" data-act="dup" aria-label="Duplicate" title="Duplicate">${FILE_ICONS.dup}</button>
        <button type="button" class="file-act-btn" data-act="dl" aria-label="Download" title="Download">${FILE_ICONS.dl}</button>
        <button type="button" class="file-act-btn danger" data-act="del" aria-label="Delete" title="Delete">${FILE_ICONS.del}</button>
      </div>`;
    div.addEventListener('click', e => {
      const act = e.target.closest('[data-act]');
      if (!act) { openFile(f.id); return; }
      e.stopPropagation();
      if (act.dataset.act === 'del') delFile(f.id, f.name);
      else if (act.dataset.act === 'rename') promptRename(f.id, f.name);
      else if (act.dataset.act === 'dup') dupFile(f.id);
      else if (act.dataset.act === 'dl') downloadFile(f.name, f.id === currentFileId ? getCode() : f.code);
    });
    c.appendChild(div);
  }
}

function openFile(id) {
  if (currentFileId) updateFileCode(currentFileId, getCode());
  currentFileId = id; setActiveFileId(id);
  const f = getFileById(id);
  if (f) { setCode(f.code); updateFilename(f.name); clearErrorLine(); }
  markSaved();
  renderFilesList(); switchPanel('editor');
}

function newFile() {
  if (currentFileId) updateFileCode(currentFileId, getCode());
  const f = createFile();
  currentFileId = f.id; setActiveFileId(f.id);
  setCode(''); updateFilename(f.name); clearErrorLine();
  markSaved();
  renderFilesList(); switchPanel('editor');
  showToast('Created ' + f.name);
}

function dupFile(id) {
  if (currentFileId) updateFileCode(currentFileId, getCode());
  const f = duplicateFile(id);
  if (!f) return;
  currentFileId = f.id; setActiveFileId(f.id);
  setCode(f.code); updateFilename(f.name); clearErrorLine();
  renderFilesList(); switchPanel('editor');
  showToast('Duplicated ' + f.name);
}

async function delFile(id, name) {
  if (getAllFiles().length <= 1) { showToast('Cannot delete the last file'); return; }
  const ok = await showConfirm({ title: 'Delete file', message: `Delete “${name}”? This cannot be undone.`, okLabel: 'Delete', danger: true });
  if (!ok) return;
    const rem = deleteFile(id);
    if (id === currentFileId) {
      const nx = rem[0];
      currentFileId = nx.id; setActiveFileId(nx.id);
      setCode(nx.code); updateFilename(nx.name); clearErrorLine();
    }
    markSaved();
    renderFilesList(); showToast('Deleted ' + name);
}

function promptRename(id, current) {
  const overlay = document.getElementById('rename-overlay');
  const input = document.getElementById('rename-input');
  input.value = current;
  overlay.classList.remove('hidden');
  requestAnimationFrame(() => { input.focus(); input.select(); });
  let settled = false;
  const finish = apply => {
    if (settled) return;
    settled = true;
    overlay.classList.add('hidden');
    document.getElementById('rename-ok').onclick = null;
    document.getElementById('rename-cancel').onclick = null;
    overlay.onclick = null;
    overlay.removeEventListener('overlay-close', onClose);
    input.onkeydown = null;
    if (!apply) return;
    const f = renameFile(id, input.value);
    if (!f) return;
    if (id === currentFileId) updateFilename(f.name);
    renderFilesList();
    showToast('Renamed to ' + f.name);
  };
  const onClose = () => finish(false);
  document.getElementById('rename-ok').onclick = () => finish(true);
  document.getElementById('rename-cancel').onclick = () => finish(false);
  overlay.onclick = e => { if (e.target === overlay) finish(false); };
  overlay.addEventListener('overlay-close', onClose);
  input.onkeydown = e => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  };
}

function downloadFile(name, code) {
  const blob = new Blob([code ?? ''], { type: 'text/x-python' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name || 'script.py';
  a.click();
  URL.revokeObjectURL(a.href);
}

function importFiles(fileList) {
  const list = Array.from(fileList || []);
  if (!list.length) return;
  let last = null;
  const readers = list.map(file => new Promise(resolve => {
    const r = new FileReader();
    r.onload = () => {
      const created = createFile(file.name);
      updateFileCode(created.id, String(r.result || ''));
      last = created;
      resolve();
    };
    r.onerror = () => resolve();
    r.readAsText(file);
  }));
  Promise.all(readers).then(() => {
    if (last) openFile(last.id);
    renderFilesList();
    showToast(list.length === 1 ? 'Opened ' + list[0].name : 'Opened ' + list.length + ' files');
  });
}

function renderExamples() {
  const list = document.getElementById('examples-list');
  if (!list) return;
  list.innerHTML = '';
  for (const ex of EXAMPLES) {
    const div = document.createElement('div');
    div.className = 'pkg-item';
    div.innerHTML = `<div><div class="pkg-name">${esc(ex.title)}</div><div class="pkg-desc">${esc(ex.desc)}</div></div>`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-install';
    btn.textContent = 'Open';
    btn.addEventListener('click', () => {
      const f = createFile(ex.name);
      updateFileCode(f.id, ex.code);
      openFile(f.id);
      document.getElementById('examples-overlay').classList.add('hidden');
      showToast('Opened ' + ex.name);
    });
    div.appendChild(btn);
    list.appendChild(div);
  }
}

function wireButtons() {
  document.getElementById('btn-run').addEventListener('click', doRunStop);
  document.getElementById('btn-run-desktop').addEventListener('click', doRunStop);
  document.getElementById('btn-files-desktop').addEventListener('click', toggleFilesDrawer);
  window.addEventListener('resize', () => {
    const container = document.getElementById('panels-container');
    if (!container) return;
    if (window.innerWidth >= 768) applyFilesSidebar(filesSidebarOpen);
  });
  const filesBackdrop = document.getElementById('files-backdrop');
  if (filesBackdrop) filesBackdrop.addEventListener('click', () => { if (filesSidebarOpen && window.innerWidth < 768) toggleFilesDrawer(); });
  document.getElementById('btn-font-up').addEventListener('click', () => setFontSize(getFontSize() + 1));
  document.getElementById('btn-font-down').addEventListener('click', () => setFontSize(getFontSize() - 1));
  document.getElementById('font-size-label').addEventListener('click', () => setFontSize(14));
  document.getElementById('btn-theme').addEventListener('click', toggleTheme);
  document.getElementById('btn-share').addEventListener('click', doShare);
  document.getElementById('btn-new-file').addEventListener('click', newFile);
  document.getElementById('btn-import-file').addEventListener('click', () => document.getElementById('file-import').click());
  document.getElementById('file-import').addEventListener('change', e => {
    importFiles(e.target.files);
    e.target.value = '';
  });
  document.getElementById('current-filename').addEventListener('click', () => {
    if (currentFileId) {
      const f = getFileById(currentFileId);
      if (f) promptRename(f.id, f.name);
    }
  });
  document.getElementById('btn-packages').addEventListener('click', () => {
    document.getElementById('pkg-modal-overlay').classList.remove('hidden');
    renderPackageList(document.getElementById('pkg-list'));
    if (!isPyodideReady()) showToast('Python is still loading…');
  });
  document.getElementById('pkg-modal-close').addEventListener('click', () =>
    document.getElementById('pkg-modal-overlay').classList.add('hidden')
  );
  document.getElementById('pkg-modal-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) document.getElementById('pkg-modal-overlay').classList.add('hidden');
  });
  document.getElementById('btn-pkg-custom-install').addEventListener('click', doCustomPkg);
  document.getElementById('pkg-custom-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') doCustomPkg();
  });

  document.getElementById('btn-examples').addEventListener('click', () =>
    document.getElementById('examples-overlay').classList.remove('hidden'));
  document.getElementById('examples-close').addEventListener('click', () =>
    document.getElementById('examples-overlay').classList.add('hidden'));
  document.getElementById('examples-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) document.getElementById('examples-overlay').classList.add('hidden');
  });
  document.getElementById('btn-help').addEventListener('click', () =>
    document.getElementById('help-overlay').classList.remove('hidden'));
  document.getElementById('help-close').addEventListener('click', () =>
    document.getElementById('help-overlay').classList.add('hidden'));
  document.getElementById('help-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) document.getElementById('help-overlay').classList.add('hidden');
  });

  document.getElementById('btn-console-clear').addEventListener('click', () => { clearConsole(); showToast('Console cleared'); });
  document.getElementById('btn-console-copy').addEventListener('click', async () => {
    const t = getConsolePlainText();
    if (!t) { showToast('Nothing to copy'); return; }
    await copyToClipboard(t);
    showToast('Output copied');
  });

  document.getElementById('editor-textarea').addEventListener('input', markDirty);

  document.addEventListener('keydown', e => {
    const mod = e.ctrlKey || e.metaKey;
    const inModal = e.target.closest && e.target.closest('.modal-overlay:not(.hidden)');
    if (inModal && e.key !== 'Escape') return;
    if (mod && e.key === 'Enter') { e.preventDefault(); doRunStop(); }
    if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (currentFileId) { updateFileCode(currentFileId, getCode()); markSaved(); showToast('Saved'); }
    }
    if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); openFind(); }
    if (mod && e.key.toLowerCase() === 'g') { e.preventDefault(); openGoto(); }
    if (mod && e.key === '/') { e.preventDefault(); toggleComment(); }
    if (mod && e.key.toLowerCase() === 'n') { e.preventDefault(); newFile(); }
    if (e.key === 'Escape') {
      const overlays = ['confirm-overlay', 'rename-overlay', 'goto-overlay', 'pkg-modal-overlay', 'examples-overlay', 'help-overlay'];
      for (const id of overlays) {
        const el = document.getElementById(id);
        if (el && !el.classList.contains('hidden')) {
          el.classList.add('hidden');
          el.dispatchEvent(new CustomEvent('overlay-close'));
          e.preventDefault();
          return;
        }
      }
      const fb = document.getElementById('find-bar');
      if (fb && !fb.classList.contains('hidden')) { fb.classList.add('hidden'); e.preventDefault(); }
    }
  });
}

function applyFilesSidebar(open) {
  filesSidebarOpen = !!open;
  const container = document.getElementById('panels-container');
  const btn = document.getElementById('btn-files-desktop');
  if (container) container.classList.toggle('files-collapsed', !filesSidebarOpen);
  if (btn) {
    btn.classList.toggle('active', filesSidebarOpen);
    btn.setAttribute('aria-pressed', filesSidebarOpen ? 'true' : 'false');
    btn.title = filesSidebarOpen ? 'Hide files sidebar' : 'Show files sidebar';
  }
  const s = getSettings();
  s.filesOpen = filesSidebarOpen;
  saveSettings(s);
}

function toggleFilesDrawer() {
  applyFilesSidebar(!filesSidebarOpen);
}

function initFindBar() {
  const bar = document.getElementById('find-bar');
  const q = document.getElementById('find-input');
  const r = document.getElementById('replace-input');
  const count = document.getElementById('find-count');
  const refresh = () => {
    findHits = findMatches(q.value);
    if (!findHits.length) { count.textContent = q.value ? '0' : ''; return; }
    if (findIdx >= findHits.length) findIdx = 0;
    count.textContent = (findIdx + 1) + '/' + findHits.length;
    selectRange(findHits[findIdx], q.value.length);
  };
  q.addEventListener('input', () => { findIdx = 0; refresh(); });
  q.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); findIdx = e.shiftKey ? findIdx - 1 : findIdx + 1; if (findIdx < 0) findIdx = findHits.length - 1; refresh(); }
    if (e.key === 'Escape') bar.classList.add('hidden');
  });
  document.getElementById('find-next').addEventListener('click', () => { findIdx++; refresh(); });
  document.getElementById('find-prev').addEventListener('click', () => { findIdx--; if (findIdx < 0) findIdx = Math.max(0, findHits.length - 1); refresh(); });
  document.getElementById('find-replace').addEventListener('click', () => {
    if (!q.value || !findHits.length) return;
    replaceRange(findHits[findIdx], q.value.length, r.value);
    refresh();
  });
  document.getElementById('find-replace-all').addEventListener('click', () => {
    const n = replaceAll(q.value, r.value);
    showToast(n ? `Replaced ${n}` : 'No matches');
    refresh();
  });
  document.getElementById('find-close').addEventListener('click', () => bar.classList.add('hidden'));
}

function openFind() {
  const bar = document.getElementById('find-bar');
  bar.classList.remove('hidden');
  const q = document.getElementById('find-input');
  const ta = document.getElementById('editor-textarea');
  if (ta && ta.selectionStart !== ta.selectionEnd) {
    q.value = ta.value.substring(ta.selectionStart, ta.selectionEnd);
    q.dispatchEvent(new Event('input'));
  }
  q.focus(); q.select();
}

function openGoto() {
  const overlay = document.getElementById('goto-overlay');
  const input = document.getElementById('goto-input');
  overlay.classList.remove('hidden');
  input.value = '';
  input.max = String(getLineCount());
  requestAnimationFrame(() => input.focus());
  let settled = false;
  const finish = go => {
    if (settled) return;
    settled = true;
    overlay.classList.add('hidden');
    document.getElementById('goto-ok').onclick = null;
    document.getElementById('goto-cancel').onclick = null;
    overlay.onclick = null;
    overlay.removeEventListener('overlay-close', onClose);
    input.onkeydown = null;
    if (!go) return;
    const n = parseInt(input.value, 10);
    if (n > 0) { goToLine(n); switchPanel('editor'); }
  };
  const onClose = () => finish(false);
  document.getElementById('goto-ok').onclick = () => finish(true);
  document.getElementById('goto-cancel').onclick = () => finish(false);
  overlay.onclick = e => { if (e.target === overlay) finish(false); };
  overlay.addEventListener('overlay-close', onClose);
  input.onkeydown = e => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  };
}

function initSplit() {
  const resizer = document.getElementById('split-resizer');
  const container = document.getElementById('panels-container');
  if (!resizer || !container) return;
  let dragging = false;
  resizer.addEventListener('pointerdown', e => {
    if (window.innerWidth < 768) return;
    dragging = true;
    resizer.setPointerCapture(e.pointerId);
    document.body.style.cursor = 'col-resize';
    e.preventDefault();
  });
  resizer.addEventListener('pointermove', e => {
    if (!dragging) return;
    const rect = container.getBoundingClientRect();
    const cols = getComputedStyle(container).gridTemplateColumns.split(' ');
    const filesPx = parseFloat(cols[0]) || 0;
    const avail = Math.max(1, rect.width - filesPx - 6);
    const x = e.clientX - rect.left - filesPx;
    const pct = Math.min(75, Math.max(25, (x / avail) * 100));
    container.style.setProperty('--editor-col', pct + 'fr');
    container.style.setProperty('--console-col', (100 - pct) + 'fr');
  });
  const stop = () => { dragging = false; document.body.style.cursor = ''; };
  resizer.addEventListener('pointerup', stop);
  resizer.addEventListener('pointercancel', stop);
}

function ensureRepl() {
  let row = document.getElementById('repl-row');
  const consoleEl = document.getElementById('console-output');
  if (row) {
    if (row.parentNode === consoleEl && row.nextSibling) consoleEl.appendChild(row);
    return row;
  }
  row = document.createElement('div');
  row.id = 'repl-row';
  row.className = 'console-input-row repl-row';
  row.innerHTML = `<span class="repl-ps1">&gt;&gt;&gt;</span><input type="text" class="console-input" id="repl-input" placeholder="Continue in the REPL…" autocomplete="off" spellcheck="false">`;
  consoleEl.appendChild(row);
  const input = row.querySelector('#repl-input');
  input.addEventListener('keydown', async e => {
    if (e.key !== 'Enter') return;
    const line = input.value;
    if (!line.trim()) return;
    if (!isPyodideReady() || getIsRunning()) return;
    input.value = '';
    appendConsole('>>> ' + line, 'input-echo');
    await runCode(line);
    ensureRepl();
    document.getElementById('repl-input')?.focus();
  });
  return row;
}

async function doRunStop() {
  if (getIsRunning()) { stopExecution(); return; }
  if (!isPyodideReady()) { showToast('Python is still loading…'); return; }
  if (currentFileId) updateFileCode(currentFileId, getCode());
  clearConsole(); clearErrorLine();
  if (window.innerWidth < 768) switchPanel('console');
  const code = getCode();
  if (!code.trim()) { appendConsole('No code to run.', 'system'); return; }
  appendConsole('Running…', 'system');
  await runCode(code);
  appendConsole('Finished.', 'system');
  ensureRepl();
}

async function doShare() {
  const code = getCode();
  if (!code.trim()) { showToast('Nothing to share'); return; }
  const result = generateShareURL(code);
  if (!result) { showToast('Could not create link'); return; }
  if (result.tooLong) {
    showToast('Code is too long for a URL — downloading file instead');
    const f = currentFileId ? getFileById(currentFileId) : null;
    downloadFile(f ? f.name : 'shared.py', code);
    return;
  }
  const ok = await copyToClipboard(result.url);
  if (ok) showToast('Share URL copied!');
  else window.prompt('Copy this URL:', result.url);
}

async function doCustomPkg() {
  const inp = document.getElementById('pkg-custom-input');
  const btn = document.getElementById('btn-pkg-custom-install');
  const name = inp.value.trim();
  if (!name) return;
  btn.disabled = true; btn.textContent = 'Installing…';
  try {
    await installCustomPackage(name);
    inp.value = '';
    showToast(name + ' installed!');
    renderPackageList(document.getElementById('pkg-list'));
  } catch (err) {
    showToast('Failed: ' + (err.message || err));
  } finally {
    btn.textContent = 'Install'; btn.disabled = false;
  }
}

function esc(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

init().catch(err => {
  console.error(err);
  revealApp();
});
