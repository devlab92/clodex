import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** Error with a message meant for the user: the CLI prints only the text, no stack trace. */
export class UserError extends Error {
  constructor(message) {
    super(message);
    this.friendly = true;
  }
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function slug(text) {
  return String(text)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function formatDuration(seconds) {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`;
}

export function hashOf(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

export function hashFile(file) {
  try {
    return hashOf(fs.readFileSync(file));
  } catch {
    return null;
  }
}

/** Writes through a temp file + rename, so readers never see a half-written file. */
export function writeAtomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, content);
  try {
    fs.renameSync(temp, file);
  } catch {
    // On Windows, rename fails while another process is reading the target.
    fs.writeFileSync(file, content);
    fs.rmSync(temp, { force: true });
  }
}

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
}

export function now() {
  return new Date().toISOString();
}

export function localDateTime(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`;
}

/** Walks up from `start` looking for a `.git` folder or file. */
export function gitRoot(start) {
  let current = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(current, '.git'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/** Text starting with @ becomes the content of that file. */
export function resolveText(text, base = process.cwd()) {
  const clean = String(text ?? '').trim();
  if (!clean.startsWith('@')) return clean;
  const file = path.resolve(base, clean.slice(1).trim().replace(/^["']|["']$/g, ''));
  if (!fs.existsSync(file)) throw new UserError(`File not found: ${file}`);
  return fs.readFileSync(file, 'utf8').trim();
}
