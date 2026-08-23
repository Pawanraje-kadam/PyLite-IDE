<p align="center">
  <img src="assets/logo-readme.png" width="160" alt="PyLite IDE logo">
</p>

<h1 align="center">🐍 PyLite IDE</h1>

A Python IDE that runs entirely in your browser. No install, no backend, no build step — clone it and open `index.html`.

**[Live demo →](https://github.com/Pawanraje-kadam/PyLite-IDE)** <!-- replace with your Vercel URL -->

---

## What it does

PyLite IDE runs real Python (via [Pyodide](https://pyodide.org), a WebAssembly build of CPython) directly in the browser tab. There's no server executing your code — everything happens client-side.

The interesting part isn't "Python in the browser" (Pyodide gives you that for free). It's making `input()` work properly:

- Python's `input()` is *synchronous* — it blocks until a value arrives. A naive browser implementation either fakes it or freezes the whole page with `window.prompt()`.
- PyLite runs Pyodide inside a **Web Worker**, and uses `Atomics.wait` / `Atomics.notify` on a `SharedArrayBuffer` to let the worker block synchronously waiting for input, while the main thread stays responsive and renders an inline input row in the console — no native popups, no frozen UI.
- This requires cross-origin isolation (`SharedArrayBuffer` is gated behind COOP/COEP headers), which is configured in `_headers` / `vercel.json`. If the browser or host can't provide isolation, PyLite falls back to running Pyodide on the main thread with a native `prompt()` — same features, degraded UX, but it still works everywhere.
- `KeyboardInterrupt` (stopping a running script) is wired through Pyodide's interrupt buffer and correctly suppresses the double-raise that Pyodide's asyncio webloop would otherwise leak as an uncaught worker error.

## Features

- ▶️ Run Python in-browser with live stdout/stderr, and inline `input()` support
- 📊 `matplotlib` plots rendered inline (captured via a `plt.show()` hook, no popup windows)
- 🗂️ Multi-file editor with autosave to `localStorage`
- 📝 Custom syntax-highlighted editor (regex tokenizer over a `<textarea>` + synced overlay), with auto-indent and auto-closing brackets/quotes
- 📦 On-demand package installs — common packages (`numpy`, `pandas`, `scipy`, `scikit-learn`, `sympy`, `Pillow`, `beautifulsoup4`, etc.) loadable from a package panel, plus a custom `micropip install <name>` field
- 🔗 Shareable code via URL (base64-encoded in the hash, no server round-trip) — long scripts fall back to a file download
- 🎨 Light/dark themes, adjustable font size
- 📱 Responsive layout — split editor/console on desktop, tabbed on phones
- 🔁 REPL after each run, copy/clear console, save matplotlib plots
- 📦 Installed packages are remembered and restored on the next visit

## Stack

Deliberately dependency-free:

- **Vanilla JavaScript** (ES modules) — no framework, no bundler
- **Pyodide** (CPython via WebAssembly) — loaded from CDN, executed in a Web Worker
- **Plain HTML/CSS** — hand-rolled editor UI, no CodeMirror/Monaco
- Deployed as a static site (Vercel config included; works on any static host that can set custom response headers)

There is no `package.json`, no `npm install`, no build step. What's in the repo is what ships.

## Running it locally

You need *some* local static server — opening `index.html` directly via `file://` won't set the COOP/COEP headers Pyodide's worker mode needs, so it'll silently fall back to main-thread mode (still works, just without the inline `input()` UX).

```bash
git clone https://github.com/Pawanraje-kadam/PyLite-IDE.git
cd PyLite-IDE

# any static server works, e.g.:
python3 -m http.server 8000
# or
npx serve .
```

Then open `http://localhost:8000`.

## Deploying

The repo ships with `vercel.json` and `_headers`, both setting:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: cross-origin
```

These headers are required for `SharedArrayBuffer` (and therefore the worker-mode `input()` handling) to work. Deploy to Vercel, Netlify, Cloudflare Pages, or GitHub Pages — just make sure whatever host you use actually applies these headers (GitHub Pages, notably, does not let you set custom headers, so worker mode won't be available there).

## Project structure

```
index.html              # App shell, loading screen
styles.css              # All styling
js/
  app.js                # Entry point — wires UI, files, editor, executor together
  editor.js              # Syntax highlighting, auto-indent, auto-close brackets/quotes
  executor.js             # Pyodide lifecycle — worker mode + main-thread fallback
  pyodide-worker.js        # Runs Pyodide off the main thread; handles blocking input()
  ui.js                  # Panel switching, console rendering, inline input row
  toolbar.js              # Symbol/shortcut toolbar
  storage.js              # localStorage-backed file storage
  packages.js             # Package install panel (pyodide + micropip packages)
  share.js               # URL-based code sharing
  theme.js               # Light/dark theme toggle
_headers / vercel.json    # COOP/COEP headers for cross-origin isolation
```

## Known limitations

- All state (files, settings) lives in `localStorage` — clearing browser data wipes your work. There's no cloud sync.
- The syntax highlighter is a hand-written regex tokenizer, not a real parser — it covers common Python syntax well but can misfire on unusual edge cases (deeply nested f-strings, etc).
- GitHub Pages can't serve the COOP/COEP headers this needs for worker-mode `input()`, so a GH Pages deployment will run in the main-thread fallback.

## License

MIT — see [LICENSE](LICENSE). <!-- add a LICENSE file if you haven't yet -->

## Contributing

Issues and PRs welcome. Since there's no build step, the whole feedback loop is: edit a file, refresh the browser.
