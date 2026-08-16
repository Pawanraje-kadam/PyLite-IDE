/* ═══════════════════════════════════════
   EXECUTION ENGINE — Pyodide runtime
   stdout/stderr capture, inline input(),
   matplotlib inline plots, interrupt support
   ═══════════════════════════════════════

   Pyodide runs in a Web Worker (js/pyodide-worker.js) whenever
   SharedArrayBuffer is available (cross-origin isolated page, see
   /_headers and /vercel.json). Python's input() then blocks in the
   worker with Atomics.wait while the UI thread shows an inline input
   row in the console panel — no native popups, no page freeze.

   Without SharedArrayBuffer the app falls back to running Pyodide on
   the main thread with a native prompt (existing behavior) so it
   still works on hosts that cannot set COOP/COEP headers.
   ═══════════════════════════════════════ */

let pyodide = null;          // main-thread mode
let worker = null;           // worker mode
let useWorker = false;
let isRunning = false;
let interruptBuffer = null;  // main-thread mode
let sab = null;              // worker mode: { signal, data, interrupt }

function cleanupWorker() {
  if (worker) {
    try { worker.terminate(); } catch (_) {}
  }
  worker = null;
  sab = null;
}

let onStdout = null, onStderr = null, onPlot = null;
let onRunStateChange = null, onLoadProgress = null, onInputRequest = null;

const INPUT_BUF_SIZE = 65536;

export function setCallbacks(cbs) {
  onStdout = cbs.onStdout || null;
  onStderr = cbs.onStderr || null;
  onPlot = cbs.onPlot || null;
  onRunStateChange = cbs.onRunStateChange || null;
  onLoadProgress = cbs.onLoadProgress || null;
  // onInputRequest() is called when Python requests input(); it should
  // return { submit(value), cancel() } (see ui.js showInlineInput).
  onInputRequest = cbs.onInputRequest || null;
}

/* ─── Worker plumbing ─── */
let msgSeq = 0;
let pending = new Map();               // id → callback(m)
let initResolve = null, initReject = null;

function workerPost(o) { worker.postMessage(o); }

function handleWorkerMessage(e) {
  const m = e.data;
  switch (m.type) {
    case 'init-done':
      if (initResolve) { const r = initResolve; initResolve = null; r(); }
      break;
    case 'init-error':
      if (initReject) { const r = initReject; initReject = null; r(new Error(m.message)); }
      break;
    case 'stdout':
      if (onStdout) onStdout(m.text);
      break;
    case 'stderr':
      if (onStderr) onStderr(m.text);
      break;
    case 'plot':
      if (onPlot) onPlot(m.data);
      break;
    case 'stdin': {
      // Show the inline input row; resolve it by writing the value
      // into the shared data buffer and waking the worker.
      if (onInputRequest) {
        const cbs = onInputRequest();
        if (cbs) {
          cbs.submit(v => writeStdin(v));
          cbs.cancel(() => { writeStdin(''); Atomics.store(sab.interrupt, 0, 2); });
          break;
        }
      }
      writeStdin(''); // no UI wired → EOF
      break;
    }
    case 'done':
    case 'error': {
      const cb = pending.get(m.id);
      if (cb) { pending.delete(m.id); cb(m); }
      break;
    }
  }
}

/* Write one input value into the shared buffer and wake the worker. */
function writeStdin(v) {
  if (!sab) return;
  const u8 = sab.data;
  const bytes = new TextEncoder().encode(String(v));
  const n = Math.min(bytes.length, u8.length - 1);
  u8.set(bytes.subarray(0, n));
  u8[n] = 0;
  Atomics.store(sab.signal, 0, 1);
  Atomics.notify(sab.signal, 0);
}

function initWorker() {
  return new Promise((resolve, reject) => {
    initResolve = resolve;
    initReject = reject;
    worker = new Worker('js/pyodide-worker.js');
    sab = {
      signal: new Int32Array(new SharedArrayBuffer(4)),
      data: new Uint8Array(new SharedArrayBuffer(INPUT_BUF_SIZE)),
      interrupt: new Int32Array(new SharedArrayBuffer(4)),
    };
    worker.onmessage = handleWorkerMessage;
    worker.onerror = err => {
      if (initReject) { const r = initReject; initReject = null; r(new Error(err.message || 'Worker failed')); }
      for (const [id, cb] of pending) { pending.delete(id); cb({ type: 'error', id, message: err.message || 'Worker crashed' }); }
    };
    workerPost({ type: 'init', sab: { signal: sab.signal.buffer, data: sab.data.buffer, interrupt: sab.interrupt.buffer } });
  });
}

