import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { projectKey } from './project.mjs';

export function codexHome() {
  return process.env.CODEX_HOME ? resolve(process.env.CODEX_HOME) : join(homedir(), '.codex');
}

export function mnemeHome() {
  return process.env.CODEX_MNEME_HOME
    ? resolve(process.env.CODEX_MNEME_HOME)
    : join(homedir(), '.codex-mneme');
}

export function projectPaths(cwd) {
  const key = projectKey(cwd);
  const base = join(mnemeHome(), 'projects', key);
  return {
    key,
    base,
    state: join(base, 'state.json'),
    log: join(base, 'log.jsonl'),
    remembered: join(base, 'remembered.json')
  };
}
