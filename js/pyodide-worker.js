/* ═══════════════════════════════════════
   PYLITE PYODIDE WORKER
   Runs Pyodide off the main thread so Python's input() can block
   synchronously (Atomics.wait on a SharedArrayBuffer) while the UI
   thread stays responsive and shows an inline console input row.

   Protocol with executor.js (main thread):
     main → worker: { type:'init', sab:{signal,data,interrupt} }
                    { type:'run', code, id }
                    { type:'install', name, id }
                    { type:'load-package', name, id }
     worker → main: { type:'init-done' } / { type:'init-error', message }
                    { type:'stdout', text } / { type:'stderr', text }
                    { type:'plot', data }
                    { type:'stdin' }           — asks for one input()
                    { type:'done', id } / { type:'error', id, message }

   Requires cross-origin isolation (COOP/COEP headers) for
   SharedArrayBuffer. Without it, executor.js never creates this
   worker and runs Pyodide on the main thread instead.
   ═══════════════════════════════════════ */

importScripts('https://cdn.jsdelivr.net/pyodide/v0.27.5/full/pyodide.js');

let pyodide = null;
let signalBuf = null, dataBuf = null;

const POST = o => self.postMessage(o);

/* Belt-and-braces: swallow any uncaught error / unhandled rejection so it
   can never surface as a page-level console error. */
self.addEventListener('unhandledrejection', e => { e.preventDefault(); });
self.addEventListener('error', e => { e.preventDefault(); });

/* Synchronous stdin: block this worker until the main thread writes a
   value into the data buffer and notifies the signal buffer. The wait
   is polled every 100ms so a stop request (which unblocks with an
   empty string + interrupt flag) is always serviced promptly.
   NOTE: TextDecoder refuses to decode a view over a SharedArrayBuffer,
   so the bytes are copied into a plain buffer first. */
function readStdinSync() {
  const sig = new Int32Array(signalBuf);
  const data = new Uint8Array(dataBuf);
  Atomics.store(sig, 0, 0);
  POST({ type: 'stdin' });
  while (Atomics.wait(sig, 0, 0, 100) === 'timed-out') { /* keep waiting */ }
  let len = 0;
  while (len < data.length && data[len] !== 0) len++;
  const bytes = new Uint8Array(len);
  bytes.set(data.subarray(0, len));
  return new TextDecoder().decode(bytes);
}

/* Matplotlib hook — kept identical to the previous main-thread setup */
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

/* Wrap input() so the prompt is flushed to stdout BEFORE Python blocks
   waiting for stdin. Pyodide's batched stdout only delivers a batch when
   it sees a newline (or a final flush), so we write the prompt followed
   by a newline — that forces the batched callback to fire synchronously
   while Python is still running, before the blocking stdin call below.
   Without this, the prompt would only appear after the program finished,
   and the inline input row would show before the prompt text. */
const INPUT_WRAP = `
import builtins as _builtins, sys as _sys
_pylite_orig_input = _builtins.input
def _pylite_input(_prompt=''):
    if _prompt:
        _sys.stdout.write(str(_prompt))
        _sys.stdout.write('\\n')
        _sys.stdout.flush()
    return _pylite_orig_input()
_builtins.input = _pylite_input
`;

/* When the interrupt fires, pyodide's webloop raises KeyboardInterrupt
   inside the running asyncio task. The awaited runPythonAsync rejects
   (handled in the run handler below), but the webloop ALSO re-raises the
   exception a second time from WebLoop.call_later's run_handle into the
   JS scheduler (an uncaught worker error, surfaced as a page error).
   WebLoop deliberately provides _keyboard_interrupt_handler for this:
   setting it swallows the second raise while the first still reaches us
   through the promise rejection. */
const KI_HANDLER = `
import asyncio as _asyncio
def _pylite_ki_handler():
    pass
_asyncio.get_event_loop()._keyboard_interrupt_handler = _pylite_ki_handler
`;

self.onmessage = async e => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case 'init': {
        signalBuf = msg.sab.signal;
        dataBuf = msg.sab.data;
        pyodide = await loadPyodide({ indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.27.5/full/' });
        pyodide.setInterruptBuffer(new Int32Array(msg.sab.interrupt));
        pyodide.setStdout({ batched: t => POST({ type: 'stdout', text: t }) });
        pyodide.setStderr({ batched: t => POST({ type: 'stderr', text: t }) });
        pyodide.setStdin({ stdin: readStdinSync });
        await pyodide.runPythonAsync(INPUT_WRAP);
        await pyodide.runPythonAsync(KI_HANDLER);
        globalThis.__pylite_show_plot = d => POST({ type: 'plot', data: d });
        POST({ type: 'init-done' });
        break;
      }
      case 'run': {
        await pyodide.runPythonAsync(MATPLOT_SETUP);
        try {
          await pyodide.runPythonAsync(msg.code);
          POST({ type: 'done', id: msg.id });
        } catch (err) {
          POST({ type: 'error', id: msg.id, message: err.message });
        }
        break;
      }
      case 'install': {
        await pyodide.loadPackage('micropip');
        const mp = pyodide.pyimport('micropip');
        await mp.install(msg.name);
        POST({ type: 'done', id: msg.id });
        break;
      }
      case 'load-package': {
        await pyodide.loadPackage(msg.name);
        POST({ type: 'done', id: msg.id });
        break;
      }
    }
  } catch (err) {
    POST({ type: 'error', id: msg.id, message: err.message });
  }
};
