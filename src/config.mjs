import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AGENTES } from './agentes/index.mjs';
import { ErroAmigavel, lerJson, raizGit, slug } from './util.mjs';

export const ARQUIVO_CONFIG = 'revezamento.json';
export const ARQUIVO_PAUTA = '00-pauta.md';
export const MARCA_MODELO = '<!-- revezar:preencha-e-apague-esta-linha -->';

export const PADRAO = {
  tema: '',
  participantes: ['claude', 'codex'],
  max_ciclos: 3,
  autonomia: 'perguntar',
  humano: 'Humano',
  relator: 'claude',
  conferencia_do_relatorio: true,
  permissoes: 'leitura',
  raiz_do_projeto: null,
  tempo_max_turno_min: 30,
  tentativas_por_turno: 2,
  notificar: true,
  instrucoes_extras: '',
  agentes: {},
};

const PADRAO_AGENTE = { comando: null, modelo: null, esforco: null, ferramentas_extras: [], permitir: [], args_extras: [] };

export function ehPastaDeDebate(pasta) {
  return Boolean(pasta) && fs.existsSync(path.join(pasta, ARQUIVO_CONFIG));
}

/** Lê e valida o revezamento.json. Devolve { pasta, cfg, raiz, humanoSlug }. */
export function carregarDebate(pasta) {
  const pastaAbs = path.resolve(pasta);
  const arquivo = path.join(pastaAbs, ARQUIVO_CONFIG);
  if (!fs.existsSync(arquivo)) {
    throw new ErroAmigavel(`Não achei ${ARQUIVO_CONFIG} em ${pastaAbs}. Crie o debate com: revezar novo <pasta>`);
  }
  let bruto;
  try {
    bruto = lerJson(arquivo);
  } catch (erro) {
    throw new ErroAmigavel(`${ARQUIVO_CONFIG} não é um JSON válido: ${erro.message}`);
  }
  const cfg = { ...PADRAO, ...bruto, agentes: {} };
  for (const id of Object.keys(AGENTES)) {
    cfg.agentes[id] = { ...PADRAO_AGENTE, ...(bruto.agentes?.[id] ?? {}) };
  }
  const problemas = validar(cfg);
  if (problemas.length) {
    throw new ErroAmigavel(`Problemas em ${arquivo}:\n  - ${problemas.join('\n  - ')}`);
  }
  const raiz = cfg.raiz_do_projeto
    ? path.resolve(pastaAbs, cfg.raiz_do_projeto)
    : (raizGit(pastaAbs) ?? path.dirname(pastaAbs));
  return { pasta: pastaAbs, cfg, raiz, humanoSlug: slugDoHumano(cfg.humano) };
}

export function validar(cfg) {
  const p = [];
  const ids = Object.keys(AGENTES);
  if (!Array.isArray(cfg.participantes) || cfg.participantes.length < 2) {
    p.push(`"participantes" precisa de pelo menos 2 IAs (disponíveis: ${ids.join(', ')})`);
  } else {
    for (const id of cfg.participantes) {
      if (!ids.includes(id)) p.push(`participante desconhecido "${id}" (disponíveis: ${ids.join(', ')})`);
    }
    if (new Set(cfg.participantes).size !== cfg.participantes.length) p.push('"participantes" tem nomes repetidos');
  }
  if (!Number.isInteger(cfg.max_ciclos) || cfg.max_ciclos < 1) p.push('"max_ciclos" deve ser um inteiro ≥ 1');
  if (!['perguntar', 'decidir'].includes(cfg.autonomia)) p.push('"autonomia" deve ser "perguntar" ou "decidir"');
  if (!['leitura', 'escrita'].includes(cfg.permissoes)) p.push('"permissoes" deve ser "leitura" ou "escrita"');
  if (cfg.relator !== null && !cfg.participantes?.includes(cfg.relator)) {
    p.push('"relator" deve ser um dos participantes, ou null para não gerar relatório');
  }
  if (!(cfg.tempo_max_turno_min > 0)) p.push('"tempo_max_turno_min" deve ser maior que 0');
  if (!Number.isInteger(cfg.tentativas_por_turno) || cfg.tentativas_por_turno < 1) {
    p.push('"tentativas_por_turno" deve ser um inteiro ≥ 1');
  }
  if (!String(cfg.humano ?? '').trim()) p.push('"humano" não pode ficar vazio');
  for (const [id, a] of Object.entries(cfg.agentes)) {
    if (a.comando !== null && typeof a.comando !== 'string' && !Array.isArray(a.comando)) {
      p.push(`agentes.${id}.comando deve ser texto, lista ou null`);
    }
    if (!Array.isArray(a.args_extras)) p.push(`agentes.${id}.args_extras deve ser uma lista`);
    if (!Array.isArray(a.ferramentas_extras)) p.push(`agentes.${id}.ferramentas_extras deve ser uma lista`);
    if (!Array.isArray(a.permitir)) p.push(`agentes.${id}.permitir deve ser uma lista`);
  }
  return p;
}

