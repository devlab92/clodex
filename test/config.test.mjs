import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { tempDir } from './helpers.mjs';
import { TEMPLATE_MARK, checkBrief, createDebate, humanSlug, loadDebate } from '../src/config.mjs';

test('new creates config and a blank brief, and start refuses an unfilled brief', () => {
  const dir = path.join(tempDir(), 'debate');
  createDebate(dir, { topic: 'Colors', cycles: '2', human: 'Alex', language: 'en' });
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'clodex.json'), 'utf8'));
  assert.equal(cfg.topic, 'Colors');
  assert.equal(cfg.max_cycles, 2);
  assert.equal(cfg.human, 'Alex');
  assert.equal(cfg.language, 'en');
  assert.match(fs.readFileSync(path.join(dir, '00-brief.md'), 'utf8'), /# Brief: Colors/);
  assert.throws(() => checkBrief(dir), /blank template/);
  const brief = path.join(dir, '00-brief.md');
  fs.writeFileSync(brief, fs.readFileSync(brief, 'utf8').replace(TEMPLATE_MARK, ''));
  assert.doesNotThrow(() => checkBrief(dir));
  assert.throws(() => createDebate(dir), /already a debate/);
});

test('the brief template follows the debate language', () => {
  const dir = path.join(tempDir(), 'debate');
  createDebate(dir, { topic: 'Cores', language: 'pt-BR' });
  assert.match(fs.readFileSync(path.join(dir, '00-brief.md'), 'utf8'), /# Pauta: Cores/);
});

test('validates the configuration with clear messages', () => {
  const dir = tempDir();
  const write = (cfg) => fs.writeFileSync(path.join(dir, 'clodex.json'), JSON.stringify(cfg));
  write({ participants: ['claude'], max_cycles: 0, autonomy: 'maybe', reporter: 'gemini' });
  assert.throws(() => loadDebate(dir), (error) => {
    assert.match(error.message, /at least 2/);
    assert.match(error.message, /max_cycles/);
    assert.match(error.message, /autonomy/);
    assert.match(error.message, /reporter/);
    return true;
  });
  write({ participants: ['claude', 'codex'], reporter: null });
  assert.equal(loadDebate(dir).cfg.reporter, null);
  fs.writeFileSync(path.join(dir, 'clodex.json'), '{ broken');
  assert.throws(() => loadDebate(dir), /valid JSON/);
});

test('project root: git above the folder, otherwise the parent folder, or the configured value', () => {
  const base = tempDir();
  const debate = path.join(base, 'docs', 'debate');
  fs.mkdirSync(debate, { recursive: true });
  fs.writeFileSync(path.join(debate, 'clodex.json'), '{}');
  assert.equal(loadDebate(debate).root, path.join(base, 'docs'));
  fs.mkdirSync(path.join(base, '.git'));
  assert.equal(loadDebate(debate).root, base);
  fs.writeFileSync(path.join(debate, 'clodex.json'), JSON.stringify({ project_root: '..' }));
  assert.equal(loadDebate(debate).root, path.join(base, 'docs'));
});

test("the human's name becomes a slug that never collides with the AIs", () => {
  assert.equal(humanSlug('Alex Smith'), 'alex-smith');
  assert.equal(humanSlug('João'), 'joao');
  assert.equal(humanSlug('Claude'), 'claude-human');
  assert.equal(humanSlug('Report'), 'report-human');
});
