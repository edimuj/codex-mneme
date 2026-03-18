import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSessionFile } from '../src/lib/session-parser.mjs';

function writeFixture(lines) {
  const dir = mkdtempSync(join(tmpdir(), 'codex-mneme-test-'));
  const path = join(dir, 'rollout.jsonl');
  writeFileSync(path, lines.map((line) => JSON.stringify(line)).join('\n') + '\n');
  return path;
}

test('parseSessionFile captures user input and assistant final answers only', () => {
  const fixture = writeFixture([
    {
      type: 'session_meta',
      payload: { cwd: '/tmp/project-x' }
    },
    {
      timestamp: '2026-03-18T09:00:00.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'hello world' }]
      }
    },
    {
      timestamp: '2026-03-18T09:00:01.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        phase: 'commentary',
        content: [{ type: 'output_text', text: 'thinking...' }]
      }
    },
    {
      timestamp: '2026-03-18T09:00:02.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        phase: 'final_answer',
        content: [{ type: 'output_text', text: 'final output' }]
      }
    }
  ]);

  const parsed = parseSessionFile(fixture, '/tmp/project-x');
  assert.equal(parsed.matchesProject, true);
  assert.equal(parsed.entries.length, 2);
  assert.equal(parsed.entries[0].role, 'user');
  assert.equal(parsed.entries[0].text, 'hello world');
  assert.equal(parsed.entries[1].role, 'assistant');
  assert.equal(parsed.entries[1].text, 'final output');
});

test('parseSessionFile skips injected AGENTS bootstrap user item', () => {
  const fixture = writeFixture([
    {
      type: 'session_meta',
      payload: { cwd: '/tmp/project-y' }
    },
    {
      timestamp: '2026-03-18T09:10:00.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: '# AGENTS.md instructions for /tmp/project-y' }]
      }
    },
    {
      timestamp: '2026-03-18T09:10:01.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'real user prompt' }]
      }
    }
  ]);

  const parsed = parseSessionFile(fixture, '/tmp/project-y');
  assert.equal(parsed.entries.length, 1);
  assert.equal(parsed.entries[0].text, 'real user prompt');
});
