import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ensureDir } from './fs-utils.mjs';
import { codexHome } from './paths.mjs';

const SKILL_REL_PATH = '.agents/skills/codex-mneme/SKILL.md';
const GLOBAL_SKILL_REL_PATH = 'skills/codex-mneme/SKILL.md';
const AGENTS_REL_PATH = 'AGENTS.md';
const AGENTS_BLOCK_START = '<!-- codex-mneme:begin -->';
const AGENTS_BLOCK_END = '<!-- codex-mneme:end -->';
const CONFIG_REL_PATH = 'config.toml';
const CONFIG_BLOCK_START = '# codex-mneme:begin';
const CONFIG_BLOCK_END = '# codex-mneme:end';
const NOTIFY_KEY_PATTERN = /^\s*notify\s*=/m;

function normalizeNewlines(text) {
  return String(text || '').replace(/\r\n/g, '\n');
}

export function codexSkillTemplate({ command = 'codex-mneme' } = {}) {
  return `---
name: codex-mneme
description: Use codex-mneme for startup context, durable decisions, constraints, and todos in this project.
---
# codex-mneme

Use this workflow whenever project continuity matters.

## Startup
1. Run \`${command} session-start --limit 8\`.
2. Use the output as context before coding.

## During work
1. Record durable items with \`${command} remember --type decision|constraint|todo "<text>"\`.
2. Inspect existing memory with \`${command} remember list\`.

## Before handoff
1. Run \`${command} ingest\`.
2. Run \`${command} status\` when memory state looks wrong.
`;
}

export function codexAgentsBlockTemplate({
  command = 'codex-mneme',
  scope = 'project'
} = {}) {
  const scopeText = scope === 'global' ? 'in every project' : 'in this project';
  return `## Codex-Mneme Workflow
- At session start ${scopeText}, run \`${command} session-start --limit 8\` and use the output as working context.
- Record durable outcomes with \`${command} remember --type decision|constraint|todo "<text>"\`.
- Run \`${command} ingest\` before final handoff for substantial tasks.`;
}

function codexNotifyBody({ command = 'codex-mneme' } = {}) {
  return `# codex-mneme (optional): refresh memory after each Codex turn
notify = ["bash", "-lc", "${command} ingest >/dev/null 2>&1 || true"]`;
}

export function codexNotifySnippet({ command = 'codex-mneme' } = {}) {
  return `${CONFIG_BLOCK_START}
${codexNotifyBody({ command })}
${CONFIG_BLOCK_END}`;
}

function upsertManagedBlock(existingText, {
  startMarker,
  endMarker,
  block
}) {
  const source = normalizeNewlines(existingText);
  const managed = `${startMarker}\n${block.trimEnd()}\n${endMarker}`;
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);

  if (start >= 0 && end > start) {
    const before = source.slice(0, start).trimEnd();
    const after = source.slice(end + endMarker.length).trimStart();
    const parts = [];
    if (before) parts.push(before);
    parts.push(managed);
    if (after) parts.push(after);
    return `${parts.join('\n\n')}\n`;
  }

  const trimmed = source.trimEnd();
  if (!trimmed) return `${managed}\n`;
  return `${trimmed}\n\n${managed}\n`;
}

function writeIfChanged(path, content) {
  const normalized = normalizeNewlines(content);
  const exists = existsSync(path);
  if (exists) {
    const current = normalizeNewlines(readFileSync(path, 'utf8'));
    if (current === normalized) {
      return { status: 'unchanged', path };
    }
  }

  ensureDir(dirname(path));
  writeFileSync(path, normalized, 'utf8');
  return {
    status: exists ? 'updated' : 'created',
    path
  };
}

export function setupCodexCli({
  cwd = process.cwd(),
  force = false,
  withAgents = false,
  applyNotify = false,
  notifyConfigPath = '',
  global = false,
  codexHomePath = '',
  command = 'codex-mneme'
} = {}) {
  const projectRoot = resolve(cwd);
  const codexRoot = codexHomePath ? resolve(projectRoot, codexHomePath) : resolve(codexHome());
  const scope = global ? 'global' : 'project';
  const root = global ? codexRoot : projectRoot;
  const skillPath = resolve(root, global ? GLOBAL_SKILL_REL_PATH : SKILL_REL_PATH);
  const skillContent = codexSkillTemplate({ command });

  let skill;
  if (existsSync(skillPath) && !force) {
    skill = { status: 'exists', path: skillPath };
  } else {
    skill = writeIfChanged(skillPath, `${skillContent.trimEnd()}\n`);
  }

  const agentsPath = resolve(root, AGENTS_REL_PATH);
  let agents = { status: 'skipped', path: agentsPath };
  if (withAgents) {
    const existing = existsSync(agentsPath) ? readFileSync(agentsPath, 'utf8') : '';
    const next = upsertManagedBlock(existing, {
      startMarker: AGENTS_BLOCK_START,
      endMarker: AGENTS_BLOCK_END,
      block: codexAgentsBlockTemplate({ command, scope })
    });
    agents = writeIfChanged(agentsPath, next);
  }

  const configPath = notifyConfigPath
    ? resolve(root, notifyConfigPath)
    : resolve(codexRoot, CONFIG_REL_PATH);
  let config = { status: 'skipped', path: configPath };
  if (applyNotify) {
    const existing = existsSync(configPath) ? readFileSync(configPath, 'utf8') : '';
    const source = normalizeNewlines(existing);
    const hasManagedStart = source.includes(CONFIG_BLOCK_START);
    const hasManagedEnd = source.includes(CONFIG_BLOCK_END);

    if (hasManagedStart !== hasManagedEnd) {
      config = {
        status: 'conflict',
        path: configPath,
        reason: 'managed_block_incomplete'
      };
    } else if (!hasManagedStart && NOTIFY_KEY_PATTERN.test(source)) {
      config = {
        status: 'conflict',
        path: configPath,
        reason: 'existing_notify_setting'
      };
    } else {
      const next = upsertManagedBlock(source, {
        startMarker: CONFIG_BLOCK_START,
        endMarker: CONFIG_BLOCK_END,
        block: codexNotifyBody({ command })
      });
      config = writeIfChanged(configPath, next);
    }
  }

  return {
    scope,
    root,
    cwd: projectRoot,
    codexHome: codexRoot,
    skill,
    agents,
    config,
    notifySnippet: codexNotifySnippet({ command })
  };
}
