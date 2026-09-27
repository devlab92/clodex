import path from 'node:path';
import { localizarClaude } from '../localizar.mjs';

/**
 * Converte um caminho absoluto no formato das regras de permissão do Claude Code:
 * `//` + caminho POSIX (no Windows, C:\x vira //c/x), com os curingas do gitignore escapados.
 */
export function padraoAbsoluto(caminho, plataforma = process.platform) {
  let p = plataforma === 'win32' ? path.win32.resolve(caminho) : path.posix.resolve(caminho);
  if (plataforma === 'win32') {
    p = p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, letra) => `/${letra.toLowerCase()}`);
  }
  return `/${p.replace(/[[\]*?]/g, '\\$&')}`;
}

/**
 * Variáveis que uma sessão do Claude Code passa aos processos filhos para ligá-los a ela.
 * Se o maestro for chamado de dentro do Claude Code, as IAs do debate precisam nascer
 * como sessões independentes, como num terminal comum.
 */
const VARIAVEIS_DE_SESSAO = [
  'CLAUDECODE',
  'CLAUDE_PID',
  'CLAUDE_EFFORT',
  'CLAUDE_AGENT_SDK_VERSION',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING',
  'CLAUDE_CODE_ENABLE_TASKS',
];

export function ambienteIndependente(base = process.env) {
  const env = { ...base };
  for (const nome of VARIAVEIS_DE_SESSAO) delete env[nome];
  return env;
}

function extrairResultado(stdout) {
  const texto = stdout.trim();
  try {
    return JSON.parse(texto);
  } catch {}
  for (const linha of texto.split(/\r?\n/).reverse()) {
    if (!linha.startsWith('{')) continue;
    try {
      const obj = JSON.parse(linha);
      if (obj.type === 'result') return obj;
    } catch {}
  }
  return null;
}

function finalDoTexto(texto, linhas = 6) {
  return String(texto ?? '').trim().split(/\r?\n/).slice(-linhas).join('\n');
}

export default {
  id: 'claude',
  nome: 'Claude',
  comoInstalar: 'Instale a extensão Claude Code no VS Code ou o CLI (https://code.claude.com), ou aponte "agentes.claude.comando" no revezamento.json.',
  localizar: localizarClaude,

  /**
   * Modo leitura: só Read/Glob/Grep, dentro da raiz do projeto.
   * Modo escrita: também Edit/Write, liberados só na pasta de anexos do turno.
   * `dontAsk` nega sozinho tudo o que pediria permissão, já que ninguém está olhando.
   * `ferramentas_extras` só deixa a ferramenta disponível (ações que pedem permissão
   * continuam negadas); `permitir` pré-aprova regras explícitas, como "WebFetch".
   */
  montar({ comando, prompt, modo, raiz, pastaAnexos, cfg, rotulo }) {
    const ferramentas = ['Read', 'Glob', 'Grep', ...cfg.ferramentas_extras];
    const liberadas = [...cfg.permitir];
    if (modo === 'escrita') {
      ferramentas.push('Edit', 'Write');
      liberadas.push(`Edit(${padraoAbsoluto(pastaAnexos)}/**)`);
    }
    const args = [
      '-p',
      '--output-format', 'json',
      '--permission-mode', 'dontAsk',
      '--tools', [...new Set(ferramentas)].join(','),
      '--strict-mcp-config',
      '--name', `revezar · ${rotulo}`,
    ];
    if (liberadas.length) args.push('--allowedTools', ...liberadas);
    if (cfg.modelo) args.push('--model', cfg.modelo);
    if (cfg.esforco) args.push('--effort', cfg.esforco);
    args.push(...cfg.args_extras);
    return { comando, args, cwd: raiz, entrada: prompt, env: ambienteIndependente() };
  },

  interpretar(res) {
    if (res.erro?.code === 'ENOENT') throw new Error('programa do Claude não encontrado (rode: revezar diagnostico)');
    const r = extrairResultado(res.stdout);
    if (!r) {
      throw new Error(finalDoTexto(res.stderr) || finalDoTexto(res.stdout) || res.erro?.message || `saiu com código ${res.codigo}`);
    }
    if (r.is_error || (r.subtype && r.subtype !== 'success')) {
      throw new Error(`Claude devolveu erro: ${r.result || r.subtype}`);
    }
    return { texto: r.result ?? '', sessao: r.session_id ?? null, custoUsd: r.total_cost_usd ?? null };
  },
};
