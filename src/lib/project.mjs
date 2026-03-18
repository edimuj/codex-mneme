import { resolve } from 'node:path';

export function projectKey(cwd) {
  const normalized = resolve(cwd)
    .replace(/\\/g, '/')
    .replace(/[^a-zA-Z0-9._/-]/g, '_')
    .replace(/\//g, '-');
  return normalized.startsWith('-') ? normalized : `-${normalized}`;
}
