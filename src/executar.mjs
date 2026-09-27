import { spawn, spawnSync } from 'node:child_process';

const WIN = process.platform === 'win32';

function citarParaCmd(arg) {
  const s = String(arg);
  return /[\s"&|<>^()%!]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Encerra o processo e todos os filhos dele (a IA costuma abrir subprocessos). */
export function matarArvore(filho) {
  if (!filho?.pid || filho.exitCode !== null) return;
  try {
    if (WIN) {
      spawnSync('taskkill', ['/PID', String(filho.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    } else {
      process.kill(-filho.pid, 'SIGTERM');
      setTimeout(() => {
        try {
          process.kill(-filho.pid, 'SIGKILL');
        } catch {}
      }, 5000).unref();
    }
  } catch {
    try {
      filho.kill('SIGKILL');
    } catch {}
  }
}

/**
 * Roda um programa sem janela, entrega `entrada` pela entrada padrão e junta a saída.
 * Nunca rejeita: o resultado diz se houve erro, tempo esgotado ou cancelamento.
 *
 * O filho roda em grupo próprio (detached) para que o Ctrl+C do terminal chegue só ao
 * maestro, que decide se encerra a IA agora ou espera o turno terminar.
 */
export function executarProcesso({ comando, args = [], cwd, entrada = '', env, tempoMaxMs, sinal }) {
  const [exe, ...preArgs] = Array.isArray(comando) ? comando : [comando];
  const todos = [...preArgs, ...args];
  const inicio = Date.now();
  return new Promise((resolver) => {
    const precisaShell = WIN && /\.(cmd|bat)$/i.test(exe);
    let filho;
    try {
      filho = precisaShell
        ? spawn([exe, ...todos].map(citarParaCmd).join(' '), { cwd, env, shell: true, windowsHide: true, detached: true })
        : spawn(exe, todos, { cwd, env, windowsHide: true, detached: true });
    } catch (erro) {
      resolver({ codigo: null, stdout: '', stderr: '', erro, duracaoMs: 0 });
      return;
    }
    const saida = [];
    const erros = [];
    let tempoEsgotado = false;
    let cancelado = false;
    let terminou = false;

    const aoCancelar = () => {
      cancelado = true;
      matarArvore(filho);
    };
    const relogio = tempoMaxMs
      ? setTimeout(() => {
          tempoEsgotado = true;
          matarArvore(filho);
        }, tempoMaxMs)
      : null;
    if (sinal?.aborted) aoCancelar();
    else sinal?.addEventListener('abort', aoCancelar, { once: true });

    const concluir = (resultado) => {
      if (terminou) return;
      terminou = true;
      if (relogio) clearTimeout(relogio);
      sinal?.removeEventListener('abort', aoCancelar);
      resolver({
        stdout: Buffer.concat(saida).toString('utf8'),
        stderr: Buffer.concat(erros).toString('utf8'),
        tempoEsgotado,
        cancelado,
        duracaoMs: Date.now() - inicio,
        ...resultado,
      });
    };

    filho.stdout.on('data', (b) => saida.push(b));
    filho.stderr.on('data', (b) => erros.push(b));
    filho.on('error', (erro) => concluir({ codigo: null, erro }));
    filho.on('close', (codigo) => concluir({ codigo }));
    filho.stdin.on('error', () => {});
    filho.stdin.end(entrada, 'utf8');
  });
}
