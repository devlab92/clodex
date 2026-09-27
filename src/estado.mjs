import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ErroAmigavel, agora, gravarAtomico, lerJson } from './util.mjs';

/**
 * Tudo o que é da máquina fica em <pasta do debate>/.revezar/, que se auto-ignora no git:
 *   estado.json   situação do debate (fonte da verdade para retomar)
 *   trava.json    impede dois maestros no mesmo debate
 *   caixa/        comandos e falas enviados de outro terminal
 *   prompts/      o texto exato entregue a cada IA
 *   saidas/       saída bruta de cada execução (para investigar problemas)
 *   log.txt       o que apareceu no terminal
 */
export function pastaInterna(pastaDebate) {
  const interna = path.join(pastaDebate, '.revezar');
  fs.mkdirSync(interna, { recursive: true });
  const ignorar = path.join(interna, '.gitignore');
  if (!fs.existsSync(ignorar)) fs.writeFileSync(ignorar, '*\n');
  return interna;
}

export function estadoInicial(cfg) {
  return {
    versao: 1,
    tema: cfg.tema,
    status: 'novo',
    fase: 'debate',
    motivo: null,
    ciclosExtras: 0,
    inicioRodada: 0,
    turnos: [],
    pergunta: null,
    erro: null,
    relatorioAtual: null,
    criadoEm: agora(),
    atualizadoEm: agora(),
  };
}

export function lerEstado(pastaDebate) {
  const arquivo = path.join(pastaDebate, '.revezar', 'estado.json');
  if (!fs.existsSync(arquivo)) return null;
  try {
    return lerJson(arquivo);
  } catch (erro) {
    throw new ErroAmigavel(`O arquivo ${arquivo} está corrompido (${erro.message}). Renomeie-o para recomeçar o debate.`);
  }
}

export function salvarEstado(pastaDebate, estado) {
  estado.atualizadoEm = agora();
  gravarAtomico(path.join(pastaInterna(pastaDebate), 'estado.json'), `${JSON.stringify(estado, null, 2)}\n`);
}

// ---------- trava ----------

function processoVivo(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (erro) {
    return erro.code === 'EPERM';
  }
}

export function lerTrava(pastaDebate) {
  const arquivo = path.join(pastaDebate, '.revezar', 'trava.json');
  try {
    const trava = lerJson(arquivo);
    return trava.host === os.hostname() && !processoVivo(trava.pid) ? null : trava;
  } catch {
    return null;
  }
}

export function maestroAtivo(pastaDebate) {
  return lerTrava(pastaDebate) !== null;
}

export function adquirirTrava(pastaDebate) {
  const arquivo = path.join(pastaInterna(pastaDebate), 'trava.json');
  const conteudo = JSON.stringify({ pid: process.pid, host: os.hostname(), desde: agora() });
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    try {
      fs.writeFileSync(arquivo, conteudo, { flag: 'wx' });
      return arquivo;
    } catch (erro) {
      if (erro.code !== 'EEXIST') throw erro;
      const atual = lerTrava(pastaDebate);
      if (atual) {
        throw new ErroAmigavel(
          `Já existe um maestro rodando neste debate (processo ${atual.pid} em ${atual.host}, desde ${atual.desde}). ` +
            'Use "revezar status" para ver, ou "revezar parar" para encerrá-lo.',
        );
      }
      fs.rmSync(arquivo, { force: true }); // trava velha de um maestro que morreu
    }
  }
  throw new ErroAmigavel('Não consegui travar o debate. Tente de novo.');
}

export function liberarTrava(pastaDebate) {
  const arquivo = path.join(pastaDebate, '.revezar', 'trava.json');
  try {
    if (lerJson(arquivo).pid === process.pid) fs.rmSync(arquivo, { force: true });
  } catch {}
}

// ---------- caixa de entrada (comandos vindos de outro terminal) ----------

export const TIPOS_DE_MENSAGEM = ['fala', 'parar', 'parar_agora', 'pausar', 'retomar'];

export function enviarParaCaixa(pastaDebate, mensagem) {
  if (!TIPOS_DE_MENSAGEM.includes(mensagem.tipo)) throw new Error(`tipo de mensagem inválido: ${mensagem.tipo}`);
  const caixa = path.join(pastaInterna(pastaDebate), 'caixa');
  fs.mkdirSync(caixa, { recursive: true });
  const nome = `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}.json`;
  gravarAtomico(path.join(caixa, nome), JSON.stringify({ ...mensagem, enviadoEm: agora() }));
}

/** Lê e apaga as mensagens pendentes, na ordem em que chegaram. */
export function esvaziarCaixa(pastaDebate) {
  const caixa = path.join(pastaDebate, '.revezar', 'caixa');
  let nomes = [];
  try {
    nomes = fs.readdirSync(caixa).filter((n) => n.endsWith('.json')).sort();
  } catch {
    return [];
  }
  const mensagens = [];
  for (const nome of nomes) {
    const arquivo = path.join(caixa, nome);
    try {
      mensagens.push(lerJson(arquivo));
      fs.rmSync(arquivo, { force: true });
    } catch {}
  }
  return mensagens;
}

// ---------- último debate usado (para os comandos funcionarem de qualquer pasta) ----------

function arquivoDoUltimo() {
  return path.join(process.env.REVEZAR_HOME ?? path.join(os.homedir(), '.revezamento'), 'ultimo.json');
}

export function registrarUltimo(pastaDebate) {
  try {
    gravarAtomico(arquivoDoUltimo(), JSON.stringify({ pasta: pastaDebate, em: agora() }));
  } catch {}
}

export function lerUltimo() {
  try {
    return lerJson(arquivoDoUltimo()).pasta;
  } catch {
    return null;
  }
}
