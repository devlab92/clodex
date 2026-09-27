import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { chamadas, debateDeTeste, esperarArquivo, esperarEstado, ler, opcoesDeTeste, uiDeTeste } from './apoio.mjs';
import { padraoAbsoluto } from '../src/agentes/claude.mjs';
import { enviarParaCaixa, lerEstado, maestroAtivo } from '../src/estado.mjs';
import { continuar, gerarRelatorio, iniciar } from '../src/maestro.mjs';

const fala = (texto, veredito) => ({ texto: `${texto}\n\nVEREDITO: ${veredito}` });

test('consenso em dois turnos gera relatório e conferência', async () => {
  const { pasta, arquivoRoteiro } = debateDeTeste({
    roteiro: {
      claude: [fala('Azul.', 'CONSENSO'), { texto: '# Relatório\n\nAzul venceu.' }],
      codex: [fala('Concordo: azul.', 'CONSENSO'), { texto: 'Confere.\n\nCONFERÊNCIA: OK' }],
    },
  });
  const ui = uiDeTeste();
  const estado = await iniciar(pasta, opcoesDeTeste(ui));

  assert.equal(estado.status, 'concluido');
  assert.equal(estado.motivo, 'consenso');
  assert.deepEqual(estado.turnos.map((t) => t.arquivo), ['01-claude.md', '02-codex.md', '03-relatorio.md']);
  assert.match(ler(pasta, '01-claude.md'), /Azul\./);
  const relatorio = ler(pasta, '03-relatorio.md');
  assert.match(relatorio, /Azul venceu/);
  assert.match(relatorio, /## Conferência de Codex\n\nConfere\./);
  assert.equal(estado.turnos[2].conferencias[0].resultado, 'OK');
  assert.ok(!maestroAtivo(pasta), 'a trava foi liberada');
  assert.ok(ui.linhas.some((l) => l.includes('Debate concluído')));

  const [c1, c2] = chamadas(arquivoRoteiro);
  assert.match(c1.prompt, /Você abre o debate/);
  assert.match(c2.prompt, /Claude declarou CONSENSO no turno anterior/);
  assert.ok(fs.existsSync(path.join(pasta, '.revezar', 'prompts', '01-claude.md')));
  assert.equal(ler(pasta, '.revezar/.gitignore'), '*\n');
});

test('pergunta pausa o debate; a resposta vira turno do humano e o debate segue até o limite', async () => {
  const { pasta, arquivoRoteiro } = debateDeTeste({
    config: { max_ciclos: 1, conferencia_do_relatorio: false },
    roteiro: {
      claude: [
        { texto: 'Depende.\n\n## Pergunta para Luiz\n\n1. Tema claro ou escuro?\n\nVEREDITO: PERGUNTA' },
        { texto: '# Relatório\n\nFicou escuro.' },
      ],
      codex: [fala('Escuro, como o Luiz pediu.', 'CONTINUAR')],
    },
  });
  const rodando = iniciar(pasta, opcoesDeTeste(uiDeTeste()));
  const pausado = await esperarEstado(pasta, (e) => e.status === 'aguardando_humano');
  assert.equal(pausado.pergunta.texto, '1. Tema claro ou escuro?');
  assert.equal(pausado.pergunta.autor, 'claude');

  enviarParaCaixa(pasta, { tipo: 'fala', texto: 'Escuro.' });
  const estado = await rodando;

  assert.equal(estado.status, 'concluido');
  assert.equal(estado.motivo, 'limite');
  assert.deepEqual(estado.turnos.map((t) => t.arquivo), ['01-claude.md', '02-luiz.md', '03-codex.md', '04-relatorio.md']);
  assert.equal(estado.turnos[1].respondeA, 1);
  assert.match(ler(pasta, '02-luiz.md'), /Em resposta à pergunta de Claude no turno 1\._\n\nEscuro\./);
  const promptDoCodex = chamadas(arquivoRoteiro).find((c) => c.como === 'codex').prompt;
  assert.match(promptDoCodex, /Luiz falou desde a sua última vez\*\* \(02-luiz\.md\)/);
  assert.match(promptDoCodex, /último turno de IA antes do relatório/);
});

test('erro na IA: tenta de novo, para em erro e volta com "retomar"', async () => {
  const { pasta } = debateDeTeste({
    config: { max_ciclos: 1, relator: null, tentativas_por_turno: 2 },
    roteiro: {
      claude: [{ erro: 'limite de uso' }, { erro: 'limite de uso' }, fala('Voltei.', 'CONTINUAR')],
      codex: [fala('Ok.', 'CONTINUAR')],
    },
  });
  const ui = uiDeTeste();
  const rodando = iniciar(pasta, opcoesDeTeste(ui));
  const comErro = await esperarEstado(pasta, (e) => e.status === 'erro');
  assert.match(comErro.erro.mensagem, /limite de uso/);
  assert.ok(ui.linhas.some((l) => l.includes('tentativa 1') && l.includes('Tentando de novo')));

  enviarParaCaixa(pasta, { tipo: 'retomar' });
  const estado = await rodando;
  assert.equal(estado.status, 'concluido');
  assert.equal(estado.turnos[0].veredito, 'CONTINUAR');
  assert.ok(fs.existsSync(path.join(pasta, '.revezar', 'saidas', '01-claude.stderr.txt')));
});

test('parar agora interrompe a IA sem gravar o turno; iniciar retoma do mesmo ponto', async () => {
  const { pasta } = debateDeTeste({
    config: { max_ciclos: 1, relator: null },
    roteiro: {
      claude: [{ texto: 'nunca chega', demorarMs: 60_000 }, fala('Agora sim.', 'CONTINUAR')],
      codex: [fala('Ok.', 'CONTINUAR')],
    },
  });
  const rodando = iniciar(pasta, opcoesDeTeste(uiDeTeste()));
  await esperarArquivo(path.join(pasta, '.revezar', 'prompts', '01-claude.md'));
  await new Promise((r) => setTimeout(r, 200));
  enviarParaCaixa(pasta, { tipo: 'parar_agora' });
  const parado = await rodando;
  assert.equal(parado.status, 'parado');
  assert.equal(parado.turnos.length, 0);
  assert.ok(!fs.existsSync(path.join(pasta, '01-claude.md')));

  const retomado = await iniciar(pasta, opcoesDeTeste(uiDeTeste()));
  assert.equal(retomado.status, 'concluido');
  assert.match(ler(pasta, '01-claude.md'), /Agora sim/);
});

test('fala enviada durante um turno entra antes do turno seguinte', async () => {
  const { pasta } = debateDeTeste({
    config: { max_ciclos: 1, relator: null },
    roteiro: {
      claude: [{ texto: 'Primeiro.\n\nVEREDITO: CONTINUAR', demorarMs: 600 }],
      codex: [fala('Segundo.', 'CONTINUAR')],
    },
  });
  const rodando = iniciar(pasta, opcoesDeTeste(uiDeTeste()));
  await esperarArquivo(path.join(pasta, '.revezar', 'prompts', '01-claude.md'));
  enviarParaCaixa(pasta, { tipo: 'fala', texto: 'Lembrem do orçamento.' });
  const estado = await rodando;
  assert.deepEqual(estado.turnos.map((t) => t.arquivo), ['01-claude.md', '02-luiz.md', '03-codex.md']);
});

test('um segundo maestro no mesmo debate é recusado', async () => {
  const { pasta } = debateDeTeste({
    config: { max_ciclos: 1, relator: null },
    roteiro: { claude: [{ texto: 'x\n\nVEREDITO: CONTINUAR', demorarMs: 800 }], codex: [fala('y', 'CONTINUAR')] },
  });
  const primeiro = iniciar(pasta, opcoesDeTeste(uiDeTeste()));
  await esperarEstado(pasta, (e) => e.status === 'rodando');
  assert.ok(maestroAtivo(pasta));
  await assert.rejects(iniciar(pasta, opcoesDeTeste(uiDeTeste())), /Já existe um maestro rodando/);
  await primeiro;
});

test('continuar reabre com mais ciclos e uma fala; relatório sob demanda', async () => {
  const { pasta } = debateDeTeste({
    config: { max_ciclos: 1, conferencia_do_relatorio: false },
    roteiro: {
      claude: [fala('A.', 'CONSENSO'), { texto: 'Relatório 1' }, fala('C.', 'CONTINUAR'), { texto: 'Relatório 2' }, { texto: 'Relatório 3' }],
      codex: [fala('B.', 'CONSENSO'), fala('D.', 'CONTINUAR')],
    },
  });
  let estado = await iniciar(pasta, opcoesDeTeste(uiDeTeste()));
  assert.equal(estado.turnos.length, 3);
  await assert.rejects(iniciar(pasta, opcoesDeTeste(uiDeTeste())), /já terminou/);

  estado = await continuar(pasta, { mais: 1, mensagem: 'Decidi: opção B.' }, opcoesDeTeste(uiDeTeste()));
  assert.equal(estado.status, 'concluido');
  assert.equal(estado.motivo, 'limite');
  assert.deepEqual(estado.turnos.slice(3).map((t) => t.arquivo), ['04-luiz.md', '05-claude.md', '06-codex.md', '07-relatorio.md']);

  estado = await gerarRelatorio(pasta, opcoesDeTeste(uiDeTeste()));
  assert.equal(estado.turnos.at(-1).arquivo, '08-relatorio.md');
  assert.equal(lerEstado(pasta).status, 'concluido');
});

test('modo escrita: cada IA só recebe permissão na pasta de anexos do próprio turno', async () => {
  const { pasta, arquivoRoteiro } = debateDeTeste({
    config: { max_ciclos: 1, relator: null, permissoes: 'escrita' },
    roteiro: { claude: [fala('x', 'CONTINUAR')], codex: [fala('y', 'CONTINUAR')] },
  });
  await iniciar(pasta, opcoesDeTeste(uiDeTeste()));
  const [c, x] = chamadas(arquivoRoteiro);
  const anexosClaude = path.join(pasta, 'anexos', '01-claude');
  assert.ok(c.args.includes(`Edit(${padraoAbsoluto(anexosClaude)}/**)`));
  assert.equal(x.cwd.toLowerCase(), path.join(pasta, 'anexos', '02-codex').toLowerCase());
  assert.ok(x.args.includes('workspace-write'));
  assert.ok(!fs.existsSync(path.join(pasta, 'anexos')), 'pastas de anexo vazias são removidas');
});

test('arquivo de turno criado pela própria IA não é sobrescrito', async () => {
  const { pasta } = debateDeTeste({
    config: { max_ciclos: 1, relator: null },
    roteiro: { claude: [fala('x', 'CONTINUAR')], codex: [fala('y', 'CONTINUAR')] },
  });
  fs.writeFileSync(path.join(pasta, '01-claude.md'), 'escrito pela IA');
  const ui = uiDeTeste();
  await iniciar(pasta, opcoesDeTeste(ui));
  assert.equal(ler(pasta, 'anexos/01-claude/criado-pelo-agente-01-claude.md'), 'escrito pela IA');
  assert.match(ler(pasta, '01-claude.md'), /^<!-- revezar · turno 1/);
});
