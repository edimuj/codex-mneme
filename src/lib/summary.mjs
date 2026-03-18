import { buildRecentTurns } from './turns.mjs';

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

export function buildRollingSummary(entries, {
  recentTurnLimit = 12,
  maxItems = 6
} = {}) {
  const turns = buildRecentTurns(entries, { limit: Number.MAX_SAFE_INTEGER });
  if (turns.length <= recentTurnLimit) return null;

  const olderTurns = turns.slice(0, turns.length - recentTurnLimit);
  const itemCount = Math.min(maxItems, olderTurns.length);
  const items = pickIndices(olderTurns.length, itemCount)
    .map((idx) => renderItem(olderTurns[idx]))
    .filter(Boolean);

  if (items.length === 0) return null;

  return {
    totalTurns: turns.length,
    summarizedTurns: olderTurns.length,
    recentTurns: recentTurnLimit,
    items
  };
}
