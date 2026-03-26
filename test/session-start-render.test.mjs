import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSessionStartOutput,
  clipOutput,
  selectRememberedItems
} from '../src/lib/session-start-render.mjs';

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

test('buildSessionStartOutput renders ai cache-hit marker', () => {
  const out = buildSessionStartOutput({
    remembered: [],
    rollingSummary: {
      source: 'ai',
      model: 'gpt-5.4-mini',
      cached: true,
      summarizedTurns: 5,
      recentTurns: 2,
      items: ['todo: ship npm release']
    },
    recentTurns: []
  });

  assert.match(out, /Source: AI via codex exec \(gpt-5\.4-mini\) \[cache hit\]\./);
});

test('buildSessionStartOutput renders remembered notice', () => {
  const out = buildSessionStartOutput({
    rememberedNotice: 'Showing 2 of 5 remembered items.',
    remembered: [
      { type: 'decision', content: 'decision one' },
      { type: 'todo', content: 'todo one' }
    ],
    rollingSummary: null,
    recentTurns: []
  });

  assert.match(out, /Showing 2 of 5 remembered items\./);
});

test('selectRememberedItems limits output and prioritizes constraint\/todo by recency', () => {
  const selected = selectRememberedItems([
    { type: 'decision', content: 'older decision', timestamp: '2026-03-19T10:00:00.000Z' },
    { type: 'constraint', content: 'older constraint', timestamp: '2026-03-19T09:00:00.000Z' },
    { type: 'todo', content: 'new todo', timestamp: '2026-03-19T11:00:00.000Z' },
    { type: 'constraint', content: 'new constraint', timestamp: '2026-03-19T12:00:00.000Z' }
  ], { maxItems: 2 });

  assert.equal(selected.total, 4);
  assert.equal(selected.omitted, 2);
  assert.equal(selected.items.length, 2);
  assert.equal(selected.items[0].type, 'constraint');
  assert.equal(selected.items[0].content, 'new constraint');
  assert.equal(selected.items[1].type, 'constraint');
});

test('clipOutput enforces deterministic max output size', () => {
  const source = 'abcdefghijklmnopqrstuvwxyz';
  assert.equal(clipOutput(source, 0), source);
  assert.equal(clipOutput(source, 5), 'abcd…');
  assert.equal(clipOutput(source, 1), '…');
});
