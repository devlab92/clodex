/**
 * The terminal speaks English. The debate itself (what the AIs write and the few lines
 * Clodex writes into debate files) follows the "language" setting.
 * Unknown languages fall back to English templates; the AIs still write in the language asked.
 */

const TEXT = {
  en: {
    name: 'English',
    humanHeader: (human, n) => `# ${human} · turn ${n}`,
    inReplyTo: (agent, n) => `_In reply to ${agent}'s question in turn ${n}._`,
    reviewHeading: (agent) => `## Review by ${agent}`,
    brief: (topic, human, mark) => `${mark}
# Brief: ${topic}

> Written by ${human}. The AIs read this file before every turn.
> Fill in the sections below and delete the first line (the clodex:fill-in… comment).

## What I want to decide

Write the central question in 2 to 5 lines. Example: "What is the best checkout flow on mobile?"

## Context and files to read

- \`path/to/file.md\`: why it matters

## Already decided (do not reopen)

-

## How I want the answer

- Example: one proposal per AI, with pros and cons, and a single recommendation at the end.
`,
  },
  'pt-BR': {
    name: 'Brazilian Portuguese (pt-BR)',
    humanHeader: (human, n) => `# ${human} · turno ${n}`,
    inReplyTo: (agent, n) => `_Em resposta à pergunta de ${agent} no turno ${n}._`,
    reviewHeading: (agent) => `## Conferência de ${agent}`,
    brief: (topic, human, mark) => `${mark}
# Pauta: ${topic}

> Escrita por ${human}. As IAs leem este arquivo antes de cada turno.
> Preencha as seções abaixo e apague a primeira linha (o comentário clodex:fill-in…).

## O que eu quero decidir

Escreva em 2 a 5 linhas a pergunta central. Exemplo: "Qual o melhor fluxo de compra no celular?"

## Contexto e arquivos para ler

- \`caminho/do/arquivo.md\`: por que importa

## O que já está decidido (não rediscutir)

-

## Como quero a resposta

- Exemplo: uma proposta por IA, com prós e contras, e no fim uma recomendação única.
`,
  },
};

export const LANGUAGES = Object.keys(TEXT);

export function fileText(language) {
  return TEXT[language] ?? TEXT.en;
}

export function languageName(language) {
  return TEXT[language]?.name ?? language;
}

/** Language of the operating system, if Clodex has templates for it; otherwise English. */
export function systemLanguage() {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    if (TEXT[locale]) return locale;
    const base = locale.split('-')[0];
    return LANGUAGES.find((l) => l.split('-')[0] === base) ?? 'en';
  } catch {
    return 'en';
  }
}
