#!/usr/bin/env node

import { autoSetupCodexCli } from './lib/codex-setup.mjs';

function summarizeStatus(setup) {
  const parts = [
    `skill=${setup.skill.status}`,
    `agents=${setup.agents.status}`,
    `config=${setup.config.status}`,
    `hooks=${setup.hooks.status}`
  ];

  if (setup.config.status === 'conflict' && setup.config.reason) {
    parts.push(`configReason=${setup.config.reason}`);
  }
  if (setup.hooks.status === 'conflict' && setup.hooks.reason) {
    parts.push(`hooksReason=${setup.hooks.reason}`);
  }

  return parts.join(' ');
}

try {
  const result = autoSetupCodexCli();
  if (result.status !== 'applied') {
    process.exit(0);
  }

  console.error(`codex-mneme: applied global Codex setup (${summarizeStatus(result.setup)})`);

  if (result.setup.config.status === 'conflict') {
    console.error('codex-mneme: existing unmanaged Codex notify setting detected; left config.toml untouched.');
  }
  if (result.setup.hooks.status === 'conflict') {
    console.error('codex-mneme: existing hooks.json is invalid or incompatible; left hooks.json untouched.');
  }
} catch (error) {
  const message = error?.message || String(error);
  console.error(`codex-mneme: auto-setup skipped (${message})`);
}
