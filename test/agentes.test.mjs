import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { pastaTemporaria } from './apoio.mjs';
import claude, { ambienteIndependente, padraoAbsoluto } from '../src/agentes/claude.mjs';
import codex from '../src/agentes/codex.mjs';
import { compararVersoes, nasExtensoes } from '../src/localizar.mjs';

const cfgVazia = { comando: null, modelo: null, esforco: null, ferramentas_extras: [], permitir: [], args_extras: [] };

test('regra de caminho do Claude no formato //c/… com curingas escapados', () => {
  assert.equal(padraoAbsoluto('C:\\Users\\Luiz\\AUTO AI\\x', 'win32'), '//c/Users/Luiz/AUTO AI/x');
  assert.equal(padraoAbsoluto('/home/luiz/[2026] x', 'linux'), '//home/luiz/\\[2026\\] x');
});

test('Claude em modo leitura: só ferramentas de leitura, dontAsk, sem regra de escrita', () => {
  const plano = claude.montar({ comando: ['claude'], prompt: 'P', modo: 'leitura', raiz: '/proj', pastaAnexos: '/proj/deb/anexos/01-claude', cfg: cfgVazia, rotulo: 't' });
  const a = plano.args;
  assert.equal(a[a.indexOf('--permission-mode') + 1], 'dontAsk');
  assert.equal(a[a.indexOf('--tools') + 1], 'Read,Glob,Grep');
  assert.ok(!a.includes('--allowedTools'));
  assert.equal(plano.cwd, '/proj');
  assert.equal(plano.entrada, 'P');
});

test('Claude em modo escrita: Edit/Write liberados só na pasta de anexos do turno', () => {
  const anexos = path.resolve('/proj/deb/anexos/01-claude');
  const plano = claude.montar({ comando: ['claude'], prompt: 'P', modo: 'escrita', raiz: '/proj', pastaAnexos: anexos, cfg: { ...cfgVazia, modelo: 'opus' }, rotulo: 't' });
  const a = plano.args;
  assert.equal(a[a.indexOf('--tools') + 1], 'Read,Glob,Grep,Edit,Write');
  assert.equal(a[a.indexOf('--allowedTools') + 1], `Edit(${padraoAbsoluto(anexos)}/**)`);
  assert.equal(a[a.indexOf('--model') + 1], 'opus');
});

test('Claude: ferramenta extra fica disponível sem ser pré-aprovada; só "permitir" pré-aprova', () => {
  const cfg = { ...cfgVazia, ferramentas_extras: ['Bash'], permitir: ['WebFetch'] };
  const a = claude.montar({ comando: ['claude'], prompt: 'P', modo: 'leitura', raiz: '/proj', pastaAnexos: '/x', cfg, rotulo: 't' }).args;
  assert.equal(a[a.indexOf('--tools') + 1], 'Read,Glob,Grep,Bash');
  assert.deepEqual(a.slice(a.indexOf('--allowedTools') + 1), ['WebFetch']);
});

test('Claude nasce como sessão independente, mesmo chamado de dentro do Claude Code', () => {
  const env = ambienteIndependente({ PATH: 'x', CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 's', CLAUDE_CODE_MESSAGING_TOKEN: 't', ANTHROPIC_API_KEY: 'k' });
  assert.deepEqual(env, { PATH: 'x', ANTHROPIC_API_KEY: 'k' });
});

test('Claude: interpreta sucesso e erros', () => {
  const ok = claude.interpretar({ codigo: 0, stdout: JSON.stringify({ type: 'result', subtype: 'success', result: 'oi', session_id: 's' }), stderr: '' });
  assert.deepEqual(ok, { texto: 'oi', sessao: 's', custoUsd: null });
  assert.throws(() => claude.interpretar({ codigo: 1, stdout: '', stderr: 'falhou feio' }), /falhou feio/);
  assert.throws(
    () => claude.interpretar({ codigo: 0, stdout: JSON.stringify({ type: 'result', subtype: 'error_max_turns', is_error: true }), stderr: '' }),
    /error_max_turns/,
  );
});

test('Codex: leitura na raiz em read-only; escrita confinada à pasta de anexos', () => {
  const leitura = codex.montar({ comando: ['codex'], prompt: 'P', modo: 'leitura', raiz: '/proj', pastaAnexos: '/proj/a', arquivoUltimaMensagem: '/tmp/u.md', cfg: cfgVazia });
  assert.deepEqual(leitura.args.slice(0, 6), ['exec', '--json', '--color', 'never', '-o', '/tmp/u.md']);
  assert.equal(leitura.args[leitura.args.indexOf('-C') + 1], '/proj');
  assert.equal(leitura.args[leitura.args.indexOf('-s') + 1], 'read-only');
  assert.equal(leitura.args.at(-1), '-');
  const escrita = codex.montar({ comando: ['codex'], prompt: 'P', modo: 'escrita', raiz: '/proj', pastaAnexos: '/proj/a', arquivoUltimaMensagem: '/tmp/u.md', cfg: cfgVazia });
  assert.equal(escrita.args[escrita.args.indexOf('-C') + 1], '/proj/a');
  assert.equal(escrita.args[escrita.args.indexOf('-s') + 1], 'workspace-write');
  assert.equal(escrita.cwd, '/proj/a');
});

test('Codex: lê a última mensagem do arquivo e acusa erro sem texto', () => {
  const pasta = pastaTemporaria();
  const arquivo = path.join(pasta, 'u.md');
  fs.writeFileSync(arquivo, 'resposta');
  const stdout = `${JSON.stringify({ type: 'thread.started', thread_id: 'T1' })}\n`;
  assert.equal(codex.interpretar({ codigo: 0, stdout, stderr: '' }, { arquivoUltimaMensagem: arquivo }).sessao, 'T1');
  const erro = `${JSON.stringify({ type: 'error', message: 'cota esgotada' })}\n`;
  assert.throws(() => codex.interpretar({ codigo: 1, stdout: erro, stderr: '' }, { arquivoUltimaMensagem: path.join(pasta, 'nao.md') }), /cota esgotada/);
});

test('localiza o executável na versão mais nova da extensão', () => {
  assert.ok(compararVersoes('anthropic.claude-code-2.1.283-win32-x64', 'anthropic.claude-code-2.1.99-win32-x64') > 0);
  const base = pastaTemporaria();
  for (const v of ['2.1.9', '2.1.283', '2.1.40']) {
    const bin = path.join(base, `anthropic.claude-code-${v}-win32-x64`, 'resources', 'native-binary');
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, 'claude.exe'), '');
  }
  const achado = nasExtensoes('anthropic.claude-code-', [path.join('resources', 'native-binary', 'claude.exe')], [base]);
  assert.match(achado, /2\.1\.283/);
});
