import { randomUUID } from 'node:crypto';
import { projectPaths } from './paths.mjs';
import { ensureDir, readJson, writeJsonAtomic } from './fs-utils.mjs';

export const REMEMBER_TYPES = ['note', 'decision', 'constraint', 'todo'];
const REMEMBER_TYPE_SET = new Set(REMEMBER_TYPES);

function normalizeType(type) {
  const normalized = String(type || '').trim().toLowerCase();
  if (!REMEMBER_TYPE_SET.has(normalized)) {
    throw new Error(`invalid remember type: ${type}. Expected one of: ${REMEMBER_TYPES.join(', ')}`);
  }
  return normalized;
}

function normalizeContent(content) {
  const normalized = String(content || '').trim();
  if (!normalized) {
    throw new Error('remember content must not be empty');
  }
  return normalized;
}

function normalizeId(id) {
  const normalized = String(id || '').trim();
  if (!normalized) {
    throw new Error('remember id must not be empty');
  }
  return normalized;
}

function normalizeEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const content = String(raw.content || '').trim();
  if (!content) return null;

  let type = 'note';
  try {
    type = normalizeType(raw.type || 'note');
  } catch {
    return null;
  }

  const timestamp = typeof raw.timestamp === 'string'
    ? raw.timestamp
    : (typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString());

  const entry = {
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : randomUUID(),
    type,
    content,
    timestamp
  };

  if (typeof raw.updatedAt === 'string' && raw.updatedAt) {
    entry.updatedAt = raw.updatedAt;
  }

  return entry;
}

function readRememberedEntries(paths) {
  const raw = readJson(paths.remembered, []);
  if (!Array.isArray(raw)) return { entries: [], dirty: true };

  let dirty = false;
  const entries = [];

  for (const item of raw) {
    const normalized = normalizeEntry(item);
    if (!normalized) {
      dirty = true;
      continue;
    }

    if (
      normalized.id !== item.id
      || normalized.type !== item.type
      || normalized.content !== item.content
      || normalized.timestamp !== item.timestamp
      || normalized.updatedAt !== item.updatedAt
    ) {
      dirty = true;
    }

    entries.push(normalized);
  }

  return { entries, dirty };
}

function writeRememberedEntries(paths, entries) {
  writeJsonAtomic(paths.remembered, entries);
}

function resolveEntryIndex(entries, id) {
  const needle = normalizeId(id);
  const exact = entries.findIndex((entry) => entry.id === needle);
  if (exact !== -1) return exact;

  const byPrefix = entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.id.startsWith(needle));

  if (byPrefix.length === 1) return byPrefix[0].index;
  if (byPrefix.length > 1) {
    throw new Error(`remember id prefix is ambiguous: ${needle}`);
  }
  throw new Error(`remember entry not found: ${needle}`);
}

function loadRemembered(paths) {
  const { entries, dirty } = readRememberedEntries(paths);
  if (dirty) {
    writeRememberedEntries(paths, entries);
  }
  return entries;
}

export function listRemembered({ cwd = process.cwd() } = {}) {
  const paths = projectPaths(cwd);
  ensureDir(paths.base);

  const entries = loadRemembered(paths);
  return {
    project: paths.key,
    rememberedPath: paths.remembered,
    entries
  };
}

export function remember({ cwd = process.cwd(), type = 'note', content }) {
  const paths = projectPaths(cwd);
  ensureDir(paths.base);

  const current = loadRemembered(paths);
  const now = new Date().toISOString();
  const entry = {
    id: randomUUID(),
    type: normalizeType(type),
    content: normalizeContent(content),
    timestamp: now
  };

  current.push(entry);
  writeRememberedEntries(paths, current);

  return {
    project: paths.key,
    rememberedPath: paths.remembered,
    entry
  };
}

export function editRemembered({ cwd = process.cwd(), id, type, content }) {
  const paths = projectPaths(cwd);
  ensureDir(paths.base);

  const current = loadRemembered(paths);
  const index = resolveEntryIndex(current, id);
  const existing = current[index];

  if (type === undefined && content === undefined) {
    throw new Error('edit requires content and/or --type');
  }

  const next = { ...existing };
  if (type !== undefined) {
    next.type = normalizeType(type);
  }
  if (content !== undefined) {
    next.content = normalizeContent(content);
  }
  next.updatedAt = new Date().toISOString();

  current[index] = next;
  writeRememberedEntries(paths, current);

  return {
    project: paths.key,
    rememberedPath: paths.remembered,
    entry: next
  };
}

export function forgetRemembered({ cwd = process.cwd(), id }) {
  const paths = projectPaths(cwd);
  ensureDir(paths.base);

  const current = loadRemembered(paths);
  const index = resolveEntryIndex(current, id);
  const [removed] = current.splice(index, 1);
  writeRememberedEntries(paths, current);

  return {
    project: paths.key,
    rememberedPath: paths.remembered,
    entry: removed,
    removed: 1
  };
}
