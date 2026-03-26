import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ingestSessions } from '../src/lib/ingest.mjs';
import { projectPaths } from '../src/lib/paths.mjs';
import { readJsonl } from '../src/lib/fs-utils.mjs';

process.env.CODEX_MNEME_HOME = mkdtempSync(join(tmpdir(), 'codex-mneme-ingest-home-'));

function createProjectDir(prefix) {
  return mkdtempSync(join(tmpdir(), `codex-mneme-${prefix}-`));
}

function createSessionsRoot(prefix) {
  const root = mkdtempSync(join(tmpdir(), `codex-mneme-sessions-${prefix}-`));
  const sessions = join(root, 'sessions');
  mkdirSync(sessions, { recursive: true });
  return sessions;
}

function writeSessionFile({ sessionsRoot, relDir, name, cwd, messages }) {
  const dir = join(sessionsRoot, relDir);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  const lines = [
    {
      type: 'session_meta',
      payload: { cwd }
    },
    ...messages
  ];
  writeFileSync(file, lines.map((line) => JSON.stringify(line)).join('\n') + '\n');
  return file;
}

function userMessage(timestamp, text) {
  return {
    timestamp,
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text }]
    }
  };
}

function assistantFinal(timestamp, text) {
  return {
    timestamp,
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'assistant',
      phase: 'final_answer',
      content: [{ type: 'output_text', text }]
    }
  };
}

test('ingestSessions keeps ingest bounded and drains deferred backlog', { concurrency: false }, () => {
  const cwd = createProjectDir('ingest-bounded');
  const sessionsRoot = createSessionsRoot('bounded');

  for (let i = 1; i <= 5; i += 1) {
    writeSessionFile({
      sessionsRoot,
      relDir: '2026/03/18',
      name: `session-${i}.jsonl`,
      cwd,
      messages: [
        userMessage(`2026-03-18T10:00:0${i}.000Z`, `question ${i}`),
        assistantFinal(`2026-03-18T10:00:1${i}.000Z`, `answer ${i}`)
      ]
    });
  }

  const first = ingestSessions({
    cwd,
    sessionsRoot,
    maxFilesPerRun: 2,
    maxKnownFileStats: 20
  });
  assert.equal(first.scanned, 2);
  assert.equal(first.deferred, 3);

  const second = ingestSessions({
    cwd,
    sessionsRoot,
    maxFilesPerRun: 2,
    maxKnownFileStats: 20
  });
  assert.equal(second.scanned, 2);
  assert.equal(second.deferred, 1);

  const third = ingestSessions({
    cwd,
    sessionsRoot,
    maxFilesPerRun: 2,
    maxKnownFileStats: 20
  });
  assert.equal(third.scanned, 1);
  assert.equal(third.deferred, 0);

  const paths = projectPaths(cwd);
  const log = readJsonl(paths.log);
  assert.equal(log.length, 10);
});

test('ingestSessions detects appended content from known files without dir changes', { concurrency: false }, () => {
  const cwd = createProjectDir('ingest-append');
  const sessionsRoot = createSessionsRoot('append');

  const file = writeSessionFile({
    sessionsRoot,
    relDir: '2026/03/18',
    name: 'active.jsonl',
    cwd,
    messages: [
      userMessage('2026-03-18T11:00:00.000Z', 'first question'),
      assistantFinal('2026-03-18T11:00:01.000Z', 'first answer')
    ]
  });

  const first = ingestSessions({
    cwd,
    sessionsRoot,
    maxFilesPerRun: 10,
    maxKnownFileStats: 1
  });
  assert.equal(first.appended, 2);

  const appendedLines = [
    userMessage('2026-03-18T11:01:00.000Z', 'second question'),
    assistantFinal('2026-03-18T11:01:01.000Z', 'second answer')
  ];
  appendFileSync(file, appendedLines.map((line) => JSON.stringify(line)).join('\n') + '\n');

  const second = ingestSessions({
    cwd,
    sessionsRoot,
    maxFilesPerRun: 10,
    maxKnownFileStats: 1
  });
  assert.equal(second.scanned, 1);
  assert.equal(second.appended, 2);
  assert.equal(second.dirsChanged, 0);
  assert.ok(second.knownFilesChecked >= 1);

  const third = ingestSessions({
    cwd,
    sessionsRoot,
    maxFilesPerRun: 10,
    maxKnownFileStats: 1
  });
  assert.equal(third.appended, 0);
});

test('ingestSessions keeps identical turns from different session files', { concurrency: false }, () => {
  const cwd = createProjectDir('ingest-source-aware');
  const sessionsRoot = createSessionsRoot('source-aware');

  writeSessionFile({
    sessionsRoot,
    relDir: '2026/03/18',
    name: 'session-a.jsonl',
    cwd,
    messages: [
      userMessage('2026-03-18T12:00:00.000Z', 'same question'),
      assistantFinal('2026-03-18T12:00:01.000Z', 'same answer')
    ]
  });

  writeSessionFile({
    sessionsRoot,
    relDir: '2026/03/18',
    name: 'session-b.jsonl',
    cwd,
    messages: [
      userMessage('2026-03-18T12:00:00.000Z', 'same question'),
      assistantFinal('2026-03-18T12:00:01.000Z', 'same answer')
    ]
  });

  const result = ingestSessions({
    cwd,
    sessionsRoot,
    maxFilesPerRun: 10,
    maxKnownFileStats: 10
  });

  assert.equal(result.appended, 4);
  const log = readJsonl(projectPaths(cwd).log);
  assert.equal(log.length, 4);
});

test('ingestSessions compacts duplicate rows already present in log', { concurrency: false }, () => {
  const cwd = createProjectDir('ingest-compact');
  const sessionsRoot = createSessionsRoot('compact');
  const paths = projectPaths(cwd);

  writeSessionFile({
    sessionsRoot,
    relDir: '2026/03/18',
    name: 'seed.jsonl',
    cwd,
    messages: [
      userMessage('2026-03-18T13:00:00.000Z', 'seed question'),
      assistantFinal('2026-03-18T13:00:01.000Z', 'seed answer')
    ]
  });

  const first = ingestSessions({
    cwd,
    sessionsRoot,
    maxFilesPerRun: 10,
    maxKnownFileStats: 10
  });
  assert.equal(first.appended, 2);

  const original = readJsonl(paths.log);
  assert.equal(original.length, 2);

  const duplicated = [
    original[0],
    original[1],
    original[0],
    original[1]
  ];
  writeFileSync(paths.log, duplicated.map((entry) => JSON.stringify(entry)).join('\n') + '\n');

  const second = ingestSessions({
    cwd,
    sessionsRoot,
    maxFilesPerRun: 10,
    maxKnownFileStats: 10
  });
  assert.equal(second.appended, 0);

  const compacted = readJsonl(paths.log);
  assert.equal(compacted.length, 2);
});
