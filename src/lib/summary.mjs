import { buildRecentHookTurns, buildRecentTurns } from './turns.mjs';

function summarizeText(text, max) {
  const oneLine = String(text || '').replace(/\s+/g, ' ').trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max - 1)}…`;
}

function pickIndices(length, count) {
  if (length <= 0 || count <= 0) return [];
  if (count === 1) return [0];

  const out = [];
  const seen = new Set();
  for (let i = 0; i < count; i += 1) {
    const idx = Math.round((i * (length - 1)) / (count - 1));
    if (seen.has(idx)) continue;
    seen.add(idx);
    out.push(idx);
  }
  return out;
}

function formatDate(timestamp) {
  if (typeof timestamp !== 'string' || timestamp.length < 10) return '';
  return timestamp.slice(0, 10);
}

function toEpochMs(timestamp) {
  const ms = Date.parse(timestamp);
  if (Number.isNaN(ms)) return Number.MAX_SAFE_INTEGER;
  return ms;
}

function renderItem(turn) {
  const date = formatDate(turn.timestamp);
  const user = summarizeText(turn.user, 120);
  const assistant = summarizeText(turn.assistant.join(' '), 140);
  const prefix = date ? `[${date}] ` : '';

  if (user && assistant) return `${prefix}${user} -> ${assistant}`;
  if (user) return `${prefix}${user}`;
  if (assistant) return `${prefix}assistant: ${assistant}`;
  return '';
}

function renderHookItem(turn) {
  const date = formatDate(turn.timestamp);
  const prefix = date ? `[${date}] ` : '';
  const events = Array.isArray(turn.events) ? turn.events.join(' -> ') : '';
  const parts = [];
  if (turn.prompt) parts.push(`prompt: ${summarizeText(turn.prompt, 100)}`);
  if (Array.isArray(turn.tools) && turn.tools.length > 0) {
    parts.push(`tools: ${summarizeText(turn.tools.join(' | '), 110)}`);
  }
  if (turn.outcome) parts.push(`outcome: ${summarizeText(turn.outcome, 120)}`);

  const head = [
    `${prefix}hook`,
    turn.turnKey || '',
    events ? `[${events}]` : ''
  ].filter(Boolean).join(' ');

  if (parts.length === 0) return head;
  return `${head} ${parts.join(' | ')}`;
}

export function buildRollingSummary(entries, {
  recentTurnLimit = 12,
  maxItems = 6,
  hookEntries = []
} = {}) {
  if (!Number.isFinite(maxItems) || maxItems <= 0) return null;

  const turns = buildRecentTurns(entries, { limit: Number.MAX_SAFE_INTEGER });
  const hookTurns = buildRecentHookTurns(hookEntries, { limit: Number.MAX_SAFE_INTEGER });
  const olderTurns = turns.slice(0, turns.length - recentTurnLimit);
  const olderHookTurns = hookTurns.slice(0, hookTurns.length - recentTurnLimit);
  const candidates = [
    ...olderTurns
      .map((turn) => ({ kind: 'chat', timestamp: turn.timestamp, text: renderItem(turn) })),
    ...olderHookTurns
      .map((turn) => ({ kind: 'hook', timestamp: turn.timestamp, text: renderHookItem(turn) }))
  ]
    .filter((item) => Boolean(item.text))
    .sort((a, b) => toEpochMs(a.timestamp) - toEpochMs(b.timestamp));

  if (candidates.length === 0) return null;

  const itemCount = Math.min(maxItems, candidates.length);
  const selected = pickIndices(candidates.length, itemCount)
    .map((idx) => candidates[idx])
    .filter(Boolean);

  const hasSelectedHook = selected.some((item) => item.kind === 'hook');
  if (!hasSelectedHook && olderHookTurns.length > 0 && (olderTurns.length === 0 || itemCount > 1)) {
    const fallbackHook = [...candidates].reverse().find((item) => item.kind === 'hook');
    if (fallbackHook) {
      if (selected.length === 0) {
        selected.push(fallbackHook);
      } else {
        selected[selected.length - 1] = fallbackHook;
      }
    }
  }

  const items = selected.map((item) => item.text).filter(Boolean);
  if (items.length === 0) return null;

  return {
    source: 'deterministic',
    totalTurns: turns.length,
    totalHookTurns: hookTurns.length,
    summarizedTurns: olderTurns.length,
    summarizedHookTurns: olderHookTurns.length,
    recentTurns: recentTurnLimit,
    items
  };
}
