import { appendFileSync } from 'node:fs';
import { ensureDir } from './fs-utils.mjs';
import { ingestSessions } from './ingest.mjs';
import { projectPaths } from './paths.mjs';

const ENABLED_VALUES = new Set(['1', 'true', 'yes', 'on']);
const HOOK_SCHEMA_VERSION = 1;
const KNOWN_HOOK_EVENTS = ['SessionStart', 'PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Stop'];
export const SUPPORTED_HOOK_EVENTS = Object.freeze([...KNOWN_HOOK_EVENTS]);
export const DEFAULT_HOOK_POLICIES = Object.freeze({
  SessionStart: Object.freeze({ ingest: true }),
  PreToolUse: Object.freeze({ ingest: false }),
  PostToolUse: Object.freeze({ ingest: false }),
  UserPromptSubmit: Object.freeze({ ingest: false }),
  Stop: Object.freeze({ ingest: true })
});
const HOOK_EVENT_MAP = new Map([
  ['sessionstart', 'SessionStart'],
  ['session_start', 'SessionStart'],
  ['pretooluse', 'PreToolUse'],
  ['pre_tool_use', 'PreToolUse'],
  ['posttooluse', 'PostToolUse'],
  ['post_tool_use', 'PostToolUse'],
  ['userpromptsubmit', 'UserPromptSubmit'],
  ['user_prompt_submit', 'UserPromptSubmit'],
  ['stop', 'Stop']
]);

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeHookInput(hookInput) {
  if (!hookInput || typeof hookInput !== 'object' || Array.isArray(hookInput)) {
    return {};
  }
  return hookInput;
}

function pickFirstString(obj, keys) {
  for (const key of keys) {
    if (!Object.hasOwn(obj, key)) continue;
    const value = normalizeText(obj[key]);
    if (value) return value;
  }
  return '';
}

function extractHookMetadata(hookInput) {
  const payload = normalizeHookInput(hookInput);
  const sessionId = pickFirstString(payload, ['session_id', 'sessionId']);
  const turnId = pickFirstString(payload, ['turn_id', 'turnId']);
  const toolUseId = pickFirstString(payload, ['tool_use_id', 'toolUseId']);
  const toolName = pickFirstString(payload, ['tool_name', 'toolName']);
  const source = pickFirstString(payload, ['source']);

  const out = {};
  if (sessionId) out.sessionId = sessionId;
  if (turnId) out.turnId = turnId;
  if (toolUseId) out.toolUseId = toolUseId;
  if (toolName) out.toolName = toolName;
  if (source) out.source = source;
  if (sessionId && turnId) {
    out.turnKey = `${sessionId}:${turnId}`;
  }
  return out;
}

function textFromHookInput(hookInput) {
  const payload = normalizeHookInput(hookInput);
  const direct = pickFirstString(payload, ['prompt', 'last_assistant_message']);
  if (direct) return direct;

  const toolInput = payload.tool_input;
  if (toolInput && typeof toolInput === 'object' && !Array.isArray(toolInput)) {
    return pickFirstString(toolInput, ['command']);
  }

  return '';
}

function cloneDefaultPolicies() {
  const out = {};
  for (const event of KNOWN_HOOK_EVENTS) {
    out[event] = { ...DEFAULT_HOOK_POLICIES[event] };
  }
  return out;
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

function normalizeHookPolicyOverride(policies) {
  const out = {};
  if (!policies || typeof policies !== 'object') {
    return out;
  }

  for (const [eventName, rawPolicy] of Object.entries(policies)) {
    const event = normalizeHookEvent(eventName);
    if (!rawPolicy || typeof rawPolicy !== 'object') {
      throw new Error(`invalid hook policy for ${event}: expected object`);
    }

    const policy = {};
    if (Object.hasOwn(rawPolicy, 'ingest')) {
      policy.ingest = Boolean(rawPolicy.ingest);
    }
    out[event] = policy;
  }

  return out;
}

function readHookPolicyOverridesFromEnv(env = process.env) {
  const raw = String(env?.CODEX_MNEME_HOOK_POLICIES || '').trim();
  if (!raw) return {};

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`invalid CODEX_MNEME_HOOK_POLICIES JSON: ${error?.message || 'parse error'}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('invalid CODEX_MNEME_HOOK_POLICIES JSON: expected object');
  }

  return normalizeHookPolicyOverride(parsed);
}

export function resolveHookPolicies({
  policies = {},
  env = process.env
} = {}) {
  const merged = cloneDefaultPolicies();
  const envOverrides = readHookPolicyOverridesFromEnv(env);
  const directOverrides = normalizeHookPolicyOverride(policies);

  for (const [event, override] of Object.entries(envOverrides)) {
    merged[event] = { ...merged[event], ...override };
  }

  for (const [event, override] of Object.entries(directOverrides)) {
    merged[event] = { ...merged[event], ...override };
  }

  return merged;
}

function appendHookRecord(paths, record) {
  ensureDir(paths.base);
  appendFileSync(paths.hooks, `${JSON.stringify(record)}\n`);
}

export function handleHookEvent({
  cwd = process.cwd(),
  event,
  text = '',
  hookInput = null,
  enabled = hooksEnabled(),
  env = process.env,
  policies = {},
  ingest = ingestSessions,
  ingestOptions = {}
} = {}) {
  const rawEvent = String(event || '').trim();
  const hookEvent = normalizeHookEvent(rawEvent);
  const hookPolicies = resolveHookPolicies({ policies, env });
  const eventPolicy = hookPolicies[hookEvent] || { ingest: false };

  if (!enabled) {
    return {
      enabled: false,
      skipped: true,
      event: hookEvent,
      reason: 'hooks_disabled'
    };
  }

  const normalizedText = normalizeText(text) || textFromHookInput(hookInput);
  const metadata = extractHookMetadata(hookInput);
  const paths = projectPaths(cwd);
  const timestamp = new Date().toISOString();
  const hookRecord = {
    schemaVersion: HOOK_SCHEMA_VERSION,
    timestamp,
    event: hookEvent
  };
  if (rawEvent && rawEvent !== hookEvent) {
    hookRecord.rawEvent = rawEvent;
  }
  if (normalizedText) {
    hookRecord.text = normalizedText;
  }
  Object.assign(hookRecord, metadata);
  appendHookRecord(paths, hookRecord);

  let ingestResult = null;
  if (eventPolicy.ingest) {
    ingestResult = ingest({
      cwd,
      ...ingestOptions
    });
  }

  return {
    enabled: true,
    skipped: false,
    event: hookEvent,
    policy: eventPolicy,
    hookRecord,
    ingest: ingestResult
  };
}
