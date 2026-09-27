import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AGENTS } from './agents/index.mjs';
import { fileText, systemLanguage } from './i18n.mjs';
import { UserError, gitRoot, readJson, slug } from './util.mjs';

export const CONFIG_FILE = 'clodex.json';
export const BRIEF_FILE = '00-brief.md';
export const TEMPLATE_MARK = '<!-- clodex:fill-in-and-delete-this-line -->';

export const DEFAULTS = {
  topic: '',
  participants: ['claude', 'codex'],
  max_cycles: 3,
  autonomy: 'ask',
  human: 'Human',
  language: 'en',
  reporter: 'claude',
  report_review: true,
  permissions: 'read',
  project_root: null,
  turn_timeout_min: 30,
  attempts_per_turn: 2,
  notify: true,
  extra_instructions: '',
  agents: {},
};

const AGENT_DEFAULTS = { command: null, model: null, effort: null, extra_tools: [], allow: [], extra_args: [] };

export function isDebateFolder(dir) {
  return Boolean(dir) && fs.existsSync(path.join(dir, CONFIG_FILE));
}

function withDefaults(raw) {
  const cfg = { ...DEFAULTS, ...raw, agents: {} };
  for (const id of Object.keys(AGENTS)) cfg.agents[id] = { ...AGENT_DEFAULTS, ...(raw.agents?.[id] ?? {}) };
  return cfg;
}

/** Reads and validates clodex.json. Returns { dir, cfg, root, humanSlug }. */
export function loadDebate(dir) {
  const absDir = path.resolve(dir);
  const file = path.join(absDir, CONFIG_FILE);
  if (!fs.existsSync(file)) {
    throw new UserError(`No ${CONFIG_FILE} in ${absDir}. Create the debate with: clodex new <folder>`);
  }
  let raw;
  try {
    raw = readJson(file);
  } catch (error) {
    throw new UserError(`${CONFIG_FILE} is not valid JSON: ${error.message}`);
  }
  const cfg = withDefaults(raw);
  const problems = validate(cfg);
  if (problems.length) throw new UserError(`Problems in ${file}:\n  - ${problems.join('\n  - ')}`);
  const root = cfg.project_root ? path.resolve(absDir, cfg.project_root) : (gitRoot(absDir) ?? path.dirname(absDir));
  return { dir: absDir, cfg, root, humanSlug: humanSlug(cfg.human) };
}

export function validate(cfg) {
  const p = [];
  const ids = Object.keys(AGENTS);
  if (!Array.isArray(cfg.participants) || cfg.participants.length < 2) {
    p.push(`"participants" needs at least 2 AIs (available: ${ids.join(', ')})`);
  } else {
    for (const id of cfg.participants) if (!ids.includes(id)) p.push(`unknown participant "${id}" (available: ${ids.join(', ')})`);
    if (new Set(cfg.participants).size !== cfg.participants.length) p.push('"participants" has repeated names');
  }
  if (!Number.isInteger(cfg.max_cycles) || cfg.max_cycles < 1) p.push('"max_cycles" must be an integer ≥ 1');
  if (!['ask', 'decide'].includes(cfg.autonomy)) p.push('"autonomy" must be "ask" or "decide"');
  if (!['read', 'write'].includes(cfg.permissions)) p.push('"permissions" must be "read" or "write"');
  if (cfg.reporter !== null && !cfg.participants?.includes(cfg.reporter)) {
    p.push('"reporter" must be one of the participants, or null for no report');
  }
  if (!(cfg.turn_timeout_min > 0)) p.push('"turn_timeout_min" must be greater than 0');
  if (!Number.isInteger(cfg.attempts_per_turn) || cfg.attempts_per_turn < 1) p.push('"attempts_per_turn" must be an integer ≥ 1');
  if (!String(cfg.human ?? '').trim()) p.push('"human" cannot be empty');
  if (!String(cfg.language ?? '').trim()) p.push('"language" cannot be empty (e.g. "en", "pt-BR")');
  for (const [id, a] of Object.entries(cfg.agents)) {
    if (a.command !== null && typeof a.command !== 'string' && !Array.isArray(a.command)) {
      p.push(`agents.${id}.command must be text, a list, or null`);
    }
    for (const key of ['extra_tools', 'allow', 'extra_args']) {
      if (!Array.isArray(a[key])) p.push(`agents.${id}.${key} must be a list`);
    }
  }
  return p;
}

export function humanSlug(name) {
  const s = slug(name) || 'human';
  return [...Object.keys(AGENTS), 'report', 'brief'].includes(s) ? `${s}-human` : s;
}

export function checkBrief(dir) {
  const file = path.join(dir, BRIEF_FILE);
  if (!fs.existsSync(file)) {
    throw new UserError(`Missing brief: ${file}. That's where you tell the AIs what to debate.`);
  }
  if (fs.readFileSync(file, 'utf8').includes(TEMPLATE_MARK)) {
    throw new UserError(`The brief is still the blank template. Fill in ${file} and delete the line ${TEMPLATE_MARK}`);
  }
}

/** Creates a new debate folder with clodex.json and a blank brief. */
export function createDebate(dir, { topic, cycles, autonomy, human, permissions, language } = {}) {
  const absDir = path.resolve(dir);
  if (isDebateFolder(absDir)) throw new UserError(`There is already a debate in ${absDir}`);
  const cfg = {
    topic: topic || path.basename(absDir),
    participants: DEFAULTS.participants,
    max_cycles: cycles ? Number(cycles) : DEFAULTS.max_cycles,
    autonomy: autonomy || DEFAULTS.autonomy,
    human: human || process.env.CLODEX_HUMAN || osUserName(),
    language: language || process.env.CLODEX_LANGUAGE || systemLanguage(),
    reporter: DEFAULTS.reporter,
    report_review: DEFAULTS.report_review,
    permissions: permissions || DEFAULTS.permissions,
    turn_timeout_min: DEFAULTS.turn_timeout_min,
    extra_instructions: '',
  };
  const problems = validate(withDefaults(cfg));
  if (problems.length) throw new UserError(problems.join('\n'));
  fs.mkdirSync(absDir, { recursive: true });
  fs.writeFileSync(path.join(absDir, CONFIG_FILE), `${JSON.stringify(cfg, null, 2)}\n`);
  const brief = path.join(absDir, BRIEF_FILE);
  if (!fs.existsSync(brief)) fs.writeFileSync(brief, fileText(cfg.language).brief(cfg.topic, cfg.human, TEMPLATE_MARK));
  return { dir: absDir, cfg };
}

function osUserName() {
  try {
    const name = os.userInfo().username;
    return name ? name.charAt(0).toUpperCase() + name.slice(1) : 'Human';
  } catch {
    return 'Human';
  }
}
