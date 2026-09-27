import claude from './claude.mjs';
import codex from './codex.mjs';

/** Agentes disponíveis. Para acrescentar outro, veja "Como acrescentar uma IA" no docs/MANUAL.md. */
export const AGENTES = { claude, codex };

export function nomeDoAgente(id) {
  return AGENTES[id]?.nome ?? id;
}
