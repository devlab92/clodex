import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { calls, read, testDebate, testOptions, testTerminal, waitForFile, waitForState } from './helpers.mjs';
import { absolutePattern } from '../src/agents/claude.mjs';
import { isRunning, readState, sendToInbox } from '../src/state.mjs';
import { continueDebate, generateReport, start } from '../src/orchestrator.mjs';

const say = (text, verdict) => ({ text: `${text}\n\nVERDICT: ${verdict}` });

test('consensus in two turns produces a report and a review', async () => {
  const { dir, scriptFile } = testDebate({
    script: {
      claude: [say('Blue.', 'CONSENSUS'), { text: '# Report\n\nBlue won.' }],
      codex: [say('Agreed: blue.', 'CONSENSUS'), { text: 'Accurate.\n\nREVIEW: OK' }],
    },
  });
  const terminal = testTerminal();
  const state = await start(dir, testOptions(terminal));

  assert.equal(state.status, 'done');
  assert.equal(state.reason, 'consensus');
  assert.deepEqual(state.turns.map((t) => t.file), ['01-claude.md', '02-codex.md', '03-report.md']);
  assert.match(read(dir, '01-claude.md'), /Blue\./);
  const report = read(dir, '03-report.md');
  assert.match(report, /Blue won/);
  assert.match(report, /## Review by Codex\n\nAccurate\./);
  assert.equal(state.turns[2].reviews[0].result, 'OK');
  assert.ok(!isRunning(dir), 'the lock was released');
  assert.ok(terminal.lines.some((l) => l.includes('Debate finished')));

  const [c1, c2] = calls(scriptFile);
  assert.match(c1.prompt, /You open the debate/);
  assert.match(c2.prompt, /Claude declared CONSENSUS in the previous turn/);
  assert.ok(fs.existsSync(path.join(dir, '.clodex', 'prompts', '01-claude.md')));
  assert.equal(read(dir, '.clodex/.gitignore'), '*\n');
});

test('a question pauses the debate; the answer becomes a human turn and the debate goes on to the limit', async () => {
  const { dir, scriptFile } = testDebate({
    config: { max_cycles: 1, report_review: false },
    script: {
      claude: [
        { text: 'It depends.\n\n## Question for Alex\n\n1. Light or dark theme?\n\nVERDICT: QUESTION' },
        { text: '# Report\n\nDark it is.' },
      ],
      codex: [say('Dark, as Alex asked.', 'CONTINUE')],
    },
  });
  const running = start(dir, testOptions(testTerminal()));
  const paused = await waitForState(dir, (s) => s.status === 'waiting_human');
  assert.equal(paused.question.text, '1. Light or dark theme?');
  assert.equal(paused.question.author, 'claude');

  sendToInbox(dir, { type: 'say', text: 'Dark.' });
  const state = await running;

  assert.equal(state.status, 'done');
  assert.equal(state.reason, 'limit');
  assert.deepEqual(state.turns.map((t) => t.file), ['01-claude.md', '02-alex.md', '03-codex.md', '04-report.md']);
  assert.equal(state.turns[1].repliesTo, 1);
  assert.match(read(dir, '02-alex.md'), /In reply to Claude's question in turn 1\._\n\nDark\./);
  const codexPrompt = calls(scriptFile).find((c) => c.as === 'codex').prompt;
  assert.match(codexPrompt, /Alex has spoken since your last turn\*\* \(02-alex\.md\)/);
  assert.match(codexPrompt, /last AI turn before the final report/);
});

test('debate language: prompts ask for it and debate files are written in it', async () => {
  const { dir, scriptFile } = testDebate({
    config: { max_cycles: 1, language: 'pt-BR' },
    script: {
      claude: [{ text: 'Depende.\n\n## Pergunta para Alex\n\n1. Claro ou escuro?\n\nVEREDITO: PERGUNTA' }, { text: '# Relatório' }],
      codex: [say('Escuro.', 'CONTINUE'), { text: 'Confere.\n\nREVIEW: OK' }],
    },
  });
  const running = start(dir, testOptions(testTerminal()));
  const paused = await waitForState(dir, (s) => s.status === 'waiting_human');
  assert.equal(paused.question.text, '1. Claro ou escuro?');
  sendToInbox(dir, { type: 'say', text: 'Escuro.' });
  await running;
  assert.match(read(dir, '02-alex.md'), /# Alex · turno 2\n\n_Em resposta à pergunta de Claude no turno 1\._/);
  assert.match(read(dir, '04-report.md'), /## Conferência de Codex/);
  assert.match(calls(scriptFile)[0].prompt, /Write in Brazilian Portuguese \(pt-BR\)/);
});

test('AI error: retries, stops on error, and comes back with "resume"', async () => {
  const { dir } = testDebate({
    config: { max_cycles: 1, reporter: null, attempts_per_turn: 2 },
    script: {
      claude: [{ error: 'usage limit' }, { error: 'usage limit' }, say('Back.', 'CONTINUE')],
      codex: [say('Ok.', 'CONTINUE')],
    },
  });
  const terminal = testTerminal();
  const running = start(dir, testOptions(terminal));
  const failed = await waitForState(dir, (s) => s.status === 'error');
  assert.match(failed.error.message, /usage limit/);
  assert.ok(terminal.lines.some((l) => l.includes('attempt 1') && l.includes('Trying again')));

  sendToInbox(dir, { type: 'resume' });
  const state = await running;
  assert.equal(state.status, 'done');
  assert.equal(state.turns[0].verdict, 'CONTINUE');
  assert.ok(fs.existsSync(path.join(dir, '.clodex', 'outputs', '01-claude.stderr.txt')));
});

test('stop now interrupts the AI without saving the turn; start resumes from the same point', async () => {
  const { dir } = testDebate({
    config: { max_cycles: 1, reporter: null },
    script: {
      claude: [{ text: 'never arrives', delayMs: 60_000 }, say('Now it does.', 'CONTINUE')],
      codex: [say('Ok.', 'CONTINUE')],
    },
  });
  const running = start(dir, testOptions(testTerminal()));
  await waitForFile(path.join(dir, '.clodex', 'prompts', '01-claude.md'));
  await new Promise((r) => setTimeout(r, 200));
  sendToInbox(dir, { type: 'stop_now' });
  const stopped = await running;
  assert.equal(stopped.status, 'stopped');
  assert.equal(stopped.turns.length, 0);
  assert.ok(!fs.existsSync(path.join(dir, '01-claude.md')));

  const resumed = await start(dir, testOptions(testTerminal()));
  assert.equal(resumed.status, 'done');
  assert.match(read(dir, '01-claude.md'), /Now it does/);
});

test('a message sent during a turn goes in before the next turn', async () => {
  const { dir } = testDebate({
    config: { max_cycles: 1, reporter: null },
    script: {
      claude: [{ text: 'First.\n\nVERDICT: CONTINUE', delayMs: 600 }],
      codex: [say('Second.', 'CONTINUE')],
    },
  });
  const running = start(dir, testOptions(testTerminal()));
  await waitForFile(path.join(dir, '.clodex', 'prompts', '01-claude.md'));
  sendToInbox(dir, { type: 'say', text: 'Mind the budget.' });
  const state = await running;
  assert.deepEqual(state.turns.map((t) => t.file), ['01-claude.md', '02-alex.md', '03-codex.md']);
});

test('a second orchestrator on the same debate is refused', async () => {
  const { dir } = testDebate({
    config: { max_cycles: 1, reporter: null },
    script: { claude: [{ text: 'x\n\nVERDICT: CONTINUE', delayMs: 800 }], codex: [say('y', 'CONTINUE')] },
  });
  const first = start(dir, testOptions(testTerminal()));
  await waitForState(dir, (s) => s.status === 'running');
  assert.ok(isRunning(dir));
  await assert.rejects(start(dir, testOptions(testTerminal())), /already running this debate/);
  await first;
});

test('continue reopens with more cycles and a message; report on demand', async () => {
  const { dir } = testDebate({
    config: { max_cycles: 1, report_review: false },
    script: {
      claude: [say('A.', 'CONSENSUS'), { text: 'Report 1' }, say('C.', 'CONTINUE'), { text: 'Report 2' }, { text: 'Report 3' }],
      codex: [say('B.', 'CONSENSUS'), say('D.', 'CONTINUE')],
    },
  });
  let state = await start(dir, testOptions(testTerminal()));
  assert.equal(state.turns.length, 3);
  await assert.rejects(start(dir, testOptions(testTerminal())), /already finished/);

  state = await continueDebate(dir, { more: 1, message: 'Decided: option B.' }, testOptions(testTerminal()));
  assert.equal(state.status, 'done');
  assert.equal(state.reason, 'limit');
  assert.deepEqual(state.turns.slice(3).map((t) => t.file), ['04-alex.md', '05-claude.md', '06-codex.md', '07-report.md']);

  state = await generateReport(dir, testOptions(testTerminal()));
  assert.equal(state.turns.at(-1).file, '08-report.md');
  assert.equal(readState(dir).status, 'done');
});

test("write mode: each AI only gets permission in its own turn's attachments folder", async () => {
  const { dir, scriptFile } = testDebate({
    config: { max_cycles: 1, reporter: null, permissions: 'write' },
    script: { claude: [say('x', 'CONTINUE')], codex: [say('y', 'CONTINUE')] },
  });
  await start(dir, testOptions(testTerminal()));
  const [c, x] = calls(scriptFile);
  assert.ok(c.args.includes(`Edit(${absolutePattern(path.join(dir, 'attachments', '01-claude'))}/**)`));
  assert.equal(x.cwd.toLowerCase(), path.join(dir, 'attachments', '02-codex').toLowerCase());
  assert.ok(x.args.includes('workspace-write'));
  assert.ok(!fs.existsSync(path.join(dir, 'attachments')), 'empty attachment folders are removed');
});

test('a turn file created by the AI itself is not overwritten', async () => {
  const { dir } = testDebate({
    config: { max_cycles: 1, reporter: null },
    script: { claude: [say('x', 'CONTINUE')], codex: [say('y', 'CONTINUE')] },
  });
  fs.writeFileSync(path.join(dir, '01-claude.md'), 'written by the AI');
  await start(dir, testOptions(testTerminal()));
  assert.equal(read(dir, 'attachments/01-claude/created-by-agent-01-claude.md'), 'written by the AI');
  assert.match(read(dir, '01-claude.md'), /^<!-- clodex · turn 1/);
});
