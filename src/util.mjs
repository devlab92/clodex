import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** Erro com mensagem pronta para o usuário: o CLI mostra só o texto, sem pilha. */
export class ErroAmigavel extends Error {
  constructor(mensagem) {
    super(mensagem);
    this.amigavel = true;
  }
}

export const dormir = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

export function slug(texto) {
  return String(texto)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function duracao(segundos) {
  const s = Math.max(0, Math.round(segundos));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`;
}

export function hashDe(texto) {
  return crypto.createHash('sha256').update(texto).digest('hex');
}

export function hashDoArquivo(caminho) {
  try {
    return hashDe(fs.readFileSync(caminho));
  } catch {
    return null;
  }
}

/** Grava por arquivo temporário + rename, para quem lê nunca ver um arquivo pela metade. */
export function gravarAtomico(caminho, conteudo) {
  fs.mkdirSync(path.dirname(caminho), { recursive: true });
  const temporario = `${caminho}.${process.pid}.tmp`;
  fs.writeFileSync(temporario, conteudo);
  try {
    fs.renameSync(temporario, caminho);
  } catch {
    // No Windows o rename falha se outro processo estiver lendo o destino.
    fs.writeFileSync(caminho, conteudo);
    fs.rmSync(temporario, { force: true });
  }
}

export function lerJson(caminho) {
  return JSON.parse(fs.readFileSync(caminho, 'utf8').replace(/^﻿/, ''));
}

export function agora() {
  return new Date().toISOString();
}

export function dataHoraLocal(data = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${data.getFullYear()}-${p(data.getMonth() + 1)}-${p(data.getDate())} ${p(data.getHours())}:${p(data.getMinutes())}`;
}

/** Sobe a partir de `inicio` procurando uma pasta ou arquivo `.git`. */
export function raizGit(inicio) {
  let atual = path.resolve(inicio);
  while (true) {
    if (fs.existsSync(path.join(atual, '.git'))) return atual;
    const pai = path.dirname(atual);
    if (pai === atual) return null;
    atual = pai;
  }
}

/** Texto começando com @ vira o conteúdo do arquivo indicado. */
export function resolverTexto(texto, base = process.cwd()) {
  const limpo = String(texto ?? '').trim();
  if (!limpo.startsWith('@')) return limpo;
  const caminho = path.resolve(base, limpo.slice(1).trim().replace(/^["']|["']$/g, ''));
  if (!fs.existsSync(caminho)) throw new ErroAmigavel(`Arquivo não encontrado: ${caminho}`);
  return fs.readFileSync(caminho, 'utf8').trim();
}
