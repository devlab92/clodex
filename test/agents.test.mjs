import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { tempDir } from './helpers.mjs';
import claude, { absolutePattern, independentEnv } from '../src/agents/claude.mjs';
import codex from '../src/agents/codex.mjs';
import { compareVersions, inExtensions } from '../src/locate.mjs';

const emptyCfg = { command: null, model: null, effort: null, extra_tools: [], allow: [], extra_args: [] };

test("Claude's path rule uses the //c/… format with wildcards escaped", () => {
  assert.equal(absolutePattern('C:\\Users\\alex\\My Projects\\x', 'win32'), '//c/Users/alex/My Projects/x');
  assert.equal(absolutePattern('/home/alex/[2026] x', 'linux'), '//home/alex/\\[2026\\] x');
});

test('Claude in read mode: read tools only, dontAsk, no write rule', () => {
  const plan = claude.build({ command: ['claude'], prompt: 'P', mode: 'read', root: '/proj', attachmentsDir: '/proj/deb/attachments/01-claude', cfg: emptyCfg, label: 't' });
  const a = plan.args;
  assert.equal(a[a.indexOf('--permission-mode') + 1], 'dontAsk');
  assert.equal(a[a.indexOf('--tools') + 1], 'Read,Glob,Grep');
  assert.ok(!a.includes('--allowedTools'));
  assert.equal(plan.cwd, '/proj');
  assert.equal(plan.input, 'P');
});

test("Claude in write mode: Edit/Write allowed only in the turn's attachments folder", () => {
  const attachments = path.resolve('/proj/deb/attachments/01-claude');
  const plan = claude.build({ command: ['claude'], prompt: 'P', mode: 'write', root: '/proj', attachmentsDir: attachments, cfg: { ...emptyCfg, model: 'opus' }, label: 't' });
  const a = plan.args;
  assert.equal(a[a.indexOf('--tools') + 1], 'Read,Glob,Grep,Edit,Write');
  assert.equal(a[a.indexOf('--allowedTools') + 1], `Edit(${absolutePattern(attachments)}/**)`);
  assert.equal(a[a.indexOf('--model') + 1], 'opus');
});

test('Claude: an extra tool becomes available without being pre-approved; only "allow" pre-approves', () => {
  const cfg = { ...emptyCfg, extra_tools: ['Bash'], allow: ['WebFetch'] };
  const a = claude.build({ command: ['claude'], prompt: 'P', mode: 'read', root: '/proj', attachmentsDir: '/x', cfg, label: 't' }).args;
  assert.equal(a[a.indexOf('--tools') + 1], 'Read,Glob,Grep,Bash');
  assert.deepEqual(a.slice(a.indexOf('--allowedTools') + 1), ['WebFetch']);
});

test('Claude starts as an independent session, even when launched from inside Claude Code', () => {
  const env = independentEnv({ PATH: 'x', CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 's', CLAUDE_CODE_MESSAGING_TOKEN: 't', ANTHROPIC_API_KEY: 'k' });
  assert.deepEqual(env, { PATH: 'x', ANTHROPIC_API_KEY: 'k' });
});

test('Claude: parses success and errors', () => {
  const ok = claude.parse({ code: 0, stdout: JSON.stringify({ type: 'result', subtype: 'success', result: 'hi', session_id: 's' }), stderr: '' });
  assert.deepEqual(ok, { text: 'hi', session: 's', costUsd: null });
  assert.throws(() => claude.parse({ code: 1, stdout: '', stderr: 'failed badly' }), /failed badly/);
  assert.throws(
    () => claude.parse({ code: 0, stdout: JSON.stringify({ type: 'result', subtype: 'error_max_turns', is_error: true }), stderr: '' }),
    /error_max_turns/,
  );
});

test('Codex: read mode in the root with read-only; write mode confined to the attachments folder', () => {
  const read = codex.build({ command: ['codex'], prompt: 'P', mode: 'read', root: '/proj', attachmentsDir: '/proj/a', lastMessageFile: '/tmp/l.md', cfg: emptyCfg });
  assert.deepEqual(read.args.slice(0, 6), ['exec', '--json', '--color', 'never', '-o', '/tmp/l.md']);
  assert.equal(read.args[read.args.indexOf('-C') + 1], '/proj');
  assert.equal(read.args[read.args.indexOf('-s') + 1], 'read-only');
  assert.equal(read.args.at(-1), '-');
  const write = codex.build({ command: ['codex'], prompt: 'P', mode: 'write', root: '/proj', attachmentsDir: '/proj/a', lastMessageFile: '/tmp/l.md', cfg: emptyCfg });
  assert.equal(write.args[write.args.indexOf('-C') + 1], '/proj/a');
  assert.equal(write.args[write.args.indexOf('-s') + 1], 'workspace-write');
  assert.equal(write.cwd, '/proj/a');
});

test('Codex: reads the last message from the file and reports an error when there is no text', () => {
  const dir = tempDir();
  const file = path.join(dir, 'l.md');
  fs.writeFileSync(file, 'answer');
  const stdout = `${JSON.stringify({ type: 'thread.started', thread_id: 'T1' })}\n`;
  assert.equal(codex.parse({ code: 0, stdout, stderr: '' }, { lastMessageFile: file }).session, 'T1');
  const error = `${JSON.stringify({ type: 'error', message: 'quota exceeded' })}\n`;
  assert.throws(() => codex.parse({ code: 1, stdout: error, stderr: '' }, { lastMessageFile: path.join(dir, 'no.md') }), /quota exceeded/);
});

test('finds the executable in the newest extension version', () => {
  assert.ok(compareVersions('anthropic.claude-code-2.1.283-win32-x64', 'anthropic.claude-code-2.1.99-win32-x64') > 0);
  const base = tempDir();
  for (const v of ['2.1.9', '2.1.283', '2.1.40']) {
    const bin = path.join(base, `anthropic.claude-code-${v}-win32-x64`, 'resources', 'native-binary');
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, 'claude.exe'), '');
  }
  const found = inExtensions('anthropic.claude-code-', [path.join('resources', 'native-binary', 'claude.exe')], [base]);
  assert.match(found, /2\.1\.283/);
});
