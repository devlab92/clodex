import claude from './claude.mjs';
import codex from './codex.mjs';

/** Available AIs. To add another one, see "Adding another AI" in docs/MANUAL.md. */
export const AGENTS = { claude, codex };

export function agentName(id) {
  return AGENTS[id]?.name ?? id;
}
