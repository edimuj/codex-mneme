import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  handleHookEvent,
  hooksEnabled,
  normalizeHookEvent,
  resolveHookPolicies
} from '../src/lib/hooks.mjs';
import { projectPaths } from '../src/lib/paths.mjs';
import { readJsonl } from '../src/lib/fs-utils.mjs';

process.env.CODEX_MNEME_HOME = mkdtempSync(join(tmpdir(), 'codex-mneme-hooks-home-'));

function createProjectDir(prefix) {
  return mkdtempSync(join(tmpdir(), `codex-mneme-hooks-${prefix}-`));
}

function createSessionsRoot(prefix) {
  const root = mkdtempSync(join(tmpdir(), `codex-mneme-hooks-sessions-${prefix}-`));
  const sessions = join(root, 'sessions');
  mkdirSync(sessions, { recursive: true });
  return sessions;
}

function writeSessionFile({ sessionsRoot, cwd }) {
  const dir = join(sessionsRoot, '2026/03/18');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'hook-session.jsonl');
  const lines = [
    {
      type: 'session_meta',
      payload: { cwd }
    },
    {
      timestamp: '2026-03-18T12:00:00.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'hook prompt' }]
      }
    },
    {
      timestamp: '2026-03-18T12:00:01.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        phase: 'final_answer',
        content: [{ type: 'output_text', text: 'hook answer' }]
      }
    }
  ];
  writeFileSync(file, lines.map((line) => JSON.stringify(line)).join('\n') + '\n');
}

test('hooksEnabled honors CODEX_MNEME_ENABLE_HOOKS', () => {
  assert.equal(hooksEnabled({ env: { CODEX_MNEME_ENABLE_HOOKS: '1' } }), true);
  assert.equal(hooksEnabled({ env: { CODEX_MNEME_ENABLE_HOOKS: 'true' } }), true);
  assert.equal(hooksEnabled({ env: { CODEX_MNEME_ENABLE_HOOKS: 'no' } }), false);
  assert.equal(hooksEnabled({ env: {} }), false);
});

test('normalizeHookEvent validates and canonicalizes names', () => {
  assert.equal(normalizeHookEvent('SessionStart'), 'SessionStart');
  assert.equal(normalizeHookEvent('session_start'), 'SessionStart');
  assert.equal(normalizeHookEvent('pre_tool_use'), 'PreToolUse');
  assert.equal(normalizeHookEvent('posttooluse'), 'PostToolUse');
  assert.equal(normalizeHookEvent('userpromptsubmit'), 'UserPromptSubmit');
  assert.equal(normalizeHookEvent('Stop'), 'Stop');
  assert.throws(() => normalizeHookEvent('RandomEvent'), /unknown hook event/);
});

test('resolveHookPolicies returns defaults', () => {
  const policies = resolveHookPolicies({ env: {} });
  assert.equal(policies.SessionStart.ingest, true);
  assert.equal(policies.PreToolUse.ingest, false);
  assert.equal(policies.PostToolUse.ingest, false);
  assert.equal(policies.UserPromptSubmit.ingest, false);
  assert.equal(policies.Stop.ingest, true);
});

test('resolveHookPolicies merges env and direct overrides', () => {
  const policies = resolveHookPolicies({
    env: {
      CODEX_MNEME_HOOK_POLICIES: JSON.stringify({
        Stop: { ingest: false }
      })
    },
    policies: {
      pre_tool_use: { ingest: true },
      stop: { ingest: true }
    }
  });

  assert.equal(policies.PreToolUse.ingest, true);
  assert.equal(policies.Stop.ingest, true);
});

test('resolveHookPolicies validates env JSON', () => {
  assert.throws(() => resolveHookPolicies({
    env: { CODEX_MNEME_HOOK_POLICIES: '{not-json}' }
  }), /invalid CODEX_MNEME_HOOK_POLICIES JSON/);
});

test('handleHookEvent is a no-op when hooks are disabled', () => {
  const cwd = createProjectDir('disabled');
  const result = handleHookEvent({
    cwd,
    event: 'SessionStart',
    enabled: false
  });

  assert.equal(result.enabled, false);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'hooks_disabled');

  const paths = projectPaths(cwd);
  const hooksLog = readJsonl(paths.hooks);
  assert.equal(hooksLog.length, 0);
});

test('handleHookEvent records UserPromptSubmit without ingest', () => {
  const cwd = createProjectDir('prompt');
  const result = handleHookEvent({
    cwd,
    event: 'UserPromptSubmit',
    text: 'Ship roadmap item 5',
    enabled: true
  });

  assert.equal(result.enabled, true);
  assert.equal(result.event, 'UserPromptSubmit');
  assert.equal(result.ingest, null);
  assert.equal(result.hookRecord.schemaVersion, 1);
  assert.equal(result.hookRecord.text, 'Ship roadmap item 5');

  const paths = projectPaths(cwd);
  const hooksLog = readJsonl(paths.hooks);
  assert.equal(hooksLog.length, 1);
  assert.equal(hooksLog[0].event, 'UserPromptSubmit');
  assert.equal(hooksLog[0].schemaVersion, 1);
  assert.equal(hooksLog[0].text, 'Ship roadmap item 5');
});

