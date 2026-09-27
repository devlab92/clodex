import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { AGENTS } from './agents/index.mjs';
import { BRIEF_FILE, CONFIG_FILE, createDebate, isDebateFolder, loadDebate } from './config.mjs';
import { continueDebate, generateReport, start } from './orchestrator.mjs';
import { isRunning, readLast, readState, rememberLast, sendToInbox } from './state.mjs';
import { describeStatus } from './status.mjs';
import { color } from './terminal.mjs';
import { UserError, resolveText } from './util.mjs';

const HELP = `${color.bold('Clodex · AI interaction')}: Claude Code and Codex debate in turns, on their own, and you get a report.

${color.bold('Basics')}
  clodex new <folder> --topic "..."     creates a debate (config + blank brief)
  clodex start [folder]                 starts or resumes the debate in this terminal
  clodex status [folder]                shows where things stand

${color.bold('Taking part while it runs')} (or type straight into the orchestrator's terminal)
  clodex reply [folder] "text"          answers a question or comments (accepts @file.md)
  clodex pause [folder]                 pauses when the current turn ends
  clodex resume [folder]                continues after a pause or an error
  clodex stop [folder] [--now]          stops when the current turn ends (or right away, with --now)

${color.bold('After the end')}
  clodex continue [folder] [--more N] [--message "..."]   N more cycles (default 1)
  clodex report [folder]                generates the report now

${color.bold('Other')}
  clodex doctor                         checks that Claude and Codex were found
  clodex help

Options for "new": --topic, --cycles N, --autonomy ask|decide, --human Name, --permissions read|write, --language en|pt-BR

Without [folder], Clodex uses the current folder (if it is a debate) or the last debate used.
Guide: docs/QUICKSTART.md · Reference: docs/MANUAL.md`;

const FLAGS = new Set(['now', 'help', 'h']);

export function parseArgs(argv) {
  const positional = [];
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--') || (arg.startsWith('-') && arg.length === 2)) {
      const [key, value] = arg.replace(/^--?/, '').split(/=(.*)/s, 2);
      if (value !== undefined) options[key] = value;
      else if (!FLAGS.has(key) && i + 1 < argv.length && !argv[i + 1].startsWith('--')) options[key] = argv[++i];
      else options[key] = true;
    } else {
      positional.push(arg);
    }
  }
  return { positional, options };
}

/** Explicit folder (first argument) → current folder → last debate used. */
export function resolveFolder(positional, explicit) {
  if (explicit) {
    if (!isDebateFolder(explicit)) throw new UserError(`${path.resolve(explicit)} is not a debate folder.`);
    return path.resolve(explicit);
  }
  if (positional.length && isDebateFolder(positional[0])) return path.resolve(positional.shift());
  if (isDebateFolder(process.cwd())) return process.cwd();
  const last = readLast();
  if (last && isDebateFolder(last)) return last;
  throw new UserError("Couldn't find the debate folder. Pass its path (e.g. clodex status debates/my-debate) or run from inside it.");
}

function showTarget(dir) {
  if (path.resolve(dir) !== process.cwd()) console.log(color.gray(`→ debate: ${dir}`));
}

