import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const WIN = process.platform === 'win32';

function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/** First match of one of the names in the PATH folders. */
export function onPath(names, pathVar = process.env.PATH ?? process.env.Path ?? '') {
  for (const dir of pathVar.split(path.delimiter).filter(Boolean)) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (isFile(candidate)) return candidate;
    }
  }
  return null;
}

function versionOf(folderName) {
  const found = folderName.match(/(\d+(?:\.\d+)+)/);
  return found ? found[1].split('.').map(Number) : [];
}

export function compareVersions(a, b) {
  const va = versionOf(a);
  const vb = versionOf(b);
  for (let i = 0; i < Math.max(va.length, vb.length); i++) {
    const d = (va[i] ?? 0) - (vb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export function extensionFolders(home = os.homedir()) {
  return ['.vscode', '.vscode-insiders', '.cursor', '.windsurf'].map((p) => path.join(home, p, 'extensions'));
}

/**
 * Looks for the executable inside the editor's installed extensions (newest version first).
 * `relatives` are paths inside the extension folder, tried in order.
 */
export function inExtensions(prefix, relatives, bases = extensionFolders()) {
  const candidates = [];
  for (const base of bases) {
    let names = [];
    try {
      names = fs.readdirSync(base);
    } catch {
      continue;
    }
    for (const name of names) if (name.startsWith(prefix)) candidates.push(path.join(base, name));
  }
  candidates.sort((a, b) => compareVersions(path.basename(b), path.basename(a)));
  for (const dir of candidates) {
    for (const relative of relatives) {
      const file = path.join(dir, relative);
      if (isFile(file)) return file;
    }
  }
  return null;
}

function arch() {
  return { x64: 'x86_64', arm64: 'aarch64' }[process.arch] ?? process.arch;
}

export function locateClaude({ bases } = {}) {
  if (process.env.CLODEX_CLAUDE) return { path: process.env.CLODEX_CLAUDE, source: 'CLODEX_CLAUDE variable' };
  const system = onPath(WIN ? ['claude.exe', 'claude.cmd'] : ['claude']);
  if (system) return { path: system, source: 'PATH' };
  const local = path.join(os.homedir(), '.local', 'bin', WIN ? 'claude.exe' : 'claude');
  if (isFile(local)) return { path: local, source: 'native installer (~/.local/bin)' };
  const ext = inExtensions('anthropic.claude-code-', [path.join('resources', 'native-binary', WIN ? 'claude.exe' : 'claude')], bases);
  if (ext) return { path: ext, source: 'VS Code extension' };
  return null;
}

export function locateCodex({ bases } = {}) {
  if (process.env.CLODEX_CODEX) return { path: process.env.CLODEX_CODEX, source: 'CLODEX_CODEX variable' };
  const system = onPath(WIN ? ['codex.exe', 'codex.cmd'] : ['codex']);
  if (system) return { path: system, source: 'PATH' };
  const osName = { win32: 'windows', darwin: 'macos', linux: 'linux' }[process.platform] ?? process.platform;
  const exe = WIN ? 'codex.exe' : 'codex';
  const ext = inExtensions('openai.chatgpt-', [path.join('bin', `${osName}-${arch()}`, exe), path.join('bin', exe)], bases);
  if (ext) return { path: ext, source: 'VS Code extension' };
  return null;
}
