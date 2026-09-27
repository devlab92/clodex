import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  extractQuestion,
  nextParticipant,
  reachedConsensus,
  readReview,
  readVerdict,
  turnFileName,
  turnLimit,
} from '../src/transcript.mjs';

const P = ['claude', 'codex'];
const ag = (author, verdict) => ({ kind: 'agent', author, verdict });

test('turn file name has two digits and the author', () => {
  assert.equal(turnFileName(3, 'codex'), '03-codex.md');
  assert.equal(turnFileName(12, 'alex'), '12-alex.md');
});

test('reads the verdict in several formats and keeps the last one', () => {
  assert.equal(readVerdict('text\n\nVERDICT: CONTINUE'), 'CONTINUE');
  assert.equal(readVerdict('**VERDICT:** CONSENSUS'), 'CONSENSUS');
  assert.equal(readVerdict('`VERDICT: QUESTION`'), 'QUESTION');
  assert.equal(readVerdict('> verdict: consensus'), 'CONSENSUS');
  assert.equal(readVerdict('VERDICT: CONTINUE\n...\nVERDICT: CONSENSUS'), 'CONSENSUS');
  assert.equal(readVerdict('no verdict line'), null);
  assert.equal(readVerdict('a VERDICT: CONSENSUS in the middle of a sentence does not count'), null);
});

test('accepts the verdict translated by an AI writing in Portuguese', () => {
  assert.equal(readVerdict('VEREDITO: CONSENSO'), 'CONSENSUS');
  assert.equal(readVerdict('VERDICT: PERGUNTA'), 'QUESTION');
  assert.equal(readVerdict('**VEREDITO:** CONTINUAR'), 'CONTINUE');
});

test('reads the review result', () => {
  assert.equal(readReview('Accurate.\n\nREVIEW: OK'), 'OK');
  assert.equal(readReview('REVIEW: CORRECTIONS'), 'CORRECTIONS');
  assert.equal(readReview('CONFERÊNCIA: CORREÇÕES'), 'CORRECTIONS');
  assert.equal(readReview('nothing'), null);
});

test('extracts the question section', () => {
  const text = '# Position\n\nblah\n\n## Question for Alex\n\n1. A or B?\n2. Deadline?\n\nVERDICT: QUESTION';
  assert.equal(extractQuestion(text), '1. A or B?\n2. Deadline?');
  assert.equal(extractQuestion('## Pergunta para Alex\n\n1. A ou B?\n\nVEREDITO: PERGUNTA'), '1. A ou B?');
  assert.equal(extractQuestion('I need to know if X is allowed.\n\nVERDICT: QUESTION'), 'I need to know if X is allowed.');
});

test('consensus requires every AI, all different, in a row', () => {
  assert.equal(reachedConsensus([ag('claude', 'CONSENSUS')], P), false);
  assert.equal(reachedConsensus([ag('claude', 'CONSENSUS'), ag('codex', 'CONSENSUS')], P), true);
  assert.equal(reachedConsensus([ag('claude', 'CONSENSUS'), ag('codex', 'CONTINUE')], P), false);
  assert.equal(reachedConsensus([ag('claude', 'CONSENSUS'), { kind: 'human', author: 'alex' }, ag('codex', 'CONSENSUS')], P), false);
  assert.equal(reachedConsensus([ag('codex', 'CONSENSUS'), ag('codex', 'CONSENSUS')], P), false);
});

test('rotation counts only AI turns', () => {
  assert.equal(nextParticipant([], P), 'claude');
  assert.equal(nextParticipant([ag('claude', 'CONTINUE')], P), 'codex');
  assert.equal(nextParticipant([ag('claude', 'QUESTION'), { kind: 'human' }], P), 'codex');
  assert.equal(nextParticipant([ag('claude'), ag('codex')], ['codex', 'claude']), 'codex');
});

test('turn limit adds extra cycles', () => {
  assert.equal(turnLimit({ max_cycles: 3, participants: P }, {}), 6);
  assert.equal(turnLimit({ max_cycles: 3, participants: P }, { extraCycles: -1 }), 4);
});
