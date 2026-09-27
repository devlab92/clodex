#!/usr/bin/env node
// Imitates the output of `claude -p --output-format json` or `codex exec --json -o <file>`.
// Usage: node fake-agent.mjs --as claude|codex --script <file.json> [adapter args...]
// The script holds a queue of answers per agent: { "claude": [{ "text": "...", "error": "...", "delayMs": 0 }], "codex": [...] }
import fs from 'node:fs';

const args = process.argv.slice(2);
const valueOf = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1];
};
const as = valueOf('--as');
const script = valueOf('--script');

let prompt = '';
for await (const chunk of process.stdin) prompt += chunk;

const counter = `${script}.${as}.counter`;
const call = fs.existsSync(counter) ? Number(fs.readFileSync(counter, 'utf8')) : 0;
fs.writeFileSync(counter, String(call + 1));
fs.appendFileSync(`${script}.calls.jsonl`, `${JSON.stringify({ as, call, args, cwd: process.cwd(), prompt })}\n`);

const queue = JSON.parse(fs.readFileSync(script, 'utf8'))[as] ?? [];
const step = queue[Math.min(call, queue.length - 1)] ?? { text: 'No script.\n\nVERDICT: CONTINUE' };

if (step.delayMs) await new Promise((r) => setTimeout(r, step.delayMs));
if (step.error) {
  process.stderr.write(`${step.error}\n`);
  process.exit(1);
}
if (as === 'claude') {
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: step.text, session_id: `fake-${call}`, total_cost_usd: 0 }));
} else {
  fs.writeFileSync(valueOf('-o'), step.text);
  process.stdout.write(`${JSON.stringify({ type: 'thread.started', thread_id: `fake-${call}` })}\n`);
  process.stdout.write(`${JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } })}\n`);
}
