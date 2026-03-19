import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAiRollingSummary, parseAiSummaryItems } from '../src/lib/ai-summary.mjs';

test('parseAiSummaryItems parses strict JSON and enforces limits', () => {
  const items = parseAiSummaryItems('{"items":["  first  ","second","second"]}', {
    maxItems: 5,
    itemMaxChars: 30
  });
  assert.deepEqual(items, ['first', 'second']);
});

test('parseAiSummaryItems falls back to lines when output is not JSON', () => {
  const items = parseAiSummaryItems('- one\n2. two\n\nthree', {
    maxItems: 2,
    itemMaxChars: 30
  });
  assert.deepEqual(items, ['one', 'two']);
});

test('buildAiRollingSummary returns null when there are not enough turns', () => {
  let called = false;
  const summary = buildAiRollingSummary([
    { timestamp: '2026-03-18T10:00:00.000Z', role: 'user', text: 'q1' },
    { timestamp: '2026-03-18T10:00:01.000Z', role: 'assistant', text: 'a1' }
  ], {
    recentTurnLimit: 1,
    maxItems: 3
  }, {
    runExec: () => {
      called = true;
      return { ok: true, output: '{"items":["x"]}' };
    }
  });

  assert.equal(summary, null);
  assert.equal(called, false);
});

test('buildAiRollingSummary uses codex output and returns ai metadata', () => {
  const summary = buildAiRollingSummary([
    { timestamp: '2026-03-18T10:00:00.000Z', role: 'user', text: 'q1' },
    { timestamp: '2026-03-18T10:00:01.000Z', role: 'assistant', text: 'a1' },
    { timestamp: '2026-03-18T10:00:02.000Z', role: 'user', text: 'q2' },
    { timestamp: '2026-03-18T10:00:03.000Z', role: 'assistant', text: 'a2' },
    { timestamp: '2026-03-18T10:00:04.000Z', role: 'user', text: 'q3' },
    { timestamp: '2026-03-18T10:00:05.000Z', role: 'assistant', text: 'a3' }
  ], {
    recentTurnLimit: 1,
    maxItems: 2,
    model: 'gpt-5.4-mini'
  }, {
    runExec: () => ({ ok: true, output: '{"items":["decision: use x","todo: add tests","extra"]}' })
  });

  assert.ok(summary);
  assert.equal(summary.source, 'ai');
  assert.equal(summary.model, 'gpt-5.4-mini');
  assert.equal(summary.recentTurns, 1);
  assert.equal(summary.summarizedTurns, 2);
  assert.deepEqual(summary.items, ['decision: use x', 'todo: add tests']);
});

test('buildAiRollingSummary throws when codex execution fails', () => {
  assert.throws(() => {
    buildAiRollingSummary([
      { timestamp: '2026-03-18T10:00:00.000Z', role: 'user', text: 'q1' },
      { timestamp: '2026-03-18T10:00:01.000Z', role: 'assistant', text: 'a1' },
      { timestamp: '2026-03-18T10:00:02.000Z', role: 'user', text: 'q2' },
      { timestamp: '2026-03-18T10:00:03.000Z', role: 'assistant', text: 'a2' }
    ], {
      recentTurnLimit: 1,
      maxItems: 2
    }, {
      runExec: () => ({ ok: false, error: 'login required' })
    });
  }, /login required/);
});