/* ─── Init ─── */
export async function initPyodide() {
  if (onLoadProgress) onLoadProgress('Loading Pyodide runtime…', 20);
  try {
    const canUseWorker = typeof SharedArrayBuffer !== 'undefined' &&
      typeof Worker !== 'undefined' &&
      window.crossOriginIsolated === true;

    useWorker = false;
    cleanupWorker();

    if (canUseWorker) {
      try {
        await initWorker();
        useWorker = true;
      } catch (err) {
        cleanupWorker();
        if (onLoadProgress) onLoadProgress('Worker runtime unavailable; using fallback runtime…', 35);
      }
    } else if (onLoadProgress) {
      onLoadProgress('Using fallback runtime for this browser…', 35);
    }

    if (!useWorker) {
      if (typeof loadPyodide !== 'function') {
        throw new Error('Pyodide failed to load from the CDN');
      }
      pyodide = await loadPyodide({ indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.27.5/full/' });
    }
  } catch (err) {
    cleanupWorker();
    if (onLoadProgress) onLoadProgress('Failed: ' + err.message, 0);
    throw err;
  }

  if (onLoadProgress) onLoadProgress('Configuring runtime…', 60);

  if (!useWorker) {
    // Main-thread fallback: interrupt buffer when available
    if (typeof SharedArrayBuffer !== 'undefined') {
      interruptBuffer = new Int32Array(new SharedArrayBuffer(4));
      pyodide.setInterruptBuffer(interruptBuffer);
    }

    pyodide.setStdout({ batched: t => { if (onStdout) onStdout(t); } });
    pyodide.setStderr({ batched: t => { if (onStderr) onStderr(t); } });

    // stdin — native prompt fallback (no SharedArrayBuffer available)
    pyodide.setStdin({
      stdin: () => {
        const r = window.prompt('Python input:', '');
        const val = r === null ? '' : r;
        if (onStdout) onStdout(val);
        return val;
      }
    });

    // Global for matplotlib hook
    window.__pylite_show_plot = d => { if (onPlot) onPlot(d); };
  }

  if (onLoadProgress) onLoadProgress('Ready!', 100);
  return pyodide;
}

export function isPyodideReady() { return pyodide !== null || worker !== null; }
export function getIsRunning() { return isRunning; }
export function isWorkerMode() { return useWorker; }

/* ─── Run ─── */
const MATPLOT_SETUP = `
try:
    import matplotlib
    matplotlib.use('agg')
    import matplotlib.pyplot as plt
    import io as _io, base64 as _b64
    def _pylite_show(*_a, **_kw):
        fig = plt.gcf()
        buf = _io.BytesIO()
        fig.savefig(buf, format='png', dpi=120, bbox_inches='tight',
                    facecolor=fig.get_facecolor(), edgecolor='none')
        buf.seek(0)
        from js import __pylite_show_plot
        __pylite_show_plot(_b64.b64encode(buf.read()).decode('utf-8'))
        plt.close(fig)
    plt.show = _pylite_show
except ImportError:
    pass
`;

export async function runCode(code, options = {}) {
  if ((!pyodide && !worker) || isRunning) return;
  const prev = {
    onStdout,
    onStderr,
    onPlot,
    onRunStateChange,
    onInputRequest,
    onLoadProgress,
  };

  if (options.onStdout) onStdout = options.onStdout;
  if (options.onStderr) onStderr = options.onStderr;
  if (options.onPlot) onPlot = options.onPlot;
  if (options.onRunStateChange) onRunStateChange = options.onRunStateChange;
  if (options.onInputRequest) onInputRequest = options.onInputRequest;
  if (options.onLoadProgress) onLoadProgress = options.onLoadProgress;

  isRunning = true;
  if (onRunStateChange) onRunStateChange('running');

  try {
    if (useWorker) {
      if (sab) Atomics.store(sab.interrupt, 0, 0); // clear stale interrupt flag
      try {
        await new Promise((resolve, reject) => {
          const id = ++msgSeq;
          pending.set(id, m => (m.type === 'done' ? resolve() : reject(new Error(m.message))));
          workerPost({ type: 'run', code, id });
        });
      } catch (err) {
        const msg = err.message || String(err);
        if (msg.includes('KeyboardInterrupt')) {
          if (onStderr) onStderr('⚠ Execution interrupted by user');
        } else if (onStderr) {
          onStderr(msg);
        }
      }
      return;
    }

    // ── Main-thread fallback (existing behavior) ──
    if (interruptBuffer) Atomics.store(interruptBuffer, 0, 0);

    try {
      await pyodide.runPythonAsync(MATPLOT_SETUP);
    } catch (_) {}

    try {
      await pyodide.runPythonAsync(code);
    } catch (err) {
      const msg = err.message || String(err);
      if (msg.includes('KeyboardInterrupt')) {
        if (onStderr) onStderr('⚠ Execution interrupted by user');
      } else {
        if (onStderr) onStderr(msg);
      }
    }
  } finally {
    isRunning = false;
    onStdout = prev.onStdout;
    onStderr = prev.onStderr;
    onPlot = prev.onPlot;
    onRunStateChange = prev.onRunStateChange;
    onInputRequest = prev.onInputRequest;
    onLoadProgress = prev.onLoadProgress;
    if (onRunStateChange) onRunStateChange('ready');
  }
}

/* ─── Stop / interrupt ─── */
export function stopExecution() {
  if (!isRunning) return;
  if (useWorker && sab) {
    Atomics.store(sab.interrupt, 0, 2);
    writeStdin(''); // unblock an in-flight input() wait so the interrupt takes effect
  } else if (interruptBuffer) {
    Atomics.store(interruptBuffer, 0, 2);
  }
}

/* ─── Packages ─── */
export async function installPackage(name) {
  if (useWorker) {
    await new Promise((resolve, reject) => {
      const id = ++msgSeq;
      pending.set(id, m => (m.type === 'done' ? resolve() : reject(new Error(m.message))));
      workerPost({ type: 'install', name, id });
    });
    return;
  }
  if (!pyodide) throw new Error('Pyodide not loaded');
  await pyodide.loadPackage('micropip');
  const mp = pyodide.pyimport('micropip');
  await mp.install(name);
}

export async function loadPyodidePackage(name) {
  if (useWorker) {
    await new Promise((resolve, reject) => {
      const id = ++msgSeq;
      pending.set(id, m => (m.type === 'done' ? resolve() : reject(new Error(m.message))));
      workerPost({ type: 'load-package', name, id });
    });
    return;
  }
  if (!pyodide) throw new Error('Pyodide not loaded');
  await pyodide.loadPackage(name);
}
