import { spawn, spawnSync } from 'node:child_process';

const WIN = process.platform === 'win32';

function quoteForCmd(arg) {
  const s = String(arg);
  return /[\s"&|<>^()%!]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Ends the process and all its children (AI tools usually spawn subprocesses). */
export function killTree(child) {
  if (!child?.pid || child.exitCode !== null) return;
  try {
    if (WIN) {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    } else {
      process.kill(-child.pid, 'SIGTERM');
      setTimeout(() => {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {}
      }, 5000).unref();
    }
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {}
  }
}

/**
 * Runs a program with no window, feeds `input` on stdin and collects the output.
 * Never rejects: the result says whether there was an error, a timeout or a cancellation.
 *
 * The child runs in its own process group (detached) so that Ctrl+C in the terminal reaches
 * only the orchestrator, which decides whether to end the AI now or let the turn finish.
 */
export function runProcess({ command, args = [], cwd, input = '', env, timeoutMs, signal }) {
  const [exe, ...preArgs] = Array.isArray(command) ? command : [command];
  const allArgs = [...preArgs, ...args];
  const start = Date.now();
  return new Promise((resolve) => {
    const needsShell = WIN && /\.(cmd|bat)$/i.test(exe);
    let child;
    try {
      child = needsShell
        ? spawn([exe, ...allArgs].map(quoteForCmd).join(' '), { cwd, env, shell: true, windowsHide: true, detached: true })
        : spawn(exe, allArgs, { cwd, env, windowsHide: true, detached: true });
    } catch (error) {
      resolve({ code: null, stdout: '', stderr: '', error, durationMs: 0 });
      return;
    }
    const out = [];
    const err = [];
    let timedOut = false;
    let cancelled = false;
    let finished = false;

    const onCancel = () => {
      cancelled = true;
      killTree(child);
    };
    const timer = timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          killTree(child);
        }, timeoutMs)
      : null;
    if (signal?.aborted) onCancel();
    else signal?.addEventListener('abort', onCancel, { once: true });

    const finish = (result) => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', onCancel);
      resolve({
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
        timedOut,
        cancelled,
        durationMs: Date.now() - start,
        ...result,
      });
    };

    child.stdout.on('data', (b) => out.push(b));
    child.stderr.on('data', (b) => err.push(b));
    child.on('error', (error) => finish({ code: null, error }));
    child.on('close', (code) => finish({ code }));
    child.stdin.on('error', () => {});
    child.stdin.end(input, 'utf8');
  });
}
