#!/usr/bin/env node

import { basename } from 'node:path';
import { ingestSessions } from './lib/ingest.mjs';
import { remember } from './lib/remember.mjs';
import { projectPaths } from './lib/paths.mjs';
import { readJson, readJsonl } from './lib/fs-utils.mjs';
import { buildRecentTurns } from './lib/turns.mjs';

function usage() {
  console.log(`Usage:
  ${basename(process.argv[1])} ingest
  ${basename(process.argv[1])} session-start [--limit N]
  ${basename(process.argv[1])} remember <content>
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
    const content = args.join(' ').trim();
    if (!content) {
      throw new Error('remember needs content text');
    }
    const result = remember({ type: 'note', content });
    console.log(`Remembered [${result.entry.type}] ${result.entry.content}`);
    return;
  }

  if (cmd === 'status') {
    const paths = projectPaths(process.cwd());
    const state = readJson(paths.state, { files: {} });
    const log = readJsonl(paths.log);
    const remembered = readJson(paths.remembered, []);
    console.log(JSON.stringify({
      project: paths.key,
      paths,
      filesTracked: Object.keys(state.files || {}).length,
      logEntries: log.length,
      rememberedCount: Array.isArray(remembered) ? remembered.length : 0
    }, null, 2));
    return;
  }

  if (cmd === 'session-start') {
    ingestSessions();
    const limit = parseLimit(args);
    const paths = projectPaths(process.cwd());
    const remembered = readJson(paths.remembered, []);
    const log = readJsonl(paths.log);
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
