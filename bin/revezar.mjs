#!/usr/bin/env node
import { principal } from '../src/cli.mjs';

principal(process.argv.slice(2)).then(
  (codigo) => {
    process.exitCode = codigo ?? 0;
  },
  (erro) => {
    console.error(erro?.amigavel ? `✖ ${erro.message}` : erro);
    process.exitCode = 1;
  },
);
