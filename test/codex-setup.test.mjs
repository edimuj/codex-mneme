import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  autoSetupCodexCli,
  setupCodexCli,
  shouldAutoSetupCodexCli
} from '../src/lib/codex-setup.mjs';

function tempProjectDir(prefix) {
  return mkdtempSync(join(tmpdir(), `codex-mneme-codex-setup-${prefix}-`));
}

test('setupCodexCli creates project skill and returns notify snippet', () => {
  const cwd = tempProjectDir('skill');
  const result = setupCodexCli({ cwd });

  assert.equal(result.skill.status, 'created');
  assert.equal(result.agents.status, 'skipped');
  assert.equal(result.hooks.status, 'skipped');
  assert.ok(result.notifySnippet.includes('notify = ["bash", "-lc", "codex-mneme ingest >/dev/null 2>&1 || true"]'));
  assert.equal(existsSync(result.skill.path), true);

  const skillText = readFileSync(result.skill.path, 'utf8');
  assert.ok(skillText.includes('session-start --limit 8'));
  assert.ok(skillText.includes('Do not ask the user to run mneme commands manually'));
  assert.ok(skillText.includes('remember --type decision|constraint|todo'));
  assert.ok(result.hooksSnippet.includes('CODEX_MNEME_ENABLE_HOOKS=1 codex-mneme hook'));
});

test('setupCodexCli does not overwrite existing skill unless forced', () => {
  const cwd = tempProjectDir('force');
  const first = setupCodexCli({ cwd });
  assert.equal(first.skill.status, 'created');

  writeFileSync(first.skill.path, 'custom skill\n', 'utf8');

  const second = setupCodexCli({ cwd });
  assert.equal(second.skill.status, 'exists');
  assert.equal(readFileSync(first.skill.path, 'utf8'), 'custom skill\n');

  const third = setupCodexCli({ cwd, force: true });
  assert.equal(third.skill.status, 'updated');
  assert.ok(readFileSync(first.skill.path, 'utf8').includes('# codex-mneme'));
});

test('setupCodexCli can create and update managed AGENTS block', () => {
  const cwd = tempProjectDir('agents');
  const agentsPath = join(cwd, 'AGENTS.md');
  writeFileSync(agentsPath, '# Project Rules\n\nKeep it clean.\n', 'utf8');

  const first = setupCodexCli({ cwd, withAgents: true });
  assert.equal(first.agents.status, 'updated');

  const text = readFileSync(agentsPath, 'utf8');
  assert.ok(text.includes('<!-- codex-mneme:begin -->'));
  assert.ok(text.includes('## Codex-Mneme Workflow'));
  assert.ok(text.includes('<!-- codex-mneme:end -->'));

  const second = setupCodexCli({ cwd, withAgents: true });
  assert.equal(second.agents.status, 'unchanged');
});

test('setupCodexCli can create managed Codex config notify block', () => {
  const cwd = tempProjectDir('config-create');
  const configPath = '.codex/config.toml';
  const result = setupCodexCli({
    cwd,
    applyNotify: true,
    notifyConfigPath: configPath
  });

  assert.equal(result.config.status, 'created');
  assert.ok(result.config.path.endsWith('/.codex/config.toml'));
  const text = readFileSync(result.config.path, 'utf8');
  assert.ok(text.includes('# codex-mneme:begin'));
  assert.ok(text.includes('notify = ["bash", "-lc", "codex-mneme ingest >/dev/null 2>&1 || true"]'));
  assert.ok(text.includes('# codex-mneme:end'));
});

test('setupCodexCli updates existing managed Codex config notify block', () => {
  const cwd = tempProjectDir('config-update');
  const configPath = join(cwd, '.codex', 'config.toml');
  mkdirSync(join(cwd, '.codex'), { recursive: true });
  writeFileSync(configPath, [
    '# codex-mneme:begin',
    '# codex-mneme (optional): refresh memory after each Codex turn',
    'notify = ["bash", "-lc", "codex-mneme ingest >/dev/null 2>&1 || true"]',
    '# codex-mneme:end',
    ''
  ].join('\n'), 'utf8');

  const result = setupCodexCli({
    cwd,
    applyNotify: true,
    notifyConfigPath: configPath,
    command: 'mneme'
  });

  assert.equal(result.config.status, 'updated');
  const text = readFileSync(configPath, 'utf8');
  assert.ok(text.includes('notify = ["bash", "-lc", "mneme ingest >/dev/null 2>&1 || true"]'));
});

