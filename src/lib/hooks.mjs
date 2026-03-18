import { appendFileSync } from 'node:fs';
import { ensureDir } from './fs-utils.mjs';
import { ingestSessions } from './ingest.mjs';
import { projectPaths } from './paths.mjs';

const ENABLED_VALUES = new Set(['1', 'true', 'yes', 'on']);
const KNOWN_HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'Stop'];
const HOOK_EVENT_MAP = new Map([
  ['sessionstart', 'SessionStart'],
  ['session_start', 'SessionStart'],
  ['userpromptsubmit', 'UserPromptSubmit'],
  ['user_prompt_submit', 'UserPromptSubmit'],
  ['stop', 'Stop']
]);

function normalizeText(value) {
  return String(value || '').trim();
}

export function hooksEnabled({ env = process.env } = {}) {
  const raw = String(env.CODEX_MNEME_ENABLE_HOOKS || '').trim().toLowerCase();
  return ENABLED_VALUES.has(raw);
}

export function normalizeHookEvent(event) {
  const raw = String(event || '').trim();
  if (!raw) {
    throw new Error(`hook event is required. Expected one of: ${KNOWN_HOOK_EVENTS.join(', ')}`);
  }

  const canonical = HOOK_EVENT_MAP.get(raw.toLowerCase());
  if (!canonical) {
    throw new Error(`unknown hook event: ${raw}. Expected one of: ${KNOWN_HOOK_EVENTS.join(', ')}`);
  }
  return canonical;
}

function appendHookRecord(paths, record) {
  ensureDir(paths.base);
  appendFileSync(paths.hooks, `${JSON.stringify(record)}\n`);
}

export function handleHookEvent({
  cwd = process.cwd(),
  event,
  text = '',
  enabled = hooksEnabled(),
  ingest = ingestSessions,
  ingestOptions = {}
} = {}) {
  const hookEvent = normalizeHookEvent(event);

  if (!enabled) {
    return {
      enabled: false,
      skipped: true,
      event: hookEvent,
      reason: 'hooks_disabled'
    };
  }

  const normalizedText = normalizeText(text);
  const paths = projectPaths(cwd);
  const timestamp = new Date().toISOString();
  const hookRecord = {
    timestamp,
    event: hookEvent
  };
  if (normalizedText) {
    hookRecord.text = normalizedText;
  }
  appendHookRecord(paths, hookRecord);

  let ingestResult = null;
  if (hookEvent === 'SessionStart' || hookEvent === 'Stop') {
    ingestResult = ingest({
      cwd,
      ...ingestOptions
    });
  }

  return {
    enabled: true,
    skipped: false,
    event: hookEvent,
    hookRecord,
    ingest: ingestResult
  };
}
