/** Pure debate rules: file names, verdicts, consensus and cycles. */

export const VERDICTS = ['CONTINUE', 'CONSENSUS', 'QUESTION'];

// The protocol asks for English tokens, but an AI writing in another language sometimes translates them.
const VERDICT_ALIASES = { CONTINUAR: 'CONTINUE', CONSENSO: 'CONSENSUS', PERGUNTA: 'QUESTION' };

export function turnFileName(number, author) {
  return `${String(number).padStart(2, '0')}-${author}.md`;
}

/** Last "VERDICT: X" line of the text, tolerating bold, backticks and quotes. No verdict: null. */
export function readVerdict(text) {
  const regex = /^[\s>*_`#-]*(?:VERDICT|VEREDITO)[\s*_`]*[:：][\s*_`]*(CONTINUE|CONSENSUS|QUESTION|CONTINUAR|CONSENSO|PERGUNTA)\b/gim;
  let last = null;
  for (const match of String(text).matchAll(regex)) {
    const word = match[1].toUpperCase();
    last = VERDICT_ALIASES[word] ?? word;
  }
  return last;
}

/** Last "REVIEW: OK|CORRECTIONS". */
export function readReview(text) {
  const regex = /(?:REVIEW|CONFER[ÊE]NCIA)[\s*_`]*[:：][\s*_`]*(OK|CORRECTIONS|CORRE[ÇC][ÕO]ES)/gi;
  let last = null;
  for (const match of String(text).matchAll(regex)) last = match[1].toUpperCase() === 'OK' ? 'OK' : 'CORRECTIONS';
  return last;
}

/** Text of the "## Question(s) ..." section, up to the next heading or the verdict line. */
export function extractQuestion(text) {
  const lines = String(text).split(/\r?\n/);
  const start = lines.findIndex((l) => /^#{1,6}\s*(Questions?|Perguntas?)\b/i.test(l));
  const notVerdict = (l) => !/(VERDICT|VEREDITO)\s*[:：]/i.test(l);
  if (start === -1) return lines.filter(notVerdict).join('\n').trim().slice(-1200);
  const level = lines[start].match(/^#+/)[0].length;
  const body = [];
  for (const line of lines.slice(start + 1)) {
    const heading = line.match(/^(#+)\s/);
    if ((heading && heading[1].length <= level) || !notVerdict(line)) break;
    body.push(line);
  }
  return body.join('\n').trim();
}

export function agentTurns(turns) {
  return turns.filter((t) => t.kind === 'agent');
}

/** Consensus = the last N turns belong to the N AIs, all different, all CONSENSUS. */
export function reachedConsensus(turns, participants) {
  const n = participants.length;
  const last = turns.slice(-n);
  if (last.length < n) return false;
  return last.every((t) => t.kind === 'agent' && t.verdict === 'CONSENSUS') && new Set(last.map((t) => t.author)).size === n;
}

/** The AIs take turns in a fixed rotation, counting only AI turns. */
export function nextParticipant(turns, participants) {
  return participants[agentTurns(turns).length % participants.length];
}

export function turnLimit(cfg, state) {
  return (cfg.max_cycles + (state.extraCycles ?? 0)) * cfg.participants.length;
}

export function currentCycle(turns, participants) {
  return Math.floor(agentTurns(turns).length / participants.length) + 1;
}

export function cyclesStarted(turns, participants) {
  return Math.ceil(agentTurns(turns).length / participants.length);
}
