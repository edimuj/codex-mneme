import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { ensureDir, readJson, readJsonl, writeJsonAtomic, writeJsonlAtomic } from './fs-utils.mjs';
import { codexHome, projectPaths } from './paths.mjs';
import { parseSessionFile } from './session-parser.mjs';

const DEFAULT_MAX_FILES_PER_RUN = 200;
const DEFAULT_MAX_KNOWN_FILE_STATS = 400;
const DEFAULT_HOT_FILE_COUNT = 32;
const MAX_PENDING_FILES = 5000;

function entryHash(entry) {
  const sourceFile = typeof entry?.sourceFile === 'string' ? entry.sourceFile : '';
  const timestamp = typeof entry?.timestamp === 'string' ? entry.timestamp : '';
  const role = typeof entry?.role === 'string' ? entry.role : '';
  const text = typeof entry?.text === 'string' ? entry.text : '';
  return createHash('sha1')
    .update(`${sourceFile}\n${timestamp}\n${role}\n${text}`)
    .digest('hex');
}

function normalizeLogEntry(rawEntry) {
  if (!rawEntry || typeof rawEntry !== 'object') return null;

  const role = rawEntry.role === 'user' || rawEntry.role === 'assistant'
    ? rawEntry.role
    : null;
  if (!role) return null;

  const text = String(rawEntry.text || '').trim();
  if (!text) return null;

  return {
    timestamp: typeof rawEntry.timestamp === 'string' ? rawEntry.timestamp : '',
    role,
    text,
    sourceFile: typeof rawEntry.sourceFile === 'string' ? rawEntry.sourceFile : ''
  };
}

function compactLogEntries(rawEntries) {
  const rows = Array.isArray(rawEntries) ? rawEntries : [];
  const compacted = [];
  const seen = new Set();
  let dirty = false;

  for (const rawEntry of rows) {
    const normalized = normalizeLogEntry(rawEntry);
    if (!normalized) {
      dirty = true;
      continue;
    }

    const hash = entryHash(normalized);
    if (seen.has(hash)) {
      dirty = true;
      continue;
    }
    seen.add(hash);

    if (
      rawEntry.hash !== hash
      || rawEntry.timestamp !== normalized.timestamp
      || rawEntry.role !== normalized.role
      || rawEntry.text !== normalized.text
      || rawEntry.sourceFile !== normalized.sourceFile
    ) {
      dirty = true;
    }

    compacted.push({ ...normalized, hash });
  }

  return { entries: compacted, seen, dirty };
}

function normalizeDirEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const mtimeMs = typeof entry.mtimeMs === 'number' ? entry.mtimeMs : -1;
  const subdirs = Array.isArray(entry.subdirs) ? entry.subdirs.filter((item) => typeof item === 'string') : [];
  const jsonlFiles = Array.isArray(entry.jsonlFiles) ? entry.jsonlFiles.filter((item) => typeof item === 'string') : [];
  return { mtimeMs, subdirs, jsonlFiles };
}

function normalizeState(rawState) {
  const state = rawState && typeof rawState === 'object' ? { ...rawState } : {};
  state.files = state.files && typeof state.files === 'object' && !Array.isArray(state.files) ? { ...state.files } : {};
  state.dirs = state.dirs && typeof state.dirs === 'object' && !Array.isArray(state.dirs) ? { ...state.dirs } : {};
  state.pendingFiles = Array.isArray(state.pendingFiles) ? state.pendingFiles.filter((item) => typeof item === 'string') : [];
  state.knownFileCursor = Number.isInteger(state.knownFileCursor) && state.knownFileCursor >= 0 ? state.knownFileCursor : 0;
  return state;
}

