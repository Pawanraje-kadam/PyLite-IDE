/* ═══════════════════════════════════════
   FILE STORAGE — localStorage management
   ═══════════════════════════════════════ */

const STORAGE_KEY = 'pylite_files';
const ACTIVE_KEY = 'pylite_active';
const SETTINGS_KEY = 'pylite_settings';

const DEFAULT_CODE = `# Welcome to PyLite IDE! 🐍
# Write Python code and tap Run to execute.

name = input("What's your name? ")
print(f"Hello, {name}! Welcome to PyLite.")

for i in range(1, 6):
    print(f"  {i} squared = {i**2}")

print("\\nHappy coding! 🚀")
`;

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function getAllFiles() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch { return []; }
}

export function saveAllFiles(files) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(files));
}

export function getActiveFileId() {
  return localStorage.getItem(ACTIVE_KEY) || null;
}

export function setActiveFileId(id) {
  localStorage.setItem(ACTIVE_KEY, id);
}

export function createFile(name) {
  const files = getAllFiles();
  if (!name) {
    let n = files.length + 1;
    name = `script${n}.py`;
    while (files.some(f => f.name === name)) { n++; name = `script${n}.py`; }
  }
  const file = { id: uid(), name, code: '', lastModified: Date.now() };
  files.push(file);
  saveAllFiles(files);
  return file;
}

export function deleteFile(id) {
  let files = getAllFiles().filter(f => f.id !== id);
  saveAllFiles(files);
  return files;
}

export function updateFileCode(id, code) {
  const files = getAllFiles();
  const f = files.find(x => x.id === id);
  if (f) { f.code = code; f.lastModified = Date.now(); saveAllFiles(files); }
}

export function renameFile(id, name) {
  const files = getAllFiles();
  const f = files.find(x => x.id === id);
  if (!f) return null;
  let n = (name || '').trim() || 'untitled.py';
  if (!/\.[A-Za-z0-9]+$/.test(n)) n += '.py';
  if (files.some(x => x.id !== id && x.name === n)) {
    const base = n.replace(/\.py$/i, '');
    let i = 2;
    while (files.some(x => x.id !== id && x.name === `${base}${i}.py`)) i++;
    n = `${base}${i}.py`;
  }
  f.name = n;
  f.lastModified = Date.now();
  saveAllFiles(files);
  return f;
}

export function duplicateFile(id) {
  const files = getAllFiles();
  const src = files.find(x => x.id === id);
  if (!src) return null;
  const base = src.name.replace(/\.py$/i, '');
  let n = 2, name = `${base}-copy.py`;
  while (files.some(f => f.name === name)) { name = `${base}-copy${n}.py`; n++; }
  const file = { id: uid(), name, code: src.code, lastModified: Date.now() };
  files.push(file);
  saveAllFiles(files);
  return file;
}

const PKGS_KEY = 'pylite_pkgs';

export function getSavedPackages() {
  try { return JSON.parse(localStorage.getItem(PKGS_KEY)) || []; }
  catch { return []; }
}

export function saveInstalledPackage(entry) {
  const list = getSavedPackages();
  if (!list.some(p => p.name === entry.name)) {
    list.push({ name: entry.name, type: entry.type || 'micropip' });
    localStorage.setItem(PKGS_KEY, JSON.stringify(list));
  }
}

export function getFileById(id) {
  return getAllFiles().find(f => f.id === id) || null;
}

export function getSettings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || { fontSize: 14, theme: 'dark' }; }
  catch { return { fontSize: 14, theme: 'dark' }; }
}

export function saveSettings(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

export function ensureDefaultFile() {
  let files = getAllFiles();
  if (files.length === 0) {
    const file = { id: uid(), name: 'main.py', code: DEFAULT_CODE, lastModified: Date.now() };
    files.push(file);
    saveAllFiles(files);
    setActiveFileId(file.id);
  }
}
