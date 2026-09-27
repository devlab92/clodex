import readline from 'node:readline';

const comCor = process.stdout.isTTY && !process.env.NO_COLOR;
const tinta = (codigo) => (texto) => (comCor ? `\x1b[${codigo}m${texto}\x1b[0m` : String(texto));

export const cor = {
  negrito: tinta('1'),
  cinza: tinta('90'),
  vermelho: tinta('31'),
  verde: tinta('32'),
  amarelo: tinta('33'),
  azul: tinta('34'),
  magenta: tinta('35'),
  ciano: tinta('36'),
};

export function semCor(texto) {
  return String(texto).replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Terminal do maestro. Com teclado (TTY), cada linha digitada vai para `aoDigitar`
 * e o Ctrl+C vai para `aoInterromper`, sem matar o processo.
 * Sem teclado (saída redirecionada, testes), só escreve.
 */
export function criarConsole({ interativo, aoDigitar, aoInterromper } = {}) {
  let rl = null;
  if (interativo) {
    rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: cor.cinza('você › ') });
    rl.on('line', (linha) => {
      aoDigitar?.(linha);
      rl?.prompt();
    });
    rl.on('SIGINT', () => aoInterromper?.());
    rl.prompt();
  }
  return {
    interativo: Boolean(rl),
    escrever(texto) {
      if (rl) {
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
      }
      process.stdout.write(`${texto}\n`);
      if (rl) rl.prompt(true);
    },
    fechar() {
      if (!rl) return;
      const r = rl;
      rl = null;
      r.close();
    },
  };
}