export function slugDoHumano(nome) {
  const s = slug(nome) || 'humano';
  return [...Object.keys(AGENTES), 'relatorio', 'pauta'].includes(s) ? `${s}-humano` : s;
}

export function verificarPauta(pasta) {
  const arquivo = path.join(pasta, ARQUIVO_PAUTA);
  if (!fs.existsSync(arquivo)) {
    throw new ErroAmigavel(`Falta a pauta: ${arquivo}. É nela que você diz o que quer que as IAs debatam.`);
  }
  if (fs.readFileSync(arquivo, 'utf8').includes(MARCA_MODELO)) {
    throw new ErroAmigavel(`A pauta ainda é o modelo em branco. Preencha ${arquivo} e apague a linha ${MARCA_MODELO}`);
  }
}

/** Cria a pasta de um debate novo com revezamento.json e a pauta em branco. */
export function criarDebate(pasta, { tema, ciclos, autonomia, humano, permissoes } = {}) {
  const pastaAbs = path.resolve(pasta);
  if (ehPastaDeDebate(pastaAbs)) throw new ErroAmigavel(`Já existe um debate em ${pastaAbs}`);
  fs.mkdirSync(pastaAbs, { recursive: true });
  const temaFinal = tema || path.basename(pastaAbs);
  const cfg = {
    tema: temaFinal,
    participantes: PADRAO.participantes,
    max_ciclos: ciclos ? Number(ciclos) : PADRAO.max_ciclos,
    autonomia: autonomia || PADRAO.autonomia,
    humano: humano || process.env.REVEZAR_HUMANO || nomeDoUsuario(),
    relator: PADRAO.relator,
    conferencia_do_relatorio: PADRAO.conferencia_do_relatorio,
    permissoes: permissoes || PADRAO.permissoes,
    tempo_max_turno_min: PADRAO.tempo_max_turno_min,
    instrucoes_extras: '',
  };
  const provisoria = { ...PADRAO, ...cfg, agentes: {} };
  for (const id of Object.keys(AGENTES)) provisoria.agentes[id] = { ...PADRAO_AGENTE };
  const problemas = validar(provisoria);
  if (problemas.length) throw new ErroAmigavel(problemas.join('\n'));
  fs.writeFileSync(path.join(pastaAbs, ARQUIVO_CONFIG), `${JSON.stringify(cfg, null, 2)}\n`);
  const pauta = path.join(pastaAbs, ARQUIVO_PAUTA);
  if (!fs.existsSync(pauta)) fs.writeFileSync(pauta, modeloDePauta(temaFinal, cfg.humano));
  return { pasta: pastaAbs, cfg };
}

function nomeDoUsuario() {
  try {
    const nome = os.userInfo().username;
    return nome ? nome.charAt(0).toUpperCase() + nome.slice(1) : 'Humano';
  } catch {
    return 'Humano';
  }
}

export function modeloDePauta(tema, humano) {
  return `${MARCA_MODELO}
# Pauta: ${tema}

> Escrita por ${humano}. As IAs leem este arquivo antes de cada turno.
> Preencha as seções abaixo e apague a primeira linha (o comentário revezar:preencha…).

## O que eu quero decidir

Escreva em 2 a 5 linhas a pergunta central. Exemplo: "Qual a melhor organização das telas de compra no celular?"

## Contexto e arquivos para ler

- \`caminho/do/arquivo.md\`: por que importa

## O que já está decidido (não rediscutir)

-

## Como quero a resposta

- Exemplo: uma proposta por IA, com prós e contras, e no fim uma recomendação única.
`;
}
