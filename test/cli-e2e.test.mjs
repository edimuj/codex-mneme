import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { projectKey } from '../src/lib/project.mjs';

function tempDir(prefix) {
  return mkdtempSync(join(tmpdir(), `codex-mneme-cli-${prefix}-`));
}

const CLI_PATH = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));

test('cli hook command accepts stdin payload and infers event', () => {
  const cwd = tempDir('hook-cwd');
  const mnemeHome = tempDir('hook-home');

  const payload = JSON.stringify({
    hook_event_name: 'UserPromptSubmit',
    session_id: 'session-e2e',
    turn_id: 'turn-e2e-1',
    prompt: 'Investigate failing tests'
  });

  const result = spawnSync(process.execPath, [CLI_PATH, 'hook'], {
    cwd,
    env: {
      ...process.env,
      CODEX_MNEME_ENABLE_HOOKS: '1',
      CODEX_MNEME_HOME: mnemeHome
    },
    input: payload,
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr);
  const out = JSON.parse(result.stdout);
  assert.equal(out.event, 'UserPromptSubmit');
  assert.equal(out.hookRecord.turnKey, 'session-e2e:turn-e2e-1');
  assert.equal(out.hookRecord.text, 'Investigate failing tests');

  const hooksPath = join(mnemeHome, 'projects', projectKey(cwd), 'hooks.jsonl');
  assert.equal(existsSync(hooksPath), true);
  const lines = readFileSync(hooksPath, 'utf8').trim().split('\n');
  const last = JSON.parse(lines[lines.length - 1]);
  assert.equal(last.turnKey, 'session-e2e:turn-e2e-1');
});

test('cli codex-init can apply hooks config', () => {
  const cwd = tempDir('init-hooks');

  const result = spawnSync(process.execPath, [
    CLI_PATH,
    'codex-init',
    '--apply-hooks',
    '--hooks-config',
    '.codex/hooks.json'
  ], {
    cwd,
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr);
  const out = JSON.parse(result.stdout);
  assert.equal(out.hooks.status, 'created');
  const hooksPath = join(cwd, '.codex', 'hooks.json');
  const parsed = JSON.parse(readFileSync(hooksPath, 'utf8'));
  assert.ok(parsed.hooks.SessionStart);
  assert.ok(parsed.hooks.Stop);
  assert.equal(
    parsed.hooks.Stop[0].hooks[0].command,
    'bash -lc "CODEX_MNEME_ENABLE_HOOKS=1 codex-mneme hook"'
  );
});

test('cli session-start prints cached context when memory refresh cannot write', () => {
  const cwd = tempDir('readonly-cwd');
  const mnemeHome = tempDir('readonly-home');
  const projectBase = join(mnemeHome, 'projects', projectKey(cwd));
  mkdirSync(projectBase, { recursive: true });
  chmodSync(projectBase, 0o555);

  try {
    const result = spawnSync(process.execPath, [CLI_PATH, 'session-start', '--limit', '1'], {
      cwd,
      env: {
        ...process.env,
        CODEX_HOME: join(mnemeHome, 'codex-home'),
        CODEX_MNEME_HOME: mnemeHome
      },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /# Codex-Mneme Context/);
    assert.match(result.stdout, /Memory refresh skipped/);
    assert.match(result.stdout, /using cached project memory/);
  } finally {
    chmodSync(projectBase, 0o755);
  }
});
