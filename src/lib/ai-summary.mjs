import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildRecentTurns } from './turns.mjs';

function normalizeOneLine(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function clipText(text, max) {
  const oneLine = normalizeOneLine(text);
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

function renderTurn(turn, { maxUserChars, maxAssistantChars }) {
  const date = formatDate(turn.timestamp);
  const prefix = date ? `[${date}] ` : '';
  const user = clipText(turn.user, maxUserChars);
  const assistant = clipText((turn.assistant || []).join(' '), maxAssistantChars);
  if (user && assistant) return `${prefix}user: ${user} | assistant: ${assistant}`;
  if (user) return `${prefix}user: ${user}`;
  if (assistant) return `${prefix}assistant: ${assistant}`;
  return '';
}

function sanitizeItem(text, maxChars) {
  let out = normalizeOneLine(text)
    .replace(/^[-*+]\s+/, '')
    .replace(/^\d+[.)]\s+/, '')
    .trim();
  if (!out) return '';
  if (out.length > maxChars) out = `${out.slice(0, maxChars - 1)}…`;
  return out;
}

export function parseAiSummaryItems(rawText, { maxItems = 6, itemMaxChars = 220 } = {}) {
  const source = String(rawText || '').trim();
  if (!source) return [];

  const cap = Number.isFinite(maxItems) && maxItems > 0 ? maxItems : 6;
  const maxChars = Number.isFinite(itemMaxChars) && itemMaxChars > 0 ? itemMaxChars : 220;

  const candidates = [];
  const pushItem = (value) => {
    if (typeof value !== 'string') return;
    const sanitized = sanitizeItem(value, maxChars);
    if (!sanitized) return;
    candidates.push(sanitized);
  };

  const tryParseJson = (text) => {
    try {
      const parsed = JSON.parse(text);
      const items = Array.isArray(parsed) ? parsed : parsed?.items;
      if (!Array.isArray(items)) return false;
      for (const item of items) pushItem(item);
      return true;
    } catch {
      return false;
    }
  };

  if (!tryParseJson(source)) {
    const start = source.indexOf('{');
    const end = source.lastIndexOf('}');
    if (start >= 0 && end > start) {
      tryParseJson(source.slice(start, end + 1));
    }
  }

  if (candidates.length === 0) {
    for (const line of source.split('\n')) {
      pushItem(line);
      if (candidates.length >= cap) break;
    }
  }

  const deduped = [];
  const seen = new Set();
  for (const item of candidates) {
    if (seen.has(item)) continue;
    seen.add(item);
    deduped.push(item);
    if (deduped.length >= cap) break;
  }
  return deduped;
}

function runCodexExec({
  prompt,
  model,
  timeoutMs,
  codexPath
}) {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'codex-mneme-'));
  const outputFile = join(tmpRoot, 'last-message.txt');

  try {
    const result = spawnSync(codexPath, [
      'exec',
      '--skip-git-repo-check',
      '--sandbox',
      'read-only',
      '--model',
      model,
      '--output-last-message',
      outputFile,
      '-'
    ], {
      encoding: 'utf8',
      input: prompt,
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024
    });

    if (result.error) {
      return {
        ok: false,
        error: result.error.message || 'codex exec failed'
      };
    }

    if (result.status !== 0) {
      const stderr = normalizeOneLine(result.stderr || '');
      return {
        ok: false,
        error: stderr || `codex exec exited ${result.status}`
      };
    }

    const message = existsSync(outputFile)
      ? readFileSync(outputFile, 'utf8')
      : String(result.stdout || '');

    return {
      ok: true,
      output: message
    };
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
}

export function buildAiRollingSummary(entries, {
  recentTurnLimit = 12,
  maxItems = 6,
  model = 'gpt-5.4-mini',
  maxInputChars = 12000,
  itemMaxChars = 220,
  timeoutMs = 45000,
  maxUserChars = 180,
  maxAssistantChars = 220,
  codexPath = 'codex'
} = {}, deps = {}) {
  if (!Number.isFinite(maxItems) || maxItems <= 0) return null;

  const turns = buildRecentTurns(entries, { limit: Number.MAX_SAFE_INTEGER });
  if (turns.length <= recentTurnLimit) return null;

  const olderTurns = turns.slice(0, turns.length - recentTurnLimit);
  if (olderTurns.length === 0) return null;

  const inputBudget = Number.isFinite(maxInputChars) && maxInputChars > 0 ? maxInputChars : 12000;
  const perTurnEstimate = Math.max(120, Math.min(maxUserChars + maxAssistantChars + 24, 500));
  let sampleCount = Math.max(1, Math.min(olderTurns.length, Math.floor(inputBudget / perTurnEstimate)));
  let sampled = pickIndices(olderTurns.length, sampleCount).map((idx) => olderTurns[idx]);
  let rendered = sampled
    .map((turn) => renderTurn(turn, { maxUserChars, maxAssistantChars }))
    .filter(Boolean)
    .join('\n');

  while (rendered.length > inputBudget && sampleCount > 1) {
    sampleCount = Math.max(1, Math.floor(sampleCount * 0.8));
    sampled = pickIndices(olderTurns.length, sampleCount).map((idx) => olderTurns[idx]);
    rendered = sampled
      .map((turn) => renderTurn(turn, { maxUserChars, maxAssistantChars }))
      .filter(Boolean)
      .join('\n');
  }

  if (rendered.length > inputBudget) {
    rendered = rendered.slice(rendered.length - inputBudget);
  }

  const prompt = [
    'Summarize coding conversation turns for startup context in a future Codex session.',
    '',
    'Return STRICT JSON only in this shape:',
    '{"items":["..."]}',
    '',
    'Rules:',
    `- Max ${maxItems} items.`,
    `- Each item must be <= ${itemMaxChars} characters.`,
    '- Focus on durable context: decisions, constraints, todo/next steps, unresolved bugs, and important implementation facts.',
    '- Ignore social chatter, acknowledgements, and pleasantries.',
    '- Do not invent facts.',
    '- If there is nothing worth keeping, return {"items":[]}.',
    '',
    'Older turns to summarize:',
    rendered
  ].join('\n');

  const runExec = typeof deps.runExec === 'function' ? deps.runExec : runCodexExec;
  const result = runExec({
    prompt,
    model,
    timeoutMs,
    codexPath
  });

  if (!result || result.ok !== true) {
    const reason = result && typeof result.error === 'string' ? result.error : 'codex exec failed';
    throw new Error(reason);
  }

  const items = parseAiSummaryItems(result.output, {
    maxItems,
    itemMaxChars
  });
  if (items.length === 0) return null;

  return {
    source: 'ai',
    model,
    sampledTurns: sampled.length,
    totalTurns: turns.length,
    summarizedTurns: olderTurns.length,
    recentTurns: recentTurnLimit,
    items
  };
}
