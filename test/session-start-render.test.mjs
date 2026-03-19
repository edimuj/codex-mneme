import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSessionStartOutput, clipOutput } from '../src/lib/session-start-render.mjs';

test('buildSessionStartOutput renders empty-state message', () => {
  const out = buildSessionStartOutput({
    remembered: [],
    rollingSummary: null,
    recentTurns: []
  });

  assert.match(out, /^# Codex-Mneme Context/);
  assert.match(out, /No project memory yet\./);
});

test('buildSessionStartOutput applies maxRecentChars to recent lines', () => {
  const out = buildSessionStartOutput({
    remembered: [],
    rollingSummary: null,
    maxRecentChars: 20,
    recentTurns: [
      {
        timestamp: '2026-03-19T10:00:00.000Z',
        user: 'This is a very long user prompt that should be clipped',
        assistant: ['This is a very long assistant response that should also be clipped']
      }
    ]
  });

  assert.match(out, /user: This is a very long…/);
  assert.match(out, /assistant: This is a very long…/);
});

test('buildSessionStartOutput renders summary source and fallback notice', () => {
  const out = buildSessionStartOutput({
    remembered: [],
    summaryNotice: 'AI summary unavailable (login required); using deterministic summary.',
    rollingSummary: {
      source: 'deterministic',
      summarizedTurns: 5,
      recentTurns: 2,
      items: ['decision: keep jsonl canonical']
    },
    recentTurns: []
  });

  assert.match(out, /AI summary unavailable \(login required\); using deterministic summary\./);
  assert.match(out, /Source: deterministic heuristic\./);
  assert.match(out, /decision: keep jsonl canonical/);
});

test('buildSessionStartOutput renders ai summary model metadata', () => {
  const out = buildSessionStartOutput({
    remembered: [],
    rollingSummary: {
      source: 'ai',
      model: 'gpt-5.4-mini',
      summarizedTurns: 5,
      recentTurns: 2,
      items: ['todo: ship npm release']
    },
    recentTurns: []
  });

  assert.match(out, /Source: AI via codex exec \(gpt-5\.4-mini\)\./);
});

test('clipOutput enforces deterministic max output size', () => {
  const source = 'abcdefghijklmnopqrstuvwxyz';
  assert.equal(clipOutput(source, 0), source);
  assert.equal(clipOutput(source, 5), 'abcd…');
  assert.equal(clipOutput(source, 1), '…');
});
