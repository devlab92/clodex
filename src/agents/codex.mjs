import fs from 'node:fs';
import { locateCodex } from '../locate.mjs';
import { gitRoot } from '../util.mjs';

function tail(text, lines = 6) {
  return String(text ?? '').trim().split(/\r?\n/).slice(-lines).join('\n');
}

export default {
  id: 'codex',
  name: 'Codex',
  installHint: 'Install the Codex extension (openai.chatgpt) in VS Code or the CLI (npm i -g @openai/codex), or set "agents.codex.command" in clodex.json.',
  locate: locateCodex,

  /**
   * Read mode: read-only sandbox, working in the project root.
   * Write mode: workspace-write sandbox with this turn's attachments folder as the working root,
   * so Codex can only write there (it still reads the project and the AGENTS.md from the git root).
   */
  build({ command, prompt, mode, root, attachmentsDir, lastMessageFile, cfg }) {
    const cwd = mode === 'write' ? attachmentsDir : root;
    const args = [
      'exec',
      '--json',
      '--color', 'never',
      '-o', lastMessageFile,
      '-C', cwd,
      '-s', mode === 'write' ? 'workspace-write' : 'read-only',
    ];
    if (!gitRoot(cwd)) args.push('--skip-git-repo-check');
    if (cfg.model) args.push('-m', cfg.model);
    if (cfg.effort) args.push('-c', `model_reasoning_effort="${cfg.effort}"`);
    args.push(...cfg.extra_args, '-');
    return { command, args, cwd, input: prompt, lastMessageFile };
  },

  parse(res, plan) {
    if (res.error?.code === 'ENOENT') throw new Error('Codex executable not found (run: clodex doctor)');
    let text = '';
    try {
      text = fs.readFileSync(plan.lastMessageFile, 'utf8');
    } catch {}
    let session = null;
    const errors = [];
    for (const line of res.stdout.split(/\r?\n/)) {
      if (!line.startsWith('{')) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      session = event.thread_id ?? event.session_id ?? session;
      if (/error|failed/i.test(event.type ?? '')) errors.push(event.message ?? event.error?.message ?? JSON.stringify(event));
    }
    if (!text.trim() || (res.code !== 0 && errors.length)) {
      throw new Error(errors.at(-1) || tail(res.stderr) || res.error?.message || `exited with code ${res.code}`);
    }
    return { text, session };
  },
};
