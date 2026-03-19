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

test('parseAiSummaryItems rejects non-JSON payloads', () => {
  assert.throws(() => {
    parseAiSummaryItems('- one\n- two', {
      maxItems: 2,
      itemMaxChars: 30
    });
  }, /not valid JSON/);
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

test('buildAiRollingSummary uses codex output schema and returns ai metadata', () => {
  let observedSchema = null;
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
    itemMaxChars: 50,
    model: 'gpt-5.4-mini'
  }, {
    runExec: (params) => {
      observedSchema = params.outputSchema;
      return { ok: true, output: '{"items":["decision: use x","todo: add tests","extra"]}' };
    }
  });

  assert.ok(summary);
  assert.equal(summary.source, 'ai');
  assert.equal(summary.model, 'gpt-5.4-mini');
  assert.equal(summary.cached, false);
  assert.equal(summary.recentTurns, 1);
  assert.equal(summary.summarizedTurns, 2);
  assert.deepEqual(summary.items, ['decision: use x', 'todo: add tests']);
  assert.ok(observedSchema);
  assert.equal(observedSchema.type, 'object');
  assert.equal(observedSchema.properties.items.maxItems, 2);
  assert.equal(observedSchema.properties.items.items.maxLength, 50);
});

test('buildAiRollingSummary reuses cache and skips model call', () => {
  let runExecCalls = 0;
  let readCacheCalls = 0;
  const summary = buildAiRollingSummary([
    { timestamp: '2026-03-18T10:00:00.000Z', role: 'user', text: 'q1' },
    { timestamp: '2026-03-18T10:00:01.000Z', role: 'assistant', text: 'a1' },
    { timestamp: '2026-03-18T10:00:02.000Z', role: 'user', text: 'q2' },
    { timestamp: '2026-03-18T10:00:03.000Z', role: 'assistant', text: 'a2' },
    { timestamp: '2026-03-18T10:00:04.000Z', role: 'user', text: 'q3' },
    { timestamp: '2026-03-18T10:00:05.000Z', role: 'assistant', text: 'a3' }
  ], {
    recentTurnLimit: 1,
    maxItems: 2
  }, {
    readCache: () => {
      readCacheCalls += 1;
      return ['decision: cache hit', 'todo: keep it cheap'];
    },
    runExec: () => {
      runExecCalls += 1;
      return { ok: true, output: '{"items":["should not run"]}' };
    }
  });

  assert.equal(readCacheCalls, 1);
  assert.equal(runExecCalls, 0);
  assert.ok(summary);
  assert.equal(summary.cached, true);
  assert.deepEqual(summary.items, ['decision: cache hit', 'todo: keep it cheap']);
});

test('buildAiRollingSummary writes cache with generated items', () => {
  const writes = [];
  buildAiRollingSummary([
    { timestamp: '2026-03-18T10:00:00.000Z', role: 'user', text: 'q1' },
    { timestamp: '2026-03-18T10:00:01.000Z', role: 'assistant', text: 'a1' },
    { timestamp: '2026-03-18T10:00:02.000Z', role: 'user', text: 'q2' },
    { timestamp: '2026-03-18T10:00:03.000Z', role: 'assistant', text: 'a2' }
  ], {
    recentTurnLimit: 1,
    maxItems: 2
  }, {
    runExec: () => ({ ok: true, output: '{"items":["one","two"]}' }),
    writeCache: (payload) => writes.push(payload)
  });

  assert.equal(writes.length, 1);
  assert.equal(typeof writes[0].cacheKey, 'string');
  assert.equal(writes[0].cacheKey.length > 20, true);
  assert.equal(writes[0].model, 'gpt-5.4-mini');
  assert.deepEqual(writes[0].items, ['one', 'two']);
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
