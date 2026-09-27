import path from 'node:path';
import { agentName } from './agents/index.mjs';
import { color } from './terminal.mjs';
import { currentCycle, nextParticipant, turnLimit } from './transcript.mjs';
import { formatDuration } from './util.mjs';

const REASONS = { consensus: 'consensus between the AIs', limit: 'cycle limit', requested: 'report requested by you' };

export function verdictColor(v) {
  if (v === 'CONSENSUS') return color.green(v);
  if (v === 'QUESTION') return color.magenta(v);
  return color.blue(v ?? '—');
}

export function situation(debate, state, running) {
  const s = state;
  switch (s?.status ?? 'new') {
    case 'new':
      return { text: 'not started yet', next: 'clodex start' };
    case 'running':
      if (!running) return { text: 'interrupted midway (the orchestrator is not running)', next: 'clodex start' };
      return {
        text: s.phase === 'debate' ? `in progress (${agentName(nextParticipant(s.turns, debate.cfg.participants))}'s turn)` : 'writing the report',
        next: null,
      };
    case 'waiting_human':
      return { text: color.magenta('waiting for your answer'), next: 'clodex reply "your answer"' };
    case 'paused':
      return { text: color.yellow('paused'), next: 'clodex resume' };
    case 'error':
      return { text: color.red(`stopped on an error: ${s.error?.message ?? '?'}`), next: 'clodex resume' };
    case 'stopped':
      return { text: color.yellow('stopped at your request'), next: 'clodex start' };
    case 'done':
      return {
        text: color.green(`finished (${REASONS[s.reason] ?? s.reason ?? 'end'})`),
        next: 'clodex continue --more 1 --message "..."  (only if you want another round)',
      };
    default:
      return { text: s.status, next: null };
  }
}

export function describeStatus(debate, state, { running = false } = {}) {
  const { cfg } = debate;
  const s = state ?? { status: 'new', turns: [], phase: 'debate', extraCycles: 0 };
  const total = turnLimit(cfg, s) / cfg.participants.length;
  const sit = situation(debate, s, running);
  const lines = [
    color.bold(`Clodex · ${cfg.topic}`),
    `Folder:    ${debate.dir}`,
    `Status:    ${sit.text}`,
    `Cycle:     ${Math.min(currentCycle(s.turns, cfg.participants), total)} of ${total} · autonomy: ${cfg.autonomy} · orchestrator: ${running ? color.green('running') : 'stopped'}`,
    '',
  ];
  if (s.turns.length) {
    const pad = (text, n) => text + ' '.repeat(Math.max(1, n - text.replace(/\x1b\[[0-9;]*m/g, '').length));
    lines.push(color.gray(' Turn   Author       Verdict       Time     File'));
    for (const t of s.turns) {
      const author = t.kind === 'human' ? cfg.human : agentName(t.author);
      const verdict = t.kind === 'agent' ? verdictColor(t.verdict) : t.kind === 'report' ? color.cyan('REPORT') : color.magenta('MESSAGE');
      lines.push(
        ` ${pad(String(t.n).padStart(2, '0'), 7)}${pad(author, 13)}${pad(verdict, 14)}${pad(t.durationS ? formatDuration(t.durationS) : '', 9)}${color.gray(t.file)}`,
      );
    }
    lines.push('');
  }
  if (s.status === 'waiting_human' && s.question) {
    lines.push(color.magenta(`Question from ${agentName(s.question.author)} (turn ${s.question.turn}):`));
    for (const l of s.question.text.split('\n')) lines.push(`  ${l}`);
    lines.push('');
  }
  const report = [...s.turns].reverse().find((t) => t.kind === 'report');
  if (report) lines.push(`Latest report: ${path.join(debate.dir, report.file)}`);
  if (sit.next) lines.push(`Next step: ${color.bold(sit.next)}`);
  return lines.join('\n');
}
