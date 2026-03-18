import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRecentTurns } from '../src/lib/turns.mjs';

test('buildRecentTurns orders by timestamp and groups user + assistant entries', () => {
  const turns = buildRecentTurns([
    {
      timestamp: '2026-03-18T10:00:03.000Z',
      role: 'assistant',
      text: 'second answer'
    },
    {
      timestamp: '2026-03-18T10:00:00.000Z',
      role: 'user',
      text: 'first question'
    },
    {
      timestamp: '2026-03-18T10:00:01.000Z',
      role: 'assistant',
      text: 'first answer'
    },
    {
      timestamp: '2026-03-18T10:00:02.000Z',
      role: 'user',
      text: 'second question'
    }
  ]);

  assert.equal(turns.length, 2);
  assert.equal(turns[0].user, 'first question');
  assert.deepEqual(turns[0].assistant, ['first answer']);
  assert.equal(turns[1].user, 'second question');
  assert.deepEqual(turns[1].assistant, ['second answer']);
});

test('buildRecentTurns trims low-value user acknowledgement messages', () => {
  const turns = buildRecentTurns([
    {
      timestamp: '2026-03-18T11:00:00.000Z',
      role: 'user',
      text: 'thanks!'
    },
    {
      timestamp: '2026-03-18T11:00:01.000Z',
      role: 'assistant',
      text: 'No problem.'
    },
    {
      timestamp: '2026-03-18T11:00:02.000Z',
      role: 'user',
      text: 'implement roadmap item 1'
    },
    {
      timestamp: '2026-03-18T11:00:03.000Z',
      role: 'assistant',
      text: 'On it.'
    }
  ]);

  assert.equal(turns.length, 1);
  assert.equal(turns[0].user, 'implement roadmap item 1');
  assert.deepEqual(turns[0].assistant, ['On it.']);
});

test('buildRecentTurns respects turn limit after grouping', () => {
  const turns = buildRecentTurns([
    { timestamp: '2026-03-18T12:00:00.000Z', role: 'user', text: 'q1' },
    { timestamp: '2026-03-18T12:00:01.000Z', role: 'assistant', text: 'a1' },
    { timestamp: '2026-03-18T12:00:02.000Z', role: 'user', text: 'q2' },
    { timestamp: '2026-03-18T12:00:03.000Z', role: 'assistant', text: 'a2' },
    { timestamp: '2026-03-18T12:00:04.000Z', role: 'user', text: 'q3' },
    { timestamp: '2026-03-18T12:00:05.000Z', role: 'assistant', text: 'a3' }
  ], { limit: 2 });

  assert.equal(turns.length, 2);
  assert.equal(turns[0].user, 'q2');
  assert.equal(turns[1].user, 'q3');
});
