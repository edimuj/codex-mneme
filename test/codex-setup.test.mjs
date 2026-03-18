import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setupCodexCli } from '../src/lib/codex-setup.mjs';

function tempProjectDir(prefix) {
  return mkdtempSync(join(tmpdir(), `codex-mneme-codex-setup-${prefix}-`));
}

test('setupCodexCli creates project skill and returns notify snippet', () => {
  const cwd = tempProjectDir('skill');
  const result = setupCodexCli({ cwd });

  assert.equal(result.skill.status, 'created');
  assert.equal(result.agents.status, 'skipped');
  assert.ok(result.notifySnippet.includes('notify = ["bash", "-lc", "codex-mneme ingest >/dev/null 2>&1 || true"]'));
  assert.equal(existsSync(result.skill.path), true);

  const skillText = readFileSync(result.skill.path, 'utf8');
  assert.ok(skillText.includes('session-start --limit 8'));
  assert.ok(skillText.includes('remember --type decision|constraint|todo'));
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