export async function main(argv) {
  const [command = 'help', ...rest] = argv;
  const { positional, options } = parseArgs(rest);
  if (options.help || options.h) {
    console.log(HELP);
    return 0;
  }

  switch (command) {
    case 'new': {
      const target = positional[0];
      if (!target) throw new UserError('Say where to create it: clodex new <folder> --topic "..."');
      const { dir, cfg } = createDebate(target, {
        topic: options.topic,
        cycles: options.cycles,
        autonomy: options.autonomy,
        human: options.human,
        permissions: options.permissions,
        language: options.language,
      });
      rememberLast(dir);
      console.log(`${color.green('✔')} Debate created in ${dir}`);
      console.log(`  ${color.bold('1.')} Write the brief: ${path.join(dir, BRIEF_FILE)}`);
      console.log(`  ${color.bold('2.')} Adjust if you like: ${path.join(dir, CONFIG_FILE)} (cycles: ${cfg.max_cycles}, autonomy: ${cfg.autonomy}, language: ${cfg.language})`);
      console.log(`  ${color.bold('3.')} Run: ${color.bold(`clodex start "${path.relative(process.cwd(), dir) || '.'}"`)}`);
      return 0;
    }

    case 'start': {
      await start(resolveFolder(positional, options.folder));
      return 0;
    }

    case 'resume': {
      const dir = resolveFolder(positional, options.folder);
      if (isRunning(dir)) {
        sendToInbox(dir, { type: 'resume' });
        showTarget(dir);
        console.log('Resume request delivered to the orchestrator.');
        return 0;
      }
      await start(dir);
      return 0;
    }

    case 'continue': {
      const dir = resolveFolder(positional, options.folder);
      if (isRunning(dir)) throw new UserError('The orchestrator is still running this debate. Use "clodex reply" to talk to it.');
      await continueDebate(dir, { more: options.more ?? 1, message: options.message ?? (positional.join(' ') || undefined) });
      return 0;
    }

    case 'report': {
      const dir = resolveFolder(positional, options.folder);
      if (isRunning(dir)) throw new UserError('The orchestrator is still running. Stop it first (clodex stop) or wait for the end.');
      await generateReport(dir);
      return 0;
    }

    case 'reply':
    case 'say': {
      const dir = resolveFolder(positional, options.folder);
      const text = resolveText(options.message ?? positional.join(' '));
      if (!text) throw new UserError('Write your answer: clodex reply "your answer" (or @file.md)');
      sendToInbox(dir, { type: 'say', text });
      showTarget(dir);
      if (isRunning(dir)) console.log(`${color.green('✔')} Delivered to the orchestrator.`);
      else console.log(`${color.green('✔')} Saved. The orchestrator is not running: run ${color.bold('clodex start')} to continue the debate.`);
      return 0;
    }

    case 'pause':
    case 'stop': {
      const dir = resolveFolder(positional, options.folder);
      showTarget(dir);
      if (!isRunning(dir)) {
        console.log('No orchestrator running for this debate. Nothing to do.');
        return 0;
      }
      const type = command === 'stop' && options.now ? 'stop_now' : command;
      sendToInbox(dir, { type });
      console.log(
        {
          pause: 'Request delivered: the orchestrator will pause when the current turn ends.',
          stop: 'Request delivered: the orchestrator will stop when the current turn ends.',
          stop_now: 'Request delivered: the orchestrator is interrupting the AI now.',
        }[type],
      );
      return 0;
    }

    case 'status': {
      const dir = resolveFolder(positional, options.folder);
      console.log(describeStatus(loadDebate(dir), readState(dir), { running: isRunning(dir) }));
      return 0;
    }

    case 'doctor':
      return doctor();

    case 'help':
      console.log(HELP);
      return 0;

    default:
      throw new UserError(`Unknown command: ${command}. See: clodex help`);
  }
}

function doctor() {
  let ok = true;
  const [major] = process.versions.node.split('.').map(Number);
  console.log(`${major >= 22 ? color.green('✔') : color.red('✖')} Node ${process.versions.node}${major >= 22 ? '' : ' (needs ≥ 22)'}`);
  if (major < 22) ok = false;
  for (const adapter of Object.values(AGENTS)) {
    const found = adapter.locate();
    if (!found) {
      ok = false;
      console.log(`${color.red('✖')} ${adapter.name}: not found. ${adapter.installHint}`);
      continue;
    }
    const needsShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(found.path);
    const v = spawnSync(needsShell ? `"${found.path}" --version` : found.path, needsShell ? [] : ['--version'], {
      encoding: 'utf8',
      timeout: 30_000,
      windowsHide: true,
      shell: needsShell,
    });
    const version = (v.stdout || v.stderr || '').trim().split(/\r?\n/)[0];
    if (v.status !== 0) ok = false;
    console.log(`${v.status === 0 ? color.green('✔') : color.red('✖')} ${adapter.name}: ${version || 'did not answer --version'}`);
    console.log(color.gray(`    ${found.path}  (${found.source})`));
  }
  const last = readLast();
  if (last && fs.existsSync(last)) console.log(color.gray(`Last debate used: ${last}`));
  console.log(ok ? color.green('All set.') : color.yellow('Fix the items marked ✖ before starting a debate.'));
  return ok ? 0 : 1;
}
