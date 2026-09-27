import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { semCor } from '../src/console.mjs';
import { lerEstado } from '../src/estado.mjs';

const aqui = path.dirname(fileURLToPath(import.meta.url));
export const AGENTE_FALSO = path.join(aqui, 'fakes', 'agente-falso.mjs');

// Nenhum teste mexe no ~/.revezamento do usuário.
process.env.REVEZAR_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'revezar-home-'));

export function pastaTemporaria() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'revezar-teste-'));
}

/** Cria um debate numa pasta temporária, com os dois agentes trocados pelo agente falso. */
export function debateDeTeste({ config = {}, roteiro = {}, pauta = '# Pauta\n\nQual é a melhor cor?\n' } = {}) {
  const pasta = pastaTemporaria();
  const arquivoRoteiro = path.join(pasta, '..', `${path.basename(pasta)}.roteiro.json`);
  fs.writeFileSync(arquivoRoteiro, JSON.stringify(roteiro));
  const comando = (como) => [process.execPath, AGENTE_FALSO, '--como', como, '--roteiro', arquivoRoteiro];
  const cfg = {
    tema: 'Teste',
    humano: 'Luiz',
    max_ciclos: 2,
    notificar: false,
    tempo_max_turno_min: 1,
    ...config,
    agentes: {
      claude: { comando: comando('claude'), ...(config.agentes?.claude ?? {}) },
      codex: { comando: comando('codex'), ...(config.agentes?.codex ?? {}) },
    },
  };
  fs.writeFileSync(path.join(pasta, 'revezamento.json'), JSON.stringify(cfg, null, 2));
  fs.writeFileSync(path.join(pasta, '00-pauta.md'), pauta);
  return { pasta, arquivoRoteiro };
}

export function chamadas(arquivoRoteiro) {
  const arquivo = `${arquivoRoteiro}.chamadas.jsonl`;
  if (!fs.existsSync(arquivo)) return [];
  return fs.readFileSync(arquivo, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
}

export function uiDeTeste() {
  const linhas = [];
  return {
    interativo: false,
    linhas,
    escrever: (t) => linhas.push(semCor(t)),
    fechar() {},
  };
}

export const opcoesDeTeste = (ui) => ({ ui, notificar: false, intervaloCaixaMs: 20, intervaloEsperaMs: 20 });

export async function esperarEstado(pasta, condicao, limiteMs = 15_000) {
  const inicio = Date.now();
  while (Date.now() - inicio < limiteMs) {
    const e = lerEstado(pasta);
    if (e && condicao(e)) return e;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`estado esperado não chegou em ${limiteMs} ms: ${JSON.stringify(lerEstado(pasta))}`);
}

export const ler = (pasta, arquivo) => fs.readFileSync(path.join(pasta, arquivo), 'utf8');

export async function esperarArquivo(caminho, limiteMs = 15_000) {
  const inicio = Date.now();
  while (!fs.existsSync(caminho)) {
    if (Date.now() - inicio > limiteMs) throw new Error(`arquivo não apareceu: ${caminho}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}
