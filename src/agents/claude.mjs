import path from 'node:path';
import { locateClaude } from '../locate.mjs';

/**
 * Converts an absolute path into Claude Code's permission-rule format:
 * `//` + POSIX path (on Windows, C:\x becomes //c/x), with gitignore wildcards escaped.
 */
export function absolutePattern(file, platform = process.platform) {
  let p = platform === 'win32' ? path.win32.resolve(file) : path.posix.resolve(file);
  if (platform === 'win32') {
    p = p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`);
  }
  return `/${p.replace(/[[\]*?]/g, '\\$&')}`;
}

/**
 * Variables a Claude Code session passes to its child processes to link them to itself.
 * If the orchestrator is launched from inside Claude Code, the debating AIs must still start
 * as independent sessions, just like from a plain terminal.
 */
const SESSION_VARIABLES = [
  'CLAUDECODE',
  'CLAUDE_PID',
  'CLAUDE_EFFORT',
  'CLAUDE_AGENT_SDK_VERSION',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING',
  'CLAUDE_CODE_ENABLE_TASKS',
];

export function independentEnv(base = process.env) {
  const env = { ...base };
  for (const name of SESSION_VARIABLES) delete env[name];
  return env;
}

function extractResult(stdout) {
  const text = stdout.trim();
  try {
    return JSON.parse(text);
  } catch {}
  for (const line of text.split(/\r?\n/).reverse()) {
    if (!line.startsWith('{')) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.type === 'result') return obj;
    } catch {}
  }
  return null;
}

function tail(text, lines = 6) {
  return String(text ?? '').trim().split(/\r?\n/).slice(-lines).join('\n');
}

export default {
  id: 'claude',
  name: 'Claude',
  installHint: 'Install the Claude Code extension in VS Code or the CLI (https://code.claude.com), or set "agents.claude.command" in clodex.json.',
  locate: locateClaude,

  /**
   * Read mode: only Read/Glob/Grep, inside the project root.
   * Write mode: also Edit/Write, allowed only in this turn's attachments folder.
   * `dontAsk` denies on its own anything that would need approval, since nobody is watching.
   * `extra_tools` only makes a tool available (actions that need approval stay denied);
   * `allow` pre-approves explicit rules, such as "WebFetch".
   */
  build({ command, prompt, mode, root, attachmentsDir, cfg, label }) {
    const tools = ['Read', 'Glob', 'Grep', ...cfg.extra_tools];
    const allowed = [...cfg.allow];
    if (mode === 'write') {
      tools.push('Edit', 'Write');
      allowed.push(`Edit(${absolutePattern(attachmentsDir)}/**)`);
    }
    const args = [
      '-p',
      '--output-format', 'json',
      '--permission-mode', 'dontAsk',
      '--tools', [...new Set(tools)].join(','),
      '--strict-mcp-config',
      '--name', `clodex · ${label}`,
    ];
    if (allowed.length) args.push('--allowedTools', ...allowed);
    if (cfg.model) args.push('--model', cfg.model);
    if (cfg.effort) args.push('--effort', cfg.effort);
    args.push(...cfg.extra_args);
    return { command, args, cwd: root, input: prompt, env: independentEnv() };
  },

  parse(res) {
    if (res.error?.code === 'ENOENT') throw new Error('Claude executable not found (run: clodex doctor)');
    const r = extractResult(res.stdout);
    if (!r) throw new Error(tail(res.stderr) || tail(res.stdout) || res.error?.message || `exited with code ${res.code}`);
    if (r.is_error || (r.subtype && r.subtype !== 'success')) throw new Error(`Claude returned an error: ${r.result || r.subtype}`);
    return { text: r.result ?? '', session: r.session_id ?? null, costUsd: r.total_cost_usd ?? null };
  },
};
