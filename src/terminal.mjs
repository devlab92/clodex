import readline from 'node:readline';

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (text) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : String(text));

export const color = {
  bold: paint('1'),
  gray: paint('90'),
  red: paint('31'),
  green: paint('32'),
  yellow: paint('33'),
  blue: paint('34'),
  magenta: paint('35'),
  cyan: paint('36'),
};

export function stripColor(text) {
  return String(text).replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * The orchestrator's terminal. With a keyboard (TTY), each typed line goes to `onLine`
 * and Ctrl+C goes to `onInterrupt`, without killing the process.
 * Without a keyboard (redirected output, tests), it only writes.
 */
export function createTerminal({ interactive, onLine, onInterrupt } = {}) {
  let rl = null;
  if (interactive) {
    rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: color.gray('you › ') });
    rl.on('line', (line) => {
      onLine?.(line);
      rl?.prompt();
    });
    rl.on('SIGINT', () => onInterrupt?.());
    rl.prompt();
  }
  return {
    interactive: Boolean(rl),
    write(text) {
      if (rl) {
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
      }
      process.stdout.write(`${text}\n`);
      if (rl) rl.prompt(true);
    },
    close() {
      if (!rl) return;
      const r = rl;
      rl = null;
      r.close();
    },
  };
}
