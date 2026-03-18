#!/usr/bin/env node

import { basename } from 'node:path';
import { ingestSessions } from './lib/ingest.mjs';
import {
  REMEMBER_TYPES,
  remember,
  listRemembered,
  editRemembered,
  forgetRemembered
} from './lib/remember.mjs';
import { handleHookEvent, hooksEnabled } from './lib/hooks.mjs';
import { projectPaths } from './lib/paths.mjs';
import { readJson, readJsonl } from './lib/fs-utils.mjs';
import { buildRecentTurns } from './lib/turns.mjs';
import { buildRollingSummary } from './lib/summary.mjs';
import { setupCodexCli } from './lib/codex-setup.mjs';

function usage() {
  console.log(`Usage:
  ${basename(process.argv[1])} ingest
  ${basename(process.argv[1])} session-start [--limit N]
  ${basename(process.argv[1])} remember [--type ${REMEMBER_TYPES.join('|')}] <content>
  ${basename(process.argv[1])} remember list
  ${basename(process.argv[1])} remember edit <id> [--type ${REMEMBER_TYPES.join('|')}] [content]
  ${basename(process.argv[1])} remember forget <id>
  ${basename(process.argv[1])} hook <SessionStart|UserPromptSubmit|Stop> [--text "..."]
  ${basename(process.argv[1])} codex-init [--with-agents] [--apply-notify] [--notify-config path] [--force] [--command name]
  ${basename(process.argv[1])} status`);
}

function parseLimit(args) {
  const idx = args.indexOf('--limit');
  if (idx === -1) return 12;
  const raw = args[idx + 1];
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return 12;
  return Math.min(n, 100);
}