test('setupCodexCli reports conflict for unmanaged existing notify config', () => {
  const cwd = tempProjectDir('config-conflict');
  const configPath = join(cwd, '.codex', 'config.toml');
  mkdirSync(join(cwd, '.codex'), { recursive: true });
  writeFileSync(configPath, 'notify = ["bash", "-lc", "echo custom"]\n', 'utf8');

  const result = setupCodexCli({
    cwd,
    applyNotify: true,
    notifyConfigPath: configPath
  });

  assert.equal(result.config.status, 'conflict');
  assert.equal(result.config.reason, 'existing_notify_setting');
  assert.equal(readFileSync(configPath, 'utf8'), 'notify = ["bash", "-lc", "echo custom"]\n');
});

test('setupCodexCli global mode writes skill and AGENTS in codex home', () => {
  const cwd = tempProjectDir('global');
  const codexRoot = join(cwd, 'fake-codex-home');

  const result = setupCodexCli({
    cwd,
    global: true,
    withAgents: true,
    codexHomePath: codexRoot
  });

  assert.equal(result.scope, 'global');
  assert.equal(result.root, codexRoot);
  assert.equal(result.skill.path, join(codexRoot, 'skills', 'codex-mneme', 'SKILL.md'));
  assert.equal(result.skill.status, 'created');
  assert.equal(result.agents.path, join(codexRoot, 'AGENTS.md'));
  assert.equal(result.agents.status, 'created');
  assert.equal(existsSync(join(cwd, 'AGENTS.md')), false);

  const agentsText = readFileSync(result.agents.path, 'utf8');
  assert.ok(agentsText.includes('This workflow is agent-owned'));
  assert.ok(agentsText.includes('At session start in every project'));

  const second = setupCodexCli({
    cwd,
    global: true,
    withAgents: true,
    codexHomePath: codexRoot
  });
  assert.equal(second.skill.status, 'exists');
  assert.equal(second.agents.status, 'unchanged');
});

test('setupCodexCli global mode applies notify to codex home config by default', () => {
  const cwd = tempProjectDir('global-notify');
  const codexRoot = join(cwd, 'fake-codex-home');

  const result = setupCodexCli({
    cwd,
    global: true,
    applyNotify: true,
    codexHomePath: codexRoot
  });

  assert.equal(result.config.path, join(codexRoot, 'config.toml'));
  assert.equal(result.config.status, 'created');
  const configText = readFileSync(result.config.path, 'utf8');
  assert.ok(configText.includes('# codex-mneme:begin'));
  assert.ok(configText.includes('notify = ["bash", "-lc", "codex-mneme ingest >/dev/null 2>&1 || true"]'));
});

test('setupCodexCli can create managed hooks.json entries', () => {
  const cwd = tempProjectDir('hooks-create');
  const result = setupCodexCli({
    cwd,
    applyHooks: true,
    hooksConfigPath: '.codex/hooks.json'
  });

  assert.equal(result.hooks.status, 'created');
  assert.ok(result.hooks.path.endsWith('/.codex/hooks.json'));
  const text = readFileSync(result.hooks.path, 'utf8');
  const parsed = JSON.parse(text);
  assert.ok(parsed.hooks.SessionStart);
  assert.ok(parsed.hooks.PreToolUse);
  assert.ok(parsed.hooks.PostToolUse);
  assert.ok(parsed.hooks.UserPromptSubmit);
  assert.ok(parsed.hooks.Stop);
  assert.equal(
    parsed.hooks.Stop[0].hooks[0].command,
    'bash -lc "CODEX_MNEME_ENABLE_HOOKS=1 codex-mneme hook"'
  );
});

