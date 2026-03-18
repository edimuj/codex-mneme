import { existsSync, readFileSync } from 'node:fs';
import { projectPaths } from './paths.mjs';
import { ensureDir, writeJsonAtomic } from './fs-utils.mjs';

export function remember({ cwd = process.cwd(), type = 'note', content }) {
  const paths = projectPaths(cwd);
  ensureDir(paths.base);

  let current = [];
  if (existsSync(paths.remembered)) {
    try {
      current = JSON.parse(readFileSync(paths.remembered, 'utf8'));
      if (!Array.isArray(current)) current = [];
    } catch {
      current = [];
    }
  }

  const entry = {
    type,
    content: String(content).trim(),
    timestamp: new Date().toISOString()
  };

  if (!entry.content) {
    throw new Error('remember content must not be empty');
  }

  current.push(entry);
  writeJsonAtomic(paths.remembered, current);

  return {
    project: paths.key,
    rememberedPath: paths.remembered,
    entry
  };
}
