import fs from 'node:fs';
import { localizarCodex } from '../localizar.mjs';
import { raizGit } from '../util.mjs';

function finalDoTexto(texto, linhas = 6) {
  return String(texto ?? '').trim().split(/\r?\n/).slice(-linhas).join('\n');
}

export default {
  id: 'codex',
  nome: 'Codex',
  comoInstalar: 'Instale a extensão Codex (openai.chatgpt) no VS Code ou o CLI (npm i -g @openai/codex), ou aponte "agentes.codex.comando" no revezamento.json.',
  localizar: localizarCodex,

  /**
   * Modo leitura: sandbox read-only, trabalhando na raiz do projeto.
   * Modo escrita: sandbox workspace-write com a pasta de anexos do turno como raiz de trabalho,
   * então o Codex só consegue gravar ali (e continua lendo o projeto e o AGENTS.md da raiz do git).
   */
  montar({ comando, prompt, modo, raiz, pastaAnexos, arquivoUltimaMensagem, cfg }) {
    const cwd = modo === 'escrita' ? pastaAnexos : raiz;
    const args = [
      'exec',
      '--json',
      '--color', 'never',
      '-o', arquivoUltimaMensagem,
      '-C', cwd,
      '-s', modo === 'escrita' ? 'workspace-write' : 'read-only',
    ];
    if (!raizGit(cwd)) args.push('--skip-git-repo-check');
    if (cfg.modelo) args.push('-m', cfg.modelo);
    if (cfg.esforco) args.push('-c', `model_reasoning_effort="${cfg.esforco}"`);
    args.push(...cfg.args_extras, '-');
    return { comando, args, cwd, entrada: prompt, arquivoUltimaMensagem };
  },

  interpretar(res, plano) {
    if (res.erro?.code === 'ENOENT') throw new Error('programa do Codex não encontrado (rode: revezar diagnostico)');
    let texto = '';
    try {
      texto = fs.readFileSync(plano.arquivoUltimaMensagem, 'utf8');
    } catch {}
    let sessao = null;
    let uso = null;
    const erros = [];
    for (const linha of res.stdout.split(/\r?\n/)) {
      if (!linha.startsWith('{')) continue;
      let evento;
      try {
        evento = JSON.parse(linha);
      } catch {
        continue;
      }
      sessao = evento.thread_id ?? evento.session_id ?? sessao;
      if (evento.type === 'turn.completed' && evento.usage) uso = evento.usage;
      if (/error|failed/i.test(evento.type ?? '')) {
        erros.push(evento.message ?? evento.error?.message ?? JSON.stringify(evento));
      }
    }
    if (!texto.trim() || (res.codigo !== 0 && erros.length)) {
      throw new Error(erros.at(-1) || finalDoTexto(res.stderr) || res.erro?.message || `saiu com código ${res.codigo}`);
    }
    return { texto, sessao, uso };
  },
};
