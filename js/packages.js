/* ═══════════════════════════════════════
   PACKAGES — On-demand package loading
   ═══════════════════════════════════════ */

import { installPackage, loadPyodidePackage, isPyodideReady } from './executor.js';
import { getSavedPackages, saveInstalledPackage } from './storage.js';

const PKGS = [
  { name: 'numpy',          desc: 'Numerical computing',      type: 'pyodide' },
  { name: 'pandas',         desc: 'Data analysis',            type: 'pyodide' },
  { name: 'matplotlib',     desc: 'Plotting & visualization', type: 'pyodide' },
  { name: 'scipy',          desc: 'Scientific computing',     type: 'pyodide' },
  { name: 'scikit-learn',   desc: 'Machine learning',         type: 'micropip' },
  { name: 'sympy',          desc: 'Symbolic mathematics',     type: 'micropip' },
  { name: 'beautifulsoup4', desc: 'HTML/XML parser',          type: 'micropip' },
  { name: 'Pillow',         desc: 'Image processing',         type: 'micropip' },
  { name: 'regex',          desc: 'Advanced regex',           type: 'micropip' },
];

const installed = new Set(getSavedPackages().map(p => p.name));

export function renderPackageList(container) {
  container.innerHTML = '';
  for (const pkg of PKGS) {
    const div = document.createElement('div');
    div.className = 'pkg-item';
    const info = document.createElement('div');
    info.innerHTML = `<div class="pkg-name">${pkg.name}</div><div class="pkg-desc">${pkg.desc}</div>`;
    const btn = document.createElement('button');
    btn.className = 'btn-install';
    if (installed.has(pkg.name)) {
      btn.textContent = 'Installed'; btn.classList.add('installed'); btn.disabled = true;
    } else {
      btn.textContent = 'Install';
      btn.addEventListener('click', () => doPkgInstall(pkg, btn));
    }
    div.appendChild(info); div.appendChild(btn);
    container.appendChild(div);
  }
}

async function doPkgInstall(pkg, btn) {
  if (!isPyodideReady()) {
    btn.textContent = 'Wait…';
    setTimeout(() => { if (!installed.has(pkg.name)) { btn.textContent = 'Install'; btn.disabled = false; } }, 1400);
    btn.disabled = true;
    return;
  }
  btn.disabled = true;
  btn.innerHTML = '<div class="pkg-spinner"></div>';
  try {
    if (pkg.type === 'pyodide') await loadPyodidePackage(pkg.name);
    else await installPackage(pkg.name);
    installed.add(pkg.name);
    saveInstalledPackage(pkg);
    btn.textContent = 'Installed'; btn.classList.add('installed');
  } catch {
    btn.textContent = 'Failed'; btn.style.background = 'var(--error-text)';
    setTimeout(() => { btn.textContent = 'Retry'; btn.style.background = ''; btn.disabled = false; }, 2000);
  }
}

export async function installCustomPackage(name) {
  if (!isPyodideReady()) throw new Error('Python is still loading');
  await installPackage(name);
  installed.add(name);
  saveInstalledPackage({ name, type: 'micropip' });
}

/* Re-install packages remembered from a previous visit so the next
   session starts with the same library set. Failures are skipped so a
   single missing wheel cannot block the editor from opening. */
export async function restoreSavedPackages(onProgress) {
  const saved = getSavedPackages();
  if (!saved.length) return;
  for (let i = 0; i < saved.length; i++) {
    const pkg = saved[i];
    if (typeof onProgress === 'function') {
      onProgress(`Restoring ${pkg.name}… (${i + 1}/${saved.length})`);
    }
    try {
      if (pkg.type === 'pyodide') await loadPyodidePackage(pkg.name);
      else await installPackage(pkg.name);
      installed.add(pkg.name);
    } catch (_) {
      /* keep going — editor is already usable without this package */
    }
  }
}
