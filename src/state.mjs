import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { UserError, now, readJson, writeAtomic } from './util.mjs';

/**
 * Everything machine-related lives in <debate folder>/.clodex/, which git-ignores itself:
 *   state.json   where the debate stands (source of truth for resuming)
 *   lock.json    prevents two orchestrators on the same debate
 *   inbox/       commands and messages sent from another terminal
 *   prompts/     the exact text given to each AI
 *   outputs/     raw output of each run (for troubleshooting)
 *   log.txt      what was shown in the terminal
 */
export function internalDir(debateDir) {
  const dir = path.join(debateDir, '.clodex');
  fs.mkdirSync(dir, { recursive: true });
  const ignore = path.join(dir, '.gitignore');
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, '*\n');
  return dir;
}

export function initialState(cfg) {
  return {
    version: 1,
    topic: cfg.topic,
    status: 'new',
    phase: 'debate',
    reason: null,
    extraCycles: 0,
    roundStart: 0,
    turns: [],
    question: null,
    error: null,
    currentReport: null,
    createdAt: now(),
    updatedAt: now(),
  };
}

export function readState(debateDir) {
  const file = path.join(debateDir, '.clodex', 'state.json');
  if (!fs.existsSync(file)) return null;
  try {
    return readJson(file);
  } catch (error) {
    throw new UserError(`${file} is corrupted (${error.message}). Rename it to restart the debate.`);
  }
}

export function saveState(debateDir, state) {
  state.updatedAt = now();
  writeAtomic(path.join(internalDir(debateDir), 'state.json'), `${JSON.stringify(state, null, 2)}\n`);
}

// ---------- lock ----------

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

export function readLock(debateDir) {
  try {
    const lock = readJson(path.join(debateDir, '.clodex', 'lock.json'));
    return lock.host === os.hostname() && !isAlive(lock.pid) ? null : lock;
  } catch {
    return null;
  }
}

export function isRunning(debateDir) {
  return readLock(debateDir) !== null;
}

export function acquireLock(debateDir) {
  const file = path.join(internalDir(debateDir), 'lock.json');
  const content = JSON.stringify({ pid: process.pid, host: os.hostname(), since: now() });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(file, content, { flag: 'wx' });
      return file;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const current = readLock(debateDir);
      if (current) {
        throw new UserError(
          `An orchestrator is already running this debate (process ${current.pid} on ${current.host}, since ${current.since}). ` +
            'Use "clodex status" to check, or "clodex stop" to end it.',
        );
      }
      fs.rmSync(file, { force: true }); // stale lock from an orchestrator that died
    }
  }
  throw new UserError('Could not lock the debate. Try again.');
}

export function releaseLock(debateDir) {
  const file = path.join(debateDir, '.clodex', 'lock.json');
  try {
    if (readJson(file).pid === process.pid) fs.rmSync(file, { force: true });
  } catch {}
}

// ---------- inbox (commands coming from another terminal) ----------

export const MESSAGE_TYPES = ['say', 'stop', 'stop_now', 'pause', 'resume'];

export function sendToInbox(debateDir, message) {
  if (!MESSAGE_TYPES.includes(message.type)) throw new Error(`invalid message type: ${message.type}`);
  const inbox = path.join(internalDir(debateDir), 'inbox');
  fs.mkdirSync(inbox, { recursive: true });
  const name = `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}.json`;
  writeAtomic(path.join(inbox, name), JSON.stringify({ ...message, sentAt: now() }));
}

/** Reads and deletes pending messages, in arrival order. */
export function drainInbox(debateDir) {
  const inbox = path.join(debateDir, '.clodex', 'inbox');
  let names = [];
  try {
    names = fs.readdirSync(inbox).filter((n) => n.endsWith('.json')).sort();
  } catch {
    return [];
  }
  const messages = [];
  for (const name of names) {
    const file = path.join(inbox, name);
    try {
      messages.push(readJson(file));
      fs.rmSync(file, { force: true });
    } catch {}
  }
  return messages;
}

// ---------- last debate used (so commands work from any folder) ----------

function lastFile() {
  return path.join(process.env.CLODEX_HOME ?? path.join(os.homedir(), '.clodex'), 'last.json');
}

export function rememberLast(debateDir) {
  try {
    writeAtomic(lastFile(), JSON.stringify({ dir: debateDir, at: now() }));
  } catch {}
}

export function readLast() {
  try {
    return readJson(lastFile()).dir;
  } catch {
    return null;
  }
}
