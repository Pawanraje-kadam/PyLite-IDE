/* ═══════════════════════════════════════
   PYLITE IDE — Main Application Entry
   ═══════════════════════════════════════ */

import { initEditor, setCode, getCode, onChange, setFontSize, getFontSize,
         highlightErrorLine, clearErrorLine, goToLine } from './editor.js';
import { initPyodide, setCallbacks, runCode, stopExecution,
         getIsRunning, isPyodideReady } from './executor.js';
import { initTheme, toggleTheme } from './theme.js';
import { getAllFiles, getActiveFileId, setActiveFileId, createFile,
         deleteFile, updateFileCode, ensureDefaultFile, getFileById } from './storage.js';
import { initUI, switchPanel, clearConsole, appendConsole, appendPlot,
         showToast, setRunButtonState, showInlineInput,
         appendTerminal, clearTerminal } from './ui.js';
import { initToolbar } from './toolbar.js';
import { renderPackageList, installCustomPackage } from './packages.js';
import { getCodeFromURL, generateShareURL, copyToClipboard } from './share.js';

let currentFileId = null;
let filesDrawerOpen = false;

window.__pylite_run_terminal_command = async code => {
  appendTerminal('>>> ' + code, 'input');
  try {
    await runCode(code, {
      onStdout: t => appendTerminal(t, 'stdout'),
      onStderr: t => appendTerminal(t, 'stderr'),
      onRunStateChange: s => setRunButtonState(s),
      onInputRequest: () => null,
    });
  } catch (err) {
    appendTerminal(err?.message || String(err), 'stderr');
  }
};

/* ─── Global for error-line click ─── */
window._pylite_goToLine = ln => {
  goToLine(ln); switchPanel('editor'); highlightErrorLine(ln);
};

/* ═══════ INIT ═══════ */
async function init() {
  // 1. Theme first (html already has data-theme="dark" as fallback)
  initTheme();

  // 2. UI (navigation, viewport handling)
  initUI();

  // 3. Editor
  initEditor();

  // 4. Symbol toolbar
  initToolbar();

  // 5. Files
  ensureDefaultFile();
  loadActiveFile();

  // 6. Auto-save
  onChange(code => {
    if (currentFileId) { updateFileCode(currentFileId, code); renderFilesList(); }
  });

  // 7. Shared code via URL
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

  // 8. Wire buttons
  wireButtons();

  // 9. Render files
  renderFilesList();

  // 10. Executor callbacks
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
    },
  });

  // 11. Load Pyodide
  const bar = document.getElementById('loading-bar');
  const st = document.getElementById('loading-status');
  try {
    st.textContent = 'Loading Pyodide WebAssembly…';
    bar.classList.add('determinate'); bar.style.width = '30%';
    await initPyodide();
    bar.style.width = '100%'; st.textContent = 'Ready!';
    setTimeout(() => {
      document.getElementById('loading-screen').classList.add('fade-out');
      document.getElementById('app').classList.remove('hidden');
      setRunButtonState('ready');
    }, 400);
  } catch (err) {
    st.textContent = 'Error: ' + err.message;
    bar.style.background = 'var(--error-text)'; bar.style.width = '100%';
    setTimeout(() => {
      document.getElementById('loading-screen').classList.add('fade-out');
      document.getElementById('app').classList.remove('hidden');
      showToast('Pyodide failed to load. Editing only.');
    }, 2000);
  }
}

/* ═══════ FILES ═══════ */
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

function updateFilename(n) { document.getElementById('current-filename').textContent = n; }

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
      <button class="file-item-delete" aria-label="Delete"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>`;
    div.addEventListener('click', e => { if (!e.target.closest('.file-item-delete')) openFile(f.id); });
    div.querySelector('.file-item-delete').addEventListener('click', e => { e.stopPropagation(); delFile(f.id, f.name); });
    c.appendChild(div);
  }
}

function openFile(id) {
  if (currentFileId) updateFileCode(currentFileId, getCode());
  currentFileId = id; setActiveFileId(id);
  const f = getFileById(id);
  if (f) { setCode(f.code); updateFilename(f.name); clearErrorLine(); }
  renderFilesList(); switchPanel('editor');
  // Close files drawer on desktop
  if (filesDrawerOpen) toggleFilesDrawer();
}

function newFile() {
  if (currentFileId) updateFileCode(currentFileId, getCode());
  const f = createFile();
  currentFileId = f.id; setActiveFileId(f.id);
  setCode(''); updateFilename(f.name); clearErrorLine();
  renderFilesList(); switchPanel('editor');
  showToast('Created ' + f.name);
}

function delFile(id, name) {
  if (getAllFiles().length <= 1) { showToast('Cannot delete the last file'); return; }
  if (!confirm('Delete "' + name + '"?')) return;
  const rem = deleteFile(id);
  if (id === currentFileId) {
    const nx = rem[0];
    currentFileId = nx.id; setActiveFileId(nx.id);
    setCode(nx.code); updateFilename(nx.name); clearErrorLine();
  }
  renderFilesList(); showToast('Deleted ' + name);
}

/* ═══════ BUTTONS ═══════ */
function wireButtons() {
  // Run (mobile)
  document.getElementById('btn-run').addEventListener('click', doRunStop);
  // Run (desktop)
  document.getElementById('btn-run-desktop').addEventListener('click', doRunStop);
  // Files drawer (desktop)
  document.getElementById('btn-files-desktop').addEventListener('click', toggleFilesDrawer);
  // Font
  document.getElementById('btn-font-up').addEventListener('click', () => setFontSize(getFontSize() + 1));
  document.getElementById('btn-font-down').addEventListener('click', () => setFontSize(getFontSize() - 1));
  // Theme
  document.getElementById('btn-theme').addEventListener('click', toggleTheme);
  // Share
  document.getElementById('btn-share').addEventListener('click', doShare);
  // New file
  document.getElementById('btn-new-file').addEventListener('click', newFile);
  // Packages
  document.getElementById('btn-packages').addEventListener('click', () => {
    document.getElementById('pkg-modal-overlay').classList.remove('hidden');
    renderPackageList(document.getElementById('pkg-list'));
  });
  document.getElementById('pkg-modal-close').addEventListener('click', () =>
    document.getElementById('pkg-modal-overlay').classList.add('hidden')
  );
  document.getElementById('pkg-modal-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) document.getElementById('pkg-modal-overlay').classList.add('hidden');
  });
  // Custom pkg
  document.getElementById('btn-pkg-custom-install').addEventListener('click', doCustomPkg);
  document.getElementById('pkg-custom-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') doCustomPkg();
  });
  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); doRunStop(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      if (currentFileId) { updateFileCode(currentFileId, getCode()); showToast('Saved'); }
    }
  });
}

function toggleFilesDrawer() {
  filesDrawerOpen = !filesDrawerOpen;
  const p = document.getElementById('panel-files');
  if (filesDrawerOpen) { p.classList.add('active'); renderFilesList(); }
  else p.classList.remove('active');
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
}

async function doShare() {
  const code = getCode();
  if (!code.trim()) { showToast('Nothing to share'); return; }
  const url = generateShareURL(code);
  if (url) {
    const ok = await copyToClipboard(url);
    if (ok) showToast('Share URL copied!');
    else window.prompt('Copy this URL:', url);
  }
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

/* ─── START ─── */
init();
