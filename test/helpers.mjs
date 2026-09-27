import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readState } from '../src/state.mjs';
import { stripColor } from '../src/terminal.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const FAKE_AGENT = path.join(here, 'fakes', 'fake-agent.mjs');

// No test touches the user's ~/.clodex.
process.env.CLODEX_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'clodex-home-'));

export function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'clodex-test-'));
}

/** Creates a debate in a temp folder, with both AIs replaced by the fake agent. */
export function testDebate({ config = {}, script = {}, brief = '# Brief\n\nWhat is the best color?\n' } = {}) {
  const dir = tempDir();
  const scriptFile = path.join(dir, '..', `${path.basename(dir)}.script.json`);
  fs.writeFileSync(scriptFile, JSON.stringify(script));
  const command = (as) => [process.execPath, FAKE_AGENT, '--as', as, '--script', scriptFile];
  const cfg = {
    topic: 'Test',
    human: 'Alex',
    max_cycles: 2,
    notify: false,
    turn_timeout_min: 1,
    ...config,
    agents: {
      claude: { command: command('claude'), ...(config.agents?.claude ?? {}) },
      codex: { command: command('codex'), ...(config.agents?.codex ?? {}) },
    },
  };
  fs.writeFileSync(path.join(dir, 'clodex.json'), JSON.stringify(cfg, null, 2));
  fs.writeFileSync(path.join(dir, '00-brief.md'), brief);
  return { dir, scriptFile };
}

export function calls(scriptFile) {
  const file = `${scriptFile}.calls.jsonl`;
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
}

export function testTerminal() {
  const lines = [];
  return { interactive: false, lines, write: (t) => lines.push(stripColor(t)), close() {} };
}

export const testOptions = (terminal) => ({ terminal, notify: false, inboxIntervalMs: 20, waitIntervalMs: 20 });

export async function waitForState(dir, condition, limitMs = 15_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < limitMs) {
    const s = readState(dir);
    if (s && condition(s)) return s;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`expected state did not arrive within ${limitMs} ms: ${JSON.stringify(readState(dir))}`);
}

export async function waitForFile(file, limitMs = 15_000) {
  const startedAt = Date.now();
  while (!fs.existsSync(file)) {
    if (Date.now() - startedAt > limitMs) throw new Error(`file did not appear: ${file}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

export const read = (dir, file) => fs.readFileSync(path.join(dir, file), 'utf8');
