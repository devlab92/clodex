import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import './apoio.mjs';
import { pastaTemporaria } from './apoio.mjs';
import { MARCA_MODELO, carregarDebate, criarDebate, slugDoHumano, verificarPauta } from '../src/config.mjs';

test('novo cria config e pauta em branco, e iniciar recusa pauta não preenchida', () => {
  const pasta = path.join(pastaTemporaria(), 'debate');
  criarDebate(pasta, { tema: 'Cores', ciclos: '2', humano: 'Luiz' });
  const cfg = JSON.parse(fs.readFileSync(path.join(pasta, 'revezamento.json'), 'utf8'));
  assert.equal(cfg.tema, 'Cores');
  assert.equal(cfg.max_ciclos, 2);
  assert.equal(cfg.humano, 'Luiz');
  assert.throws(() => verificarPauta(pasta), /modelo em branco/);
  const pauta = path.join(pasta, '00-pauta.md');
  fs.writeFileSync(pauta, fs.readFileSync(pauta, 'utf8').replace(MARCA_MODELO, ''));
  assert.doesNotThrow(() => verificarPauta(pasta));
  assert.throws(() => criarDebate(pasta), /Já existe/);
});

test('valida a configuração com mensagens claras', () => {
  const pasta = pastaTemporaria();
  const gravar = (cfg) => fs.writeFileSync(path.join(pasta, 'revezamento.json'), JSON.stringify(cfg));
  gravar({ participantes: ['claude'], max_ciclos: 0, autonomia: 'talvez', relator: 'gemini' });
  assert.throws(() => carregarDebate(pasta), (erro) => {
    assert.match(erro.message, /pelo menos 2/);
    assert.match(erro.message, /max_ciclos/);
    assert.match(erro.message, /autonomia/);
    assert.match(erro.message, /relator/);
    return true;
  });
  gravar({ participantes: ['claude', 'codex'], relator: null });
  assert.equal(carregarDebate(pasta).cfg.relator, null);
  fs.writeFileSync(path.join(pasta, 'revezamento.json'), '{ quebrado');
  assert.throws(() => carregarDebate(pasta), /JSON válido/);
});

test('raiz do projeto: git acima da pasta, senão a pasta-mãe, ou o valor configurado', () => {
  const base = pastaTemporaria();
  const debate = path.join(base, 'docs', 'debate');
  fs.mkdirSync(debate, { recursive: true });
  fs.writeFileSync(path.join(debate, 'revezamento.json'), '{}');
  assert.equal(carregarDebate(debate).raiz, path.join(base, 'docs'));
  fs.mkdirSync(path.join(base, '.git'));
  assert.equal(carregarDebate(debate).raiz, base);
  fs.writeFileSync(path.join(debate, 'revezamento.json'), JSON.stringify({ raiz_do_projeto: '..' }));
  assert.equal(carregarDebate(debate).raiz, path.join(base, 'docs'));
});

test('nome do humano vira slug sem colidir com as IAs', () => {
  assert.equal(slugDoHumano('Luiz Augusto'), 'luiz-augusto');
  assert.equal(slugDoHumano('João'), 'joao');
  assert.equal(slugDoHumano('Claude'), 'claude-humano');
  assert.equal(slugDoHumano('Relatório'), 'relatorio-humano');
});
