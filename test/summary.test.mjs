import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRollingSummary } from '../src/lib/summary.mjs';

test('buildRollingSummary returns null when there are not enough turns', () => {
  const summary = buildRollingSummary([
    { timestamp: '2026-03-18T10:00:00.000Z', role: 'user', text: 'q1' },
    { timestamp: '2026-03-18T10:00:01.000Z', role: 'assistant', text: 'a1' }
  ], { recentTurnLimit: 1 });

  assert.equal(summary, null);
});

test('buildRollingSummary summarizes older turns while keeping recent turns out', () => {
  const summary = buildRollingSummary([
    { timestamp: '2026-03-18T10:00:00.000Z', role: 'user', text: 'q1' },
    { timestamp: '2026-03-18T10:00:01.000Z', role: 'assistant', text: 'a1' },
    { timestamp: '2026-03-18T10:00:02.000Z', role: 'user', text: 'q2' },
    { timestamp: '2026-03-18T10:00:03.000Z', role: 'assistant', text: 'a2' },
    { timestamp: '2026-03-18T10:00:04.000Z', role: 'user', text: 'q3' },
    { timestamp: '2026-03-18T10:00:05.000Z', role: 'assistant', text: 'a3' },
    { timestamp: '2026-03-18T10:00:06.000Z', role: 'user', text: 'q4' },
    { timestamp: '2026-03-18T10:00:07.000Z', role: 'assistant', text: 'a4' },
    { timestamp: '2026-03-18T10:00:08.000Z', role: 'user', text: 'q5' },
    { timestamp: '2026-03-18T10:00:09.000Z', role: 'assistant', text: 'a5' }
  ], { recentTurnLimit: 2, maxItems: 2 });

  assert.ok(summary);
  assert.equal(summary.totalTurns, 5);
  assert.equal(summary.summarizedTurns, 3);
  assert.equal(summary.recentTurns, 2);
  assert.equal(summary.items.length, 2);
  assert.equal(summary.items[0], '[2026-03-18] q1 -> a1');
  assert.equal(summary.items[1], '[2026-03-18] q3 -> a3');
});

test('buildRollingSummary ignores low-value acknowledgements via turn builder', () => {
  const summary = buildRollingSummary([
    { timestamp: '2026-03-18T11:00:00.000Z', role: 'user', text: 'thanks' },
    { timestamp: '2026-03-18T11:00:01.000Z', role: 'assistant', text: 'you are welcome' },
    { timestamp: '2026-03-18T11:00:02.000Z', role: 'user', text: 'real question' },
    { timestamp: '2026-03-18T11:00:03.000Z', role: 'assistant', text: 'real answer' },
    { timestamp: '2026-03-18T11:00:04.000Z', role: 'user', text: 'another question' },
    { timestamp: '2026-03-18T11:00:05.000Z', role: 'assistant', text: 'another answer' }
  ], { recentTurnLimit: 1, maxItems: 3 });

  assert.ok(summary);
  assert.equal(summary.totalTurns, 2);
  assert.equal(summary.summarizedTurns, 1);
  assert.equal(summary.items.length, 1);
  assert.equal(summary.items[0], '[2026-03-18] real question -> real answer');
});
