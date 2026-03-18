import { appendFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { ensureDir, readJson, readJsonl, writeJsonAtomic } from './fs-utils.mjs';
import { codexHome, projectPaths } from './paths.mjs';
import { parseSessionFile } from './session-parser.mjs';

function walkJsonlFiles(rootDir) {
  const out = [];
  if (!existsSync(rootDir)) return out;

  const stack = [rootDir];
  while (stack.length) {
    const dir = stack.pop();
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, name.name);
      if (name.isDirectory()) {
        stack.push(full);
      } else if (name.isFile() && name.name.endsWith('.jsonl')) {
        out.push(full);
      }
    }
  }

  out.sort();
  return out;
}

function entryHash(entry) {
  return createHash('sha1')
    .update(`${entry.timestamp}\n${entry.role}\n${entry.text}`)
    .digest('hex');
}

export function ingestSessions({ cwd = process.cwd() } = {}) {
  const normalizedCwd = resolve(cwd);
  const paths = projectPaths(normalizedCwd);

  ensureDir(paths.base);

  const state = readJson(paths.state, { files: {} });
  const existing = readJsonl(paths.log);
  const seen = new Set(existing.map((entry) => entry.hash).filter(Boolean));

  const sessionsRoot = join(codexHome(), 'sessions');
  const files = walkJsonlFiles(sessionsRoot);

  const appended = [];
  let scanned = 0;
  let skipped = 0;

  for (const file of files) {
    const st = statSync(file);
    const key = resolve(file);
    const previous = state.files[key];
    if (previous && previous.size === st.size && previous.mtimeMs === st.mtimeMs) {
      skipped += 1;
      continue;
    }

    scanned += 1;
    const parsed = parseSessionFile(file, normalizedCwd);
    state.files[key] = {
      size: st.size,
      mtimeMs: st.mtimeMs,
      sessionCwd: parsed.sessionCwd
    };

    if (!parsed.matchesProject) continue;

    for (const entry of parsed.entries) {
      const hash = entryHash(entry);
      if (seen.has(hash)) continue;
      seen.add(hash);
      appended.push({ ...entry, hash });
    }
  }

  if (appended.length > 0) {
    const lines = appended.map((entry) => JSON.stringify(entry)).join('\n') + '\n';
    appendFileSync(paths.log, lines);
  }

  writeJsonAtomic(paths.state, state);

  return {
    project: paths.key,
    logPath: paths.log,
    statePath: paths.state,
    scanned,
    skipped,
    appended: appended.length
  };
}
