import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

export function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeJsonAtomic(path, value) {
  ensureDir(dirname(path));
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  renameSync(tmp, path);
  try {
    rmSync(tmp, { force: true });
  } catch {
    // no-op
  }
}

export function writeJsonlAtomic(path, entries) {
  ensureDir(dirname(path));
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  const rows = Array.isArray(entries) ? entries : [];
  const text = rows.map((entry) => JSON.stringify(entry)).join('\n');
  writeFileSync(tmp, text ? `${text}\n` : '');
  renameSync(tmp, path);
  try {
    rmSync(tmp, { force: true });
  } catch {
    // no-op
  }
}

export function readJsonl(path) {
  try {
    const text = readFileSync(path, 'utf8');
    return text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}