test('setupCodexCli appends managed hook command without replacing existing hooks', () => {
  const cwd = tempProjectDir('hooks-append');
  const hooksPath = join(cwd, '.codex', 'hooks.json');
  mkdirSync(join(cwd, '.codex'), { recursive: true });
  writeFileSync(hooksPath, JSON.stringify({
    hooks: {
      SessionStart: [
        {
          hooks: [
            {
              type: 'command',
              command: 'echo existing'
            }
          ]
        }
      ]
    }
  }, null, 2), 'utf8');

  const first = setupCodexCli({
    cwd,
    applyHooks: true,
    hooksConfigPath: hooksPath
  });
  assert.equal(first.hooks.status, 'updated');

  const parsed = JSON.parse(readFileSync(hooksPath, 'utf8'));
  assert.equal(parsed.hooks.SessionStart.length, 2);
  assert.equal(parsed.hooks.SessionStart[0].hooks[0].command, 'echo existing');

  const second = setupCodexCli({
    cwd,
    applyHooks: true,
    hooksConfigPath: hooksPath
  });
  assert.equal(second.hooks.status, 'unchanged');
});

test('setupCodexCli reports conflict for invalid hooks.json', () => {
  const cwd = tempProjectDir('hooks-conflict');
  const hooksPath = join(cwd, '.codex', 'hooks.json');
  mkdirSync(join(cwd, '.codex'), { recursive: true });
  writeFileSync(hooksPath, '{not json}', 'utf8');

  const result = setupCodexCli({
    cwd,
    applyHooks: true,
    hooksConfigPath: hooksPath
  });

  assert.equal(result.hooks.status, 'conflict');
  assert.equal(result.hooks.reason, 'invalid_hooks_json');
});

test('setupCodexCli global mode applies hooks to codex home by default path', () => {
  const cwd = tempProjectDir('global-hooks');
  const codexRoot = join(cwd, 'fake-codex-home');

  const result = setupCodexCli({
    cwd,
    global: true,
    applyHooks: true,
    codexHomePath: codexRoot
  });

  assert.equal(result.hooks.path, join(codexRoot, 'hooks.json'));
  assert.equal(result.hooks.status, 'created');
  const parsed = JSON.parse(readFileSync(result.hooks.path, 'utf8'));
  assert.ok(parsed.hooks.Stop);
});

test('shouldAutoSetupCodexCli only enables for global install by default', () => {
  const cwd = tempProjectDir('auto-check');

  assert.deepEqual(
    shouldAutoSetupCodexCli({
      cwd,
      env: {}
    }),
    { enabled: false, reason: 'not_global_install' }
  );

  assert.deepEqual(
    shouldAutoSetupCodexCli({
      cwd,
      env: { npm_config_global: 'true' }
    }),
    { enabled: true, reason: 'global_install' }
  );
});

test('shouldAutoSetupCodexCli skips repo checkouts and disabled environments', () => {
  const cwd = tempProjectDir('auto-skip');
  mkdirSync(join(cwd, '.git'));

  assert.deepEqual(
    shouldAutoSetupCodexCli({
      cwd,
      env: { npm_config_global: 'true' }
    }),
    { enabled: false, reason: 'repo_checkout' }
  );

  assert.deepEqual(
    shouldAutoSetupCodexCli({
      cwd: tempProjectDir('auto-disabled'),
      env: {
        npm_config_global: 'true',
        CODEX_MNEME_AUTO_SETUP: '0'
      }
    }),
    { enabled: false, reason: 'disabled_by_env' }
  );
});

test('autoSetupCodexCli applies global setup during global install', () => {
  const cwd = tempProjectDir('auto-apply');
  const codexRoot = join(cwd, 'fake-codex-home');

  const result = autoSetupCodexCli({
    cwd,
    env: { npm_config_global: 'true' },
    codexHomePath: codexRoot
  });

  assert.equal(result.status, 'applied');
  assert.equal(result.setup.scope, 'global');
  assert.equal(result.setup.skill.status, 'created');
  assert.equal(result.setup.agents.status, 'created');
  assert.equal(result.setup.config.status, 'created');
  assert.equal(result.setup.hooks.status, 'created');
  assert.equal(existsSync(join(codexRoot, 'skills', 'codex-mneme', 'SKILL.md')), true);
  assert.equal(existsSync(join(codexRoot, 'AGENTS.md')), true);
  assert.equal(existsSync(join(codexRoot, 'config.toml')), true);
  assert.equal(existsSync(join(codexRoot, 'hooks.json')), true);
});
