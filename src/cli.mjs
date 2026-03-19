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
import { readJson, readJsonl, writeJsonAtomic } from './lib/fs-utils.mjs';
import { buildRecentTurns } from './lib/turns.mjs';
import { buildRollingSummary } from './lib/summary.mjs';
import { buildAiRollingSummary } from './lib/ai-summary.mjs';
import { buildSessionStartOutput, clipOutput } from './lib/session-start-render.mjs';
import { setupCodexCli } from './lib/codex-setup.mjs';

const AI_SUMMARY_CACHE_VERSION = 1;

function usage() {
  console.log(`Usage:
  ${basename(process.argv[1])} ingest
  ${basename(process.argv[1])} session-start [--limit N] [--max-summary-items N] [--max-recent-chars N] [--max-output-chars N] [--summary-mode deterministic|ai|off] [--summary-model MODEL] [--summary-input-chars N] [--summary-timeout-ms N] [--summary-item-chars N]
  ${basename(process.argv[1])} remember [--type ${REMEMBER_TYPES.join('|')}] <content>
  ${basename(process.argv[1])} remember list
  ${basename(process.argv[1])} remember edit <id> [--type ${REMEMBER_TYPES.join('|')}] [content]
  ${basename(process.argv[1])} remember forget <id>
  ${basename(process.argv[1])} hook <SessionStart|UserPromptSubmit|Stop> [--text "..."]
  ${basename(process.argv[1])} codex-init [--global] [--with-agents] [--apply-notify] [--notify-config path] [--force] [--command name]
  ${basename(process.argv[1])} status`);
}

function readNumberOption(args, index, name, {
  fallback,
  min = 1,
  max = Number.MAX_SAFE_INTEGER
}) {
  const raw = args[index + 1];
  if (!raw || raw.startsWith('--')) {
    throw new Error(`${name} requires a value`);
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < min) return fallback;
  return Math.min(n, max);
}

function readStringOption(args, index, name) {
  const raw = args[index + 1];
  if (!raw || raw.startsWith('--')) {
    throw new Error(`${name} requires a value`);
  }
  return raw;
}

function parseSessionStartOptions(args) {
  const out = {
    limit: 12,
    maxSummaryItems: 6,
    maxRecentChars: 0,
    maxOutputChars: 0,
    summaryMode: 'deterministic',
    summaryModel: 'gpt-5.4-mini',
    summaryInputChars: 12000,
    summaryTimeoutMs: 45000,
    summaryItemChars: 220
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--limit') {
      out.limit = readNumberOption(args, i, '--limit', {
        fallback: 12,
        min: 1,
        max: 100
      });
      i += 1;
      continue;
    }
    if (arg === '--max-summary-items') {
      out.maxSummaryItems = readNumberOption(args, i, '--max-summary-items', {
        fallback: 6,
        min: 0,
        max: 200
      });
      i += 1;
      continue;
    }
    if (arg === '--max-recent-chars') {
      out.maxRecentChars = readNumberOption(args, i, '--max-recent-chars', {
        fallback: 0,
        min: 0,
        max: 2000
      });
      i += 1;
      continue;
    }
    if (arg === '--max-output-chars') {
      out.maxOutputChars = readNumberOption(args, i, '--max-output-chars', {
        fallback: 0,
        min: 0,
        max: 200000
      });
      i += 1;
      continue;
    }
    if (arg === '--summary-mode') {
      const mode = readStringOption(args, i, '--summary-mode').toLowerCase();
      if (!['deterministic', 'ai', 'off'].includes(mode)) {
        throw new Error('--summary-mode must be one of: deterministic, ai, off');
      }
      out.summaryMode = mode;
      i += 1;
      continue;
    }
    if (arg === '--summary-model') {
      out.summaryModel = readStringOption(args, i, '--summary-model');
      i += 1;
      continue;
    }
    if (arg === '--summary-input-chars') {
      out.summaryInputChars = readNumberOption(args, i, '--summary-input-chars', {
        fallback: 12000,
        min: 0,
        max: 200000
      });
      i += 1;
      continue;
    }
    if (arg === '--summary-timeout-ms') {
      out.summaryTimeoutMs = readNumberOption(args, i, '--summary-timeout-ms', {
        fallback: 45000,
        min: 1000,
        max: 300000
      });
      i += 1;
      continue;
    }
    if (arg === '--summary-item-chars') {
      out.summaryItemChars = readNumberOption(args, i, '--summary-item-chars', {
        fallback: 220,
        min: 40,
        max: 2000
      });
      i += 1;
    }
  }

  return out;
}

function summarizeText(text, max = 240) {
  const oneLine = String(text).replace(/\s+/g, ' ').trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max - 1)}…`;
}

function readAiSummaryCache(path, { cacheKey }) {
  const cache = readJson(path, null);
  if (!cache || typeof cache !== 'object') return null;
  if (cache.version !== AI_SUMMARY_CACHE_VERSION) return null;
  if (cache.cacheKey !== cacheKey) return null;
  if (!Array.isArray(cache.items)) return null;
  return cache.items;
}

function writeAiSummaryCache(path, {
  cacheKey,
  model,
  items
}) {
  writeJsonAtomic(path, {
    version: AI_SUMMARY_CACHE_VERSION,
    cacheKey,
    model,
    items: Array.isArray(items) ? items : [],
    updatedAt: new Date().toISOString()
  });
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
    global: false,
    withAgents: false,
    applyNotify: false,
    notifyConfigPath: '',
    force: false,
    command: 'codex-mneme'
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--global') {
      out.global = true;
      continue;
    }
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
    const options = parseSessionStartOptions(args);
    ingestSessions();
    const paths = projectPaths(process.cwd());
    const remembered = readJson(paths.remembered, []);
    const log = readJsonl(paths.log);
    let rollingSummary = null;
    let summaryNotice = '';

    if (options.summaryMode !== 'off') {
      if (options.summaryMode === 'ai') {
        try {
          rollingSummary = buildAiRollingSummary(log, {
            recentTurnLimit: options.limit,
            maxItems: options.maxSummaryItems,
            model: options.summaryModel,
            maxInputChars: options.summaryInputChars,
            timeoutMs: options.summaryTimeoutMs,
            itemMaxChars: options.summaryItemChars
          }, {
            readCache: ({ cacheKey }) => readAiSummaryCache(paths.summaryCache, { cacheKey }),
            writeCache: ({ cacheKey, model, items }) => writeAiSummaryCache(paths.summaryCache, {
              cacheKey,
              model,
              items
            })
          });
        } catch (error) {
          const reason = summarizeText(error?.message || 'unknown error', 140);
          summaryNotice = `AI summary unavailable (${reason}); using deterministic summary.`;
        }
      }

      if (!rollingSummary) {
        rollingSummary = buildRollingSummary(log, {
          recentTurnLimit: options.limit,
          maxItems: options.maxSummaryItems
        });
      }
    }

    const recentTurns = buildRecentTurns(log, { limit: options.limit });

    const output = buildSessionStartOutput({
      remembered,
      rollingSummary,
      recentTurns,
      maxRecentChars: options.maxRecentChars,
      summaryNotice
    });
    console.log(clipOutput(output, options.maxOutputChars));
    return;
  }

  usage();
  process.exit(1);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
