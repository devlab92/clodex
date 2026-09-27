import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { testDebate, testTerminal } from './helpers.mjs';
import { Orchestrator } from '../src/orchestrator.mjs';

function testOrchestrator() {
  const { dir } = testDebate();
  const o = new Orchestrator(dir, {});
  o.terminal = testTerminal();
  o.state = { status: 'running', turns: [] };
  return { o, dir };
}

test('what you type in the terminal becomes a message or a command', () => {
  const { o, dir } = testOrchestrator();
  o.onLine('I prefer blue.');
  o.onLine('   ');
  assert.deepEqual(o.ctl.messages, ['I prefer blue.']);

  const file = path.join(dir, 'answer.md');
  fs.writeFileSync(file, 'Long text\non two lines.\n');
  o.onLine(`@${file}`);
  assert.equal(o.ctl.messages[1], 'Long text\non two lines.');

  o.onLine('/pause');
  assert.equal(o.ctl.pause, true);
  o.onLine('/resume');
  assert.equal(o.ctl.pause, false);
  assert.equal(o.ctl.resume, true);

  o.onLine('/whatever');
  assert.match(o.terminal.lines.at(-1), /Unknown command: \/whatever/);
  o.onLine('@does-not-exist.md');
  assert.match(o.terminal.lines.at(-1), /File not found/);
  o.onLine('/status');
  assert.match(o.terminal.lines.at(-1), /Clodex · Test/);
});

test('/stop waits for the turn; /stop now cancels the running AI', () => {
  const { o } = testOrchestrator();
  o.inTurn = true;
  o.ctl.abort = new AbortController();
  o.onLine('/stop');
  assert.equal(o.ctl.stopAfter, true);
  assert.equal(o.ctl.abort.signal.aborted, false);
  o.onLine('/Stop   Now');
  assert.equal(o.ctl.abort.signal.aborted, true);
});

test('Ctrl+C: the first asks to stop when the turn ends, the second stops right away', () => {
  const { o } = testOrchestrator();
  o.inTurn = true;
  o.ctl.abort = new AbortController();
  o.onCtrlC();
  assert.equal(o.ctl.stopAfter, true);
  assert.equal(o.ctl.abort.signal.aborted, false);
  o.onCtrlC();
  assert.equal(o.ctl.abort.signal.aborted, true);
});
