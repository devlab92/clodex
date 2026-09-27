import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  extrairPergunta,
  houveConsenso,
  lerConferencia,
  lerVeredito,
  limiteDeTurnos,
  nomeDoTurno,
  proximoParticipante,
} from '../src/transcricao.mjs';

const P = ['claude', 'codex'];
const ag = (autor, veredito) => ({ tipo: 'agente', autor, veredito });

test('nome do turno tem dois dígitos e o autor', () => {
  assert.equal(nomeDoTurno(3, 'codex'), '03-codex.md');
  assert.equal(nomeDoTurno(12, 'luiz'), '12-luiz.md');
});

test('lê o veredito em formatos variados e fica com o último', () => {
  assert.equal(lerVeredito('texto\n\nVEREDITO: CONTINUAR'), 'CONTINUAR');
  assert.equal(lerVeredito('**VEREDITO:** CONSENSO'), 'CONSENSO');
  assert.equal(lerVeredito('`VEREDITO: PERGUNTA`'), 'PERGUNTA');
  assert.equal(lerVeredito('> veredito: consenso'), 'CONSENSO');
  assert.equal(lerVeredito('VEREDITO: CONTINUAR\n...\nVEREDITO: CONSENSO'), 'CONSENSO');
  assert.equal(lerVeredito('sem linha de veredito'), null);
  assert.equal(lerVeredito('o VEREDITO: CONSENSO no meio da frase não conta'), null);
});

test('lê a conferência', () => {
  assert.equal(lerConferencia('Confere.\n\nCONFERÊNCIA: OK'), 'OK');
  assert.equal(lerConferencia('CONFERENCIA: CORREÇÕES'), 'CORRECOES');
  assert.equal(lerConferencia('CONFERÊNCIA: correcoes'), 'CORRECOES');
  assert.equal(lerConferencia('nada'), null);
});

test('extrai a seção da pergunta', () => {
  const texto = '# Posição\n\nbla\n\n## Pergunta para Luiz\n\n1. A ou B?\n2. Prazo?\n\nVEREDITO: PERGUNTA';
  assert.equal(extrairPergunta(texto), '1. A ou B?\n2. Prazo?');
  const semSecao = 'Preciso saber se pode usar X.\n\nVEREDITO: PERGUNTA';
  assert.equal(extrairPergunta(semSecao), 'Preciso saber se pode usar X.');
});

test('consenso exige todas as IAs, diferentes, em sequência', () => {
  assert.equal(houveConsenso([ag('claude', 'CONSENSO')], P), false);
  assert.equal(houveConsenso([ag('claude', 'CONSENSO'), ag('codex', 'CONSENSO')], P), true);
  assert.equal(houveConsenso([ag('claude', 'CONSENSO'), ag('codex', 'CONTINUAR')], P), false);
  assert.equal(houveConsenso([ag('claude', 'CONSENSO'), { tipo: 'humano', autor: 'luiz' }, ag('codex', 'CONSENSO')], P), false);
  assert.equal(houveConsenso([ag('codex', 'CONSENSO'), ag('codex', 'CONSENSO')], P), false);
});

test('rodízio conta só turnos de IA', () => {
  assert.equal(proximoParticipante([], P), 'claude');
  assert.equal(proximoParticipante([ag('claude', 'CONTINUAR')], P), 'codex');
  assert.equal(proximoParticipante([ag('claude', 'PERGUNTA'), { tipo: 'humano' }], P), 'codex');
  assert.equal(proximoParticipante([ag('claude'), ag('codex')], ['codex', 'claude']), 'codex');
});

test('limite de turnos soma ciclos extras', () => {
  assert.equal(limiteDeTurnos({ max_ciclos: 3, participantes: P }, {}), 6);
  assert.equal(limiteDeTurnos({ max_ciclos: 3, participantes: P }, { ciclosExtras: -1 }), 4);
});