function summarizeText(text, max = 240) {
  const oneLine = String(text).replace(/\s+/g, ' ').trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max - 1)}…`;
}

function formatTimestamp(value) {
  return String(value || '').replace('T', ' ').replace('Z', '');
}

function parseTypeOption(args, { defaultType = 'note' } = {}) {
  const rest = [];
  let type = defaultType;
  let hasType = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--type') {
      const value = args[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`--type requires a value (${REMEMBER_TYPES.join(', ')})`);
      }
      type = value;
      hasType = true;
      i += 1;
      continue;
    }
    rest.push(arg);
  }

  return { rest, type, hasType };
}

function parseTextOption(args) {
  const rest = [];
  let text = '';

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--text') {
      const value = args[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('--text requires a value');
      }
      text = value;
      i += 1;
      continue;
    }
    rest.push(arg);
  }

  if (!text && rest.length > 0) {
    text = rest.join(' ').trim();
  }

  return { text: String(text || '').trim() };
}

function parseCodexInitOptions(args) {
  const out = {
    withAgents: false,
    applyNotify: false,
    notifyConfigPath: '',
    force: false,
    command: 'codex-mneme'
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--with-agents') {
      out.withAgents = true;
      continue;
    }
    if (arg === '--apply-notify') {
      out.applyNotify = true;
      continue;
    }
    if (arg === '--notify-config') {
      const value = args[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('--notify-config requires a value');
      }
      out.notifyConfigPath = value;
      i += 1;
      continue;
    }
    if (arg === '--force') {
      out.force = true;
      continue;
    }
    if (arg === '--command') {
      const value = args[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('--command requires a value');
      }
      out.command = value;
      i += 1;
      continue;
    }
    throw new Error(`unknown option for codex-init: ${arg}`);
  }

  return out;
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);

  if (!cmd || cmd === '--help' || cmd === '-h') {
    usage();
    process.exit(0);
  }

  if (cmd === 'ingest') {
    const result = ingestSessions();
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (cmd === 'remember') {
    const sub = args[0];

    if (sub === 'list') {
      const result = listRemembered();
      if (result.entries.length === 0) {
        console.log('No remembered entries yet.');
        return;
      }

      console.log('Remembered entries:');
      for (const entry of result.entries) {
        const id = entry.id.slice(0, 8);
        const ts = formatTimestamp(entry.updatedAt || entry.timestamp);
        const content = summarizeText(entry.content, 180);
        const updatedLabel = entry.updatedAt ? 'updated' : 'created';
        console.log(`- ${id} [${entry.type}] ${content} (${updatedLabel} ${ts})`);
      }
      console.log('Use id prefix with `remember edit` or `remember forget`.');
      return;
    }

    if (sub === 'edit') {
      const id = String(args[1] || '').trim();
      if (!id) throw new Error('remember edit requires an id');

      const parsed = parseTypeOption(args.slice(2), { defaultType: 'note' });
      const content = parsed.rest.join(' ').trim();
      if (!parsed.hasType && !content) {
        throw new Error('remember edit requires new content and/or --type');
      }

      const result = editRemembered({
        id,
        ...(parsed.hasType ? { type: parsed.type } : {}),
        ...(content ? { content } : {})
      });
      console.log(`Updated ${result.entry.id.slice(0, 8)} [${result.entry.type}] ${result.entry.content}`);
      return;
    }

    if (sub === 'forget') {
      const id = String(args[1] || '').trim();
      if (!id) throw new Error('remember forget requires an id');
      const result = forgetRemembered({ id });
      console.log(`Forgot ${result.entry.id.slice(0, 8)} [${result.entry.type}] ${result.entry.content}`);
      return;
    }

    const addArgs = sub === 'add' ? args.slice(1) : args;
    const parsed = parseTypeOption(addArgs, { defaultType: 'note' });
    const content = parsed.rest.join(' ').trim();
    if (!content) throw new Error('remember needs content text');

    const result = remember({ type: parsed.type, content });
    console.log(`Remembered ${result.entry.id.slice(0, 8)} [${result.entry.type}] ${result.entry.content}`);
    return;
  }

  if (cmd === 'status') {
    const paths = projectPaths(process.cwd());
    const state = readJson(paths.state, { files: {} });
    const log = readJsonl(paths.log);
    const hooksLog = readJsonl(paths.hooks);
    const remembered = readJson(paths.remembered, []);
    console.log(JSON.stringify({
      project: paths.key,
      paths,
      hooksEnabled: hooksEnabled(),
      filesTracked: Object.keys(state.files || {}).length,
      pendingFiles: Array.isArray(state.pendingFiles) ? state.pendingFiles.length : 0,
      dirsTracked: state.dirs && typeof state.dirs === 'object' ? Object.keys(state.dirs).length : 0,
      logEntries: log.length,
      hookEvents: hooksLog.length,
      rememberedCount: Array.isArray(remembered) ? remembered.length : 0
    }, null, 2));
    return;
  }

  if (cmd === 'codex-init') {
    const options = parseCodexInitOptions(args);
    const result = setupCodexCli({
      cwd: process.cwd(),
      ...options
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (cmd === 'hook') {
    const event = args[0];
    if (!event) {
      throw new Error('hook requires an event: SessionStart | UserPromptSubmit | Stop');
    }
    const { text } = parseTextOption(args.slice(1));
    const result = handleHookEvent({
      event,
      text
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (cmd === 'session-start') {
    ingestSessions();
    const limit = parseLimit(args);
    const paths = projectPaths(process.cwd());
    const remembered = readJson(paths.remembered, []);
    const log = readJsonl(paths.log);
    const rollingSummary = buildRollingSummary(log, { recentTurnLimit: limit });
    const recentTurns = buildRecentTurns(log, { limit });

    console.log('# Codex-Mneme Context');

    if (Array.isArray(remembered) && remembered.length > 0) {
      console.log('\n## Remembered');
      for (const item of remembered) {
        const type = item?.type || 'note';
        const content = summarizeText(item?.content || '');
        if (content) console.log(`- [${type}] ${content}`);
      }
    }

    if (rollingSummary) {
      console.log('\n## Rolling Summary');
      console.log(`- Covers ${rollingSummary.summarizedTurns} older turns (latest ${rollingSummary.recentTurns} shown below).`);
      for (const item of rollingSummary.items) {
        console.log(`- ${item}`);
      }
    }

    if (recentTurns.length > 0) {
      console.log('\n## Recent Turns');
      for (const turn of recentTurns) {
        const ts = formatTimestamp(turn.timestamp);
        if (turn.user) {
          console.log(`- ${ts} user: ${summarizeText(turn.user, 180)}`);
        }
        if (turn.assistant.length > 0) {
          const assistantText = summarizeText(turn.assistant.join('\n'));
          console.log(`  ${ts} assistant: ${assistantText}`);
        }
      }
    }

    if (recentTurns.length === 0 && (!Array.isArray(remembered) || remembered.length === 0)) {
      console.log('\nNo project memory yet. Run `codex-mneme ingest` after some sessions.');
    }
    return;
  }

  usage();
  process.exit(1);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
