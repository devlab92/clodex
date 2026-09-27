import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { debateDeTeste, uiDeTeste } from './apoio.mjs';
import { Maestro } from '../src/maestro.mjs';

function maestroDeTeste() {
  const { pasta } = debateDeTeste();
  const m = new Maestro(pasta, {});
  m.ui = uiDeTeste();
  m.estado = { status: 'rodando', turnos: [] };
  return { m, pasta };
}

test('o que se digita no terminal vira fala ou comando', () => {
  const { m, pasta } = maestroDeTeste();
  m.aoDigitar('Prefiro azul.');
  m.aoDigitar('   ');
  assert.deepEqual(m.ctl.falas, ['Prefiro azul.']);

  const arquivo = path.join(pasta, 'resposta.md');
  fs.writeFileSync(arquivo, 'Texto longo\ncom duas linhas.\n');
  m.aoDigitar(`@${arquivo}`);
  assert.equal(m.ctl.falas[1], 'Texto longo\ncom duas linhas.');

  m.aoDigitar('/pausar');
  assert.equal(m.ctl.pausar, true);
  m.aoDigitar('/retomar');
  assert.equal(m.ctl.pausar, false);
  assert.equal(m.ctl.retomar, true);

  m.aoDigitar('/qualquer');
  assert.match(m.ui.linhas.at(-1), /Comando desconhecido: \/qualquer/);
  m.aoDigitar('@nao-existe.md');
  assert.match(m.ui.linhas.at(-1), /Arquivo não encontrado/);
  m.aoDigitar('/status');
  assert.match(m.ui.linhas.at(-1), /Revezamento · Teste/);
});

test('/parar espera o turno; /parar agora cancela a IA em andamento', () => {
  const { m } = maestroDeTeste();
  m.emTurno = true;
  m.ctl.abort = new AbortController();
  m.aoDigitar('/parar');
  assert.equal(m.ctl.pararDepois, true);
  assert.equal(m.ctl.abort.signal.aborted, false);
  m.aoDigitar('/Parar   Agora');
  assert.equal(m.ctl.abort.signal.aborted, true);
});

test('Ctrl+C: primeiro pede parada no fim do turno, o segundo para na hora', () => {
  const { m } = maestroDeTeste();
  m.emTurno = true;
  m.ctl.abort = new AbortController();
  m.aoCtrlC();
  assert.equal(m.ctl.pararDepois, true);
  assert.equal(m.ctl.abort.signal.aborted, false);
  m.aoCtrlC();
  assert.equal(m.ctl.abort.signal.aborted, true);
});
