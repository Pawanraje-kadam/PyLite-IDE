/* ═══════════════════════════════════════
   UI — Panel navigation, viewport,
   console output, toast, run-button state
   ═══════════════════════════════════════ */

let activePanel = 'editor';
let consoleEl = null;

export function initUI() {
  consoleEl = document.getElementById('console-output');
  initNavigation();
  initViewport();
}

/* ─── PANEL NAVIGATION ─── */
function initNavigation() {
  document.querySelectorAll('.nav-tab').forEach(tab =>
    tab.addEventListener('click', () => switchPanel(tab.dataset.tab))
  );
}

export function switchPanel(name) {
  activePanel = name;
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  const el = document.getElementById('panel-' + name);
  if (el) el.classList.add('active');
  document.querySelectorAll('.nav-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === name)
  );
  if (name === 'console') requestAnimationFrame(() => { consoleEl.scrollTop = consoleEl.scrollHeight; });
}

export function getActivePanel() { return activePanel; }

/* ─── VIEWPORT / KEYBOARD ─── */
function initViewport() {
  if (!window.visualViewport) return;
  const app = document.getElementById('app');
  const onResize = () => {
    const diff = window.innerHeight - window.visualViewport.height;
    if (diff > 100) {
      app.classList.add('keyboard-visible');
      app.style.height = window.visualViewport.height + 'px';
    } else {
      app.classList.remove('keyboard-visible');
      app.style.height = '';
    }
  };
  window.visualViewport.addEventListener('resize', onResize);
  window.visualViewport.addEventListener('scroll', onResize);
}

/* ─── CONSOLE OUTPUT ─── */
const PH = `<div class="console-placeholder" id="console-placeholder">
  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="1.5">
    <polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>
  </svg><p>Run your code to see output here</p></div>`;

export function clearConsole() { if (consoleEl) consoleEl.innerHTML = PH; }

function rmPh() { const p = document.getElementById('console-placeholder'); if (p) p.remove(); }

function escHtml(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

export function appendConsole(text, type) {
  rmPh();
  const el = document.createElement('div');
  el.className = 'console-line';
  if (type === 'stderr') el.className += ' stderr';
  if (type === 'system') el.className += ' system';
  if (type === 'input-echo') el.className += ' input-echo';

  if (type === 'stderr') {
    let h = escHtml(text);
    h = h.replace(/line (\d+)/g, (m, n) =>
      `<span class="console-error-line" data-line="${n}">${m}</span>`
    );
    el.innerHTML = h;
    el.querySelectorAll('.console-error-line').forEach(span =>
      span.addEventListener('click', () => {
        const ln = parseInt(span.dataset.line);
        if (ln && window._pylite_goToLine) window._pylite_goToLine(ln);
      })
    );
  } else {
    el.textContent = text;
  }
  consoleEl.appendChild(el);
  consoleEl.scrollTop = consoleEl.scrollHeight;
}

export function appendPlot(b64) {
  rmPh();
  const img = document.createElement('img');
  img.className = 'console-plot';
  img.src = 'data:image/png;base64,' + b64;
  img.alt = 'Matplotlib plot';
  consoleEl.appendChild(img);
  consoleEl.scrollTop = consoleEl.scrollHeight;
}

/* ─── INLINE INPUT (for Python input()) ───
   Shows an input row at the bottom of the console panel and returns
   { submit(fn), cancel(fn) }: submit(value) resumes Python with the
   typed value (echoed with .input-echo), cancel() aborts the prompt.
   The keyboard/viewport handling from initViewport() keeps the row
   visible above the on-screen keyboard. */
export function showInlineInput() {
  rmPh();
  switchPanel('console');

  const row = document.createElement('div');
  row.className = 'console-input-row';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'console-input';
  input.placeholder = 'Type a value and press Enter';
  input.spellcheck = false;
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('autocapitalize', 'none');
  input.setAttribute('autocorrect', 'off');
  input.setAttribute('enterkeyhint', 'done');

  const ok = document.createElement('button');
  ok.type = 'button';
  ok.className = 'console-input-btn console-input-ok';
  ok.textContent = 'OK';

  const cx = document.createElement('button');
  cx.type = 'button';
  cx.className = 'console-input-btn console-input-cancel';
  cx.setAttribute('aria-label', 'Cancel input');
  cx.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

  row.append(input, ok, cx);
  consoleEl.appendChild(row);
  consoleEl.scrollTop = consoleEl.scrollHeight;

  let finished = false;
  const finish = () => { if (finished) return; finished = true; row.remove(); };

  let submitFn = null, cancelFn = null;
  const doSubmit = () => {
    const v = input.value;
    finish();
    appendConsole(v, 'input-echo');
    if (submitFn) submitFn(v);
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doSubmit(); } });
  ok.addEventListener('click', doSubmit);
  cx.addEventListener('click', () => { finish(); if (cancelFn) cancelFn(); });
  input.addEventListener('focus', () => { consoleEl.scrollTop = consoleEl.scrollHeight; });
  requestAnimationFrame(() => input.focus());

  return {
    submit: fn => { submitFn = fn; },
    cancel: fn => { cancelFn = fn; },
  };
}

/* ─── TOAST ─── */
let toastTimer = null;
export function showToast(msg, dur) {
  dur = dur || 2500;
  const t = document.getElementById('toast'), m = document.getElementById('toast-msg');
  m.textContent = msg;
  t.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), dur);
}

/* ─── RUN BUTTON STATE ─── */
export function setRunButtonState(state) {
  // Mobile button
  const btn = document.getElementById('btn-run');
  const ri = document.getElementById('run-icon');
  const si = document.getElementById('stop-icon');
  // Desktop button
  const btnD = document.getElementById('btn-run-desktop');
  const riD = document.getElementById('run-icon-desk');
  const siD = document.getElementById('stop-icon-desk');

  const setBtn = (b, r, s, running) => {
    if (!b) return;
    if (state === 'loading') { b.disabled = true; r.classList.remove('hidden'); s.classList.add('hidden'); b.classList.remove('running'); }
    else if (state === 'ready') { b.disabled = false; r.classList.remove('hidden'); s.classList.add('hidden'); b.classList.remove('running'); }
    else if (state === 'running') { b.disabled = false; r.classList.add('hidden'); s.classList.remove('hidden'); b.classList.add('running'); }
  };
  setBtn(btn, ri, si);
  setBtn(btnD, riD, siD);
}
