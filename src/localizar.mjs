import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const WIN = process.platform === 'win32';

function ehArquivo(caminho) {
  try {
    return fs.statSync(caminho).isFile();
  } catch {
    return false;
  }
}

/** Primeira ocorrência de um dos nomes nas pastas do PATH. */
export function noPath(nomes, variavelPath = process.env.PATH ?? process.env.Path ?? '') {
  for (const pasta of variavelPath.split(path.delimiter).filter(Boolean)) {
    for (const nome of nomes) {
      const candidato = path.join(pasta, nome);
      if (ehArquivo(candidato)) return candidato;
    }
  }
  return null;
}

function versao(nomeDaPasta) {
  const achado = nomeDaPasta.match(/(\d+(?:\.\d+)+)/);
  return achado ? achado[1].split('.').map(Number) : [];
}

export function compararVersoes(a, b) {
  const va = versao(a);
  const vb = versao(b);
  for (let i = 0; i < Math.max(va.length, vb.length); i++) {
    const d = (va[i] ?? 0) - (vb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export function pastasDeExtensoes(home = os.homedir()) {
  return ['.vscode', '.vscode-insiders', '.cursor', '.windsurf'].map((p) => path.join(home, p, 'extensions'));
}

/**
 * Procura o executável dentro das extensões instaladas no editor (a mais nova primeiro).
 * `relativos` são caminhos dentro da pasta da extensão, testados em ordem.
 */
export function nasExtensoes(prefixo, relativos, bases = pastasDeExtensoes()) {
  const candidatas = [];
  for (const base of bases) {
    let nomes = [];
    try {
      nomes = fs.readdirSync(base);
    } catch {
      continue;
    }
    for (const nome of nomes) if (nome.startsWith(prefixo)) candidatas.push(path.join(base, nome));
  }
  candidatas.sort((a, b) => compararVersoes(path.basename(b), path.basename(a)));
  for (const pasta of candidatas) {
    for (const relativo of relativos) {
      const caminho = path.join(pasta, relativo);
      if (ehArquivo(caminho)) return caminho;
    }
  }
  return null;
}

function arquitetura() {
  return { x64: 'x86_64', arm64: 'aarch64' }[process.arch] ?? process.arch;
}

export function localizarClaude({ bases } = {}) {
  if (process.env.REVEZAR_CLAUDE) return { caminho: process.env.REVEZAR_CLAUDE, origem: 'variável REVEZAR_CLAUDE' };
  const noSistema = noPath(WIN ? ['claude.exe', 'claude.cmd'] : ['claude']);
  if (noSistema) return { caminho: noSistema, origem: 'PATH' };
  const local = path.join(os.homedir(), '.local', 'bin', WIN ? 'claude.exe' : 'claude');
  if (ehArquivo(local)) return { caminho: local, origem: 'instalador nativo (~/.local/bin)' };
  const extensao = nasExtensoes(
    'anthropic.claude-code-',
    [path.join('resources', 'native-binary', WIN ? 'claude.exe' : 'claude')],
    bases,
  );
  if (extensao) return { caminho: extensao, origem: 'extensão do VS Code' };
  return null;
}

export function localizarCodex({ bases } = {}) {
  if (process.env.REVEZAR_CODEX) return { caminho: process.env.REVEZAR_CODEX, origem: 'variável REVEZAR_CODEX' };
  const noSistema = noPath(WIN ? ['codex.exe', 'codex.cmd'] : ['codex']);
  if (noSistema) return { caminho: noSistema, origem: 'PATH' };
  const sistema = { win32: 'windows', darwin: 'macos', linux: 'linux' }[process.platform] ?? process.platform;
  const exe = WIN ? 'codex.exe' : 'codex';
  const extensao = nasExtensoes(
    'openai.chatgpt-',
    [path.join('bin', `${sistema}-${arquitetura()}`, exe), path.join('bin', exe)],
    bases,
  );
  if (extensao) return { caminho: extensao, origem: 'extensão do VS Code' };
  return null;
}