test('handleHookEvent records normalized PreToolUse alias and skips ingest', () => {
  const cwd = createProjectDir('pre-tool');
  const result = handleHookEvent({
    cwd,
    event: 'pre_tool_use',
    enabled: true
  });

  assert.equal(result.enabled, true);
  assert.equal(result.event, 'PreToolUse');
  assert.equal(result.ingest, null);
  assert.equal(result.hookRecord.schemaVersion, 1);
  assert.equal(result.hookRecord.rawEvent, 'pre_tool_use');

  const paths = projectPaths(cwd);
  const hooksLog = readJsonl(paths.hooks);
  assert.equal(hooksLog.length, 1);
  assert.equal(hooksLog[0].event, 'PreToolUse');
  assert.equal(hooksLog[0].rawEvent, 'pre_tool_use');
});

test('handleHookEvent policy can enable ingest for PreToolUse', { concurrency: false }, () => {
  const cwd = createProjectDir('pre-tool-ingest');
  const sessionsRoot = createSessionsRoot('pre-tool-ingest');
  writeSessionFile({ sessionsRoot, cwd });

  const result = handleHookEvent({
    cwd,
    event: 'PreToolUse',
    enabled: true,
    policies: {
      PreToolUse: { ingest: true }
    },
    ingestOptions: { sessionsRoot, maxFilesPerRun: 10 }
  });

  assert.equal(result.enabled, true);
  assert.equal(result.event, 'PreToolUse');
  assert.equal(result.policy.ingest, true);
  assert.ok(result.ingest);
  assert.equal(result.ingest.appended, 2);
});

test('handleHookEvent records turn correlation fields from hook input', () => {
  const cwd = createProjectDir('correlation');
  const result = handleHookEvent({
    cwd,
    event: 'PostToolUse',
    enabled: true,
    hookInput: {
      session_id: 'session-123',
      turn_id: 'turn-9',
      tool_use_id: 'tool-abc',
      tool_name: 'Bash'
    }
  });

  assert.equal(result.event, 'PostToolUse');
  assert.equal(result.hookRecord.sessionId, 'session-123');
  assert.equal(result.hookRecord.turnId, 'turn-9');
  assert.equal(result.hookRecord.toolUseId, 'tool-abc');
  assert.equal(result.hookRecord.toolName, 'Bash');
  assert.equal(result.hookRecord.turnKey, 'session-123:turn-9');

  const paths = projectPaths(cwd);
  const hooksLog = readJsonl(paths.hooks);
  assert.equal(hooksLog.length, 1);
  assert.equal(hooksLog[0].turnKey, 'session-123:turn-9');
});

test('handleHookEvent derives text from hook input prompt/command', () => {
  const cwdPrompt = createProjectDir('correlation-prompt');
  const promptResult = handleHookEvent({
    cwd: cwdPrompt,
    event: 'UserPromptSubmit',
    enabled: true,
    hookInput: {
      session_id: 'session-456',
      turn_id: 'turn-1',
      prompt: 'Please fix failing tests'
    }
  });
  assert.equal(promptResult.hookRecord.text, 'Please fix failing tests');

  const cwdTool = createProjectDir('correlation-tool');
  const toolResult = handleHookEvent({
    cwd: cwdTool,
    event: 'PreToolUse',
    enabled: true,
    hookInput: {
      session_id: 'session-456',
      turn_id: 'turn-2',
      tool_input: {
        command: 'npm test'
      }
    }
  });
  assert.equal(toolResult.hookRecord.text, 'npm test');
});

test('handleHookEvent triggers ingest on SessionStart and Stop', { concurrency: false }, () => {
  const cwd = createProjectDir('ingest');
  const sessionsRoot = createSessionsRoot('ingest');
  writeSessionFile({ sessionsRoot, cwd });

  const start = handleHookEvent({
    cwd,
    event: 'SessionStart',
    enabled: true,
    ingestOptions: { sessionsRoot, maxFilesPerRun: 10 }
  });

  assert.ok(start.ingest);
  assert.equal(start.ingest.appended, 2);

  const stop = handleHookEvent({
    cwd,
    event: 'Stop',
    enabled: true,
    ingestOptions: { sessionsRoot, maxFilesPerRun: 10 }
  });

  assert.ok(stop.ingest);
  assert.equal(stop.ingest.appended, 0);

  const paths = projectPaths(cwd);
  const hooksLog = readJsonl(paths.hooks);
  assert.equal(hooksLog.length, 2);
  assert.equal(hooksLog[0].event, 'SessionStart');
  assert.equal(hooksLog[1].event, 'Stop');
});
