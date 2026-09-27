#!/usr/bin/env node
// Imita a saída do `claude -p --output-format json` ou do `codex exec --json -o <arquivo>`.
// Uso: node agente-falso.mjs --como claude|codex --roteiro <arquivo.json> [args do adaptador...]
// O roteiro tem uma fila de respostas por agente: { "claude": [{ "texto": "...", "erro": "...", "demorarMs": 0 }], "codex": [...] }
import fs from 'node:fs';

const args = process.argv.slice(2);
const valor = (nome) => {
  const i = args.indexOf(nome);
  return i === -1 ? null : args[i + 1];
};
const como = valor('--como');
const roteiro = valor('--roteiro');

let prompt = '';
for await (const pedaco of process.stdin) prompt += pedaco;

const contador = `${roteiro}.${como}.contador`;
const vez = fs.existsSync(contador) ? Number(fs.readFileSync(contador, 'utf8')) : 0;
fs.writeFileSync(contador, String(vez + 1));
fs.appendFileSync(`${roteiro}.chamadas.jsonl`, `${JSON.stringify({ como, vez, args, cwd: process.cwd(), prompt })}\n`);

const fila = JSON.parse(fs.readFileSync(roteiro, 'utf8'))[como] ?? [];
const passo = fila[Math.min(vez, fila.length - 1)] ?? { texto: 'Sem roteiro.\n\nVEREDITO: CONTINUAR' };

if (passo.demorarMs) await new Promise((r) => setTimeout(r, passo.demorarMs));
if (passo.erro) {
  process.stderr.write(`${passo.erro}\n`);
  process.exit(1);
}
if (como === 'claude') {
  process.stdout.write(
    JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: passo.texto, session_id: `falso-${vez}`, total_cost_usd: 0 }),
  );
} else {
  fs.writeFileSync(valor('-o'), passo.texto);
  process.stdout.write(`${JSON.stringify({ type: 'thread.started', thread_id: `falso-${vez}` })}\n`);
  process.stdout.write(`${JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } })}\n`);
}
