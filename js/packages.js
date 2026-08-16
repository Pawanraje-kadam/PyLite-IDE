/* ═══════════════════════════════════════
   PACKAGES — On-demand package loading
   ═══════════════════════════════════════ */

import { installPackage, loadPyodidePackage } from './executor.js';

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

const installed = new Set();

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
  btn.disabled = true;
  btn.innerHTML = '<div class="pkg-spinner"></div>';
  try {
    if (pkg.type === 'pyodide') await loadPyodidePackage(pkg.name);
    else await installPackage(pkg.name);
    installed.add(pkg.name);
    btn.textContent = 'Installed'; btn.classList.add('installed');
  } catch {
    btn.textContent = 'Failed'; btn.style.background = 'var(--error-text)';
    setTimeout(() => { btn.textContent = 'Retry'; btn.style.background = ''; btn.disabled = false; }, 2000);
  }
}

export async function installCustomPackage(name) {
  await installPackage(name);
  installed.add(name);
}
