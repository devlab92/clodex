#!/usr/bin/env node
import { main } from '../src/cli.mjs';

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code ?? 0;
  },
  (error) => {
    console.error(error?.friendly ? `✖ ${error.message}` : error);
    process.exitCode = 1;
  },
);