function inspectKnownDirectories(rootDir, previousDirs) {
  if (!existsSync(rootDir)) {
    return {
      nextDirs: {},
      discoveredFiles: [],
      removedFiles: [],
      dirsVisited: 0,
      dirsChanged: 0
    };
  }

  const nextDirs = {};
  const discoveredFiles = [];
  const removedFiles = [];
  const stack = [rootDir];
  const seen = new Set();
  let dirsVisited = 0;
  let dirsChanged = 0;

  while (stack.length > 0) {
    const dir = stack.pop();
    if (seen.has(dir)) continue;
    seen.add(dir);

    let st;
    try {
      st = statSync(dir);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;

    dirsVisited += 1;
    const previous = normalizeDirEntry(previousDirs[dir]);
    if (previous && previous.mtimeMs === st.mtimeMs) {
      nextDirs[dir] = previous;
      for (const childDir of previous.subdirs) {
        stack.push(childDir);
      }
      continue;
    }

    dirsChanged += 1;

    const subdirs = [];
    const jsonlFiles = [];
    let entries = [];

    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      entries = [];
    }

    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        subdirs.push(full);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        jsonlFiles.push(full);
      }
    }

    subdirs.sort();
    jsonlFiles.sort();
    nextDirs[dir] = {
      mtimeMs: st.mtimeMs,
      subdirs,
      jsonlFiles
    };

    if (previous) {
      const currentFiles = new Set(jsonlFiles);
      for (const oldFile of previous.jsonlFiles) {
        if (!currentFiles.has(oldFile)) {
          removedFiles.push(oldFile);
        }
      }
    }

    for (const file of jsonlFiles) {
      discoveredFiles.push(file);
    }
    for (const childDir of subdirs) {
      stack.push(childDir);
    }
  }

  return {
    nextDirs,
    discoveredFiles,
    removedFiles,
    dirsVisited,
    dirsChanged
  };
}

function selectKnownFilesForStat(filesState, {
  cursor = 0,
  maxKnownFileStats = DEFAULT_MAX_KNOWN_FILE_STATS,
  hotFileCount = DEFAULT_HOT_FILE_COUNT
} = {}) {
  const entries = Object.entries(filesState)
    .map(([path, metadata]) => ({
      path,
      mtimeMs: Number(metadata?.mtimeMs) || 0
    }))
    .sort((a, b) => {
      const byMtime = b.mtimeMs - a.mtimeMs;
      if (byMtime !== 0) return byMtime;
      return a.path.localeCompare(b.path);
    });

  if (entries.length === 0 || maxKnownFileStats <= 0) {
    return { paths: [], nextCursor: 0 };
  }

  const hot = entries.slice(0, Math.min(hotFileCount, entries.length)).map((item) => item.path);
  if (maxKnownFileStats <= hot.length) {
    return {
      paths: hot.slice(0, maxKnownFileStats),
      nextCursor: cursor
    };
  }

  const hotSet = new Set(hot);
  const pool = entries.map((item) => item.path).filter((path) => !hotSet.has(path));
  const budget = Math.min(maxKnownFileStats - hot.length, pool.length);
  if (pool.length === 0 || budget === 0) {
    return { paths: hot, nextCursor: 0 };
  }

  const rotating = [];
  const start = cursor % pool.length;
  for (let i = 0; i < budget; i += 1) {
    rotating.push(pool[(start + i) % pool.length]);
  }

  return {
    paths: hot.concat(rotating),
    nextCursor: (start + budget) % pool.length
  };
}

function sanitizePositiveInt(value, fallback) {
  const numeric = Number.parseInt(value, 10);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return numeric;
}

export function ingestSessions({
  cwd = process.cwd(),
  sessionsRoot = join(codexHome(), 'sessions'),
  maxFilesPerRun = DEFAULT_MAX_FILES_PER_RUN,
  maxKnownFileStats = DEFAULT_MAX_KNOWN_FILE_STATS,
  hotFileCount = DEFAULT_HOT_FILE_COUNT
} = {}) {
  const normalizedCwd = resolve(cwd);
  const paths = projectPaths(normalizedCwd);
  ensureDir(paths.base);

  const state = normalizeState(readJson(paths.state, { files: {} }));
  const compactedLog = compactLogEntries(readJsonl(paths.log));
  const existing = compactedLog.entries;
  const seen = compactedLog.seen;

  const discovery = inspectKnownDirectories(resolve(sessionsRoot), state.dirs);
  state.dirs = discovery.nextDirs;

  const removedSet = new Set(discovery.removedFiles.map((path) => resolve(path)));
  for (const removedFile of removedSet) {
    delete state.files[removedFile];
  }

  const normalizedPending = [];
  const pendingSeen = new Set();
  for (const pending of state.pendingFiles) {
    const full = resolve(pending);
    if (removedSet.has(full)) continue;
    if (pendingSeen.has(full)) continue;
    pendingSeen.add(full);
    normalizedPending.push(full);
  }
  state.pendingFiles = normalizedPending;

  const maxKnownStats = sanitizePositiveInt(maxKnownFileStats, DEFAULT_MAX_KNOWN_FILE_STATS);
  const hotCount = sanitizePositiveInt(hotFileCount, DEFAULT_HOT_FILE_COUNT);
  const selectedKnownFiles = selectKnownFilesForStat(state.files, {
    cursor: state.knownFileCursor,
    maxKnownFileStats: maxKnownStats,
    hotFileCount: hotCount
  });
  state.knownFileCursor = selectedKnownFiles.nextCursor;

  const candidatePriority = new Map();
  let skipped = 0;
  let knownFilesChecked = 0;
  let discoveredFilesChecked = 0;

  const queueCandidate = (filePath, mtimeMs) => {
    const current = candidatePriority.get(filePath);
    if (typeof current === 'number' && current >= mtimeMs) return;
    candidatePriority.set(filePath, mtimeMs);
  };

  const inspectPath = (filePath) => {
    let st;
    try {
      st = statSync(filePath);
    } catch {
      delete state.files[filePath];
      return;
    }
    if (!st.isFile()) return;

    const previous = state.files[filePath];
    if (previous && previous.size === st.size && previous.mtimeMs === st.mtimeMs) {
      skipped += 1;
      return;
    }

    queueCandidate(filePath, st.mtimeMs);
  };

  const discoveredSet = new Set();
  for (const discoveredFile of discovery.discoveredFiles) {
    const full = resolve(discoveredFile);
    discoveredSet.add(full);
    discoveredFilesChecked += 1;
    inspectPath(full);
  }

  for (const knownFile of selectedKnownFiles.paths) {
    const full = resolve(knownFile);
    if (discoveredSet.has(full)) continue;
    knownFilesChecked += 1;
    inspectPath(full);
  }

  const queue = [];
  const queued = new Set();
  for (const pendingFile of state.pendingFiles) {
    if (queued.has(pendingFile)) continue;
    queued.add(pendingFile);
    queue.push(pendingFile);
  }

  const freshCandidates = [...candidatePriority.entries()]
    .map(([path, mtimeMs]) => ({ path, mtimeMs }))
    .filter((item) => !queued.has(item.path))
    .sort((a, b) => {
      const byTime = b.mtimeMs - a.mtimeMs;
      if (byTime !== 0) return byTime;
      return a.path.localeCompare(b.path);
    });

  for (const item of freshCandidates) {
    queue.push(item.path);
  }

  const maxFiles = sanitizePositiveInt(maxFilesPerRun, DEFAULT_MAX_FILES_PER_RUN);
  const toProcess = queue.slice(0, maxFiles);
  const deferred = queue.slice(maxFiles);

  const appended = [];
  let scanned = 0;

  for (const file of toProcess) {
    let st;
    try {
      st = statSync(file);
    } catch {
      delete state.files[file];
      continue;
    }
    if (!st.isFile()) continue;

    scanned += 1;
    const parsed = parseSessionFile(file, normalizedCwd);
    state.files[file] = {
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

  state.pendingFiles = deferred.slice(0, MAX_PENDING_FILES);

  if (compactedLog.dirty || appended.length > 0) {
    writeJsonlAtomic(paths.log, existing.concat(appended));
  }

  writeJsonAtomic(paths.state, state);

  return {
    project: paths.key,
    logPath: paths.log,
    statePath: paths.state,
    scanned,
    skipped,
    appended: appended.length,
    deferred: state.pendingFiles.length,
    dirsVisited: discovery.dirsVisited,
    dirsChanged: discovery.dirsChanged,
    knownFilesChecked,
    discoveredFilesChecked
  };
}
