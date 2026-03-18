import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function looksInjectedBootstrap(text) {
  return text.includes('# AGENTS.md instructions for ') || text.includes('<environment_context>');
}

function extractText(content, expectedType) {
  if (!Array.isArray(content)) return [];
  return content
    .filter((item) => item && item.type === expectedType && typeof item.text === 'string')
    .map((item) => item.text.trim())
    .filter(Boolean);
}

export function parseSessionFile(filePath, targetCwd) {
  const lines = readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
  const normalizedTarget = resolve(targetCwd);

  let sessionCwd = null;
  const entries = [];

  for (const line of lines) {
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    if (obj?.type === 'session_meta') {
      const cwd = obj?.payload?.cwd;
      if (typeof cwd === 'string') {
        sessionCwd = resolve(cwd);
      }
      continue;
    }

    if (obj?.type !== 'response_item') continue;
    if (obj?.payload?.type !== 'message') continue;

    const role = obj?.payload?.role;
    const timestamp = typeof obj?.timestamp === 'string' ? obj.timestamp : new Date().toISOString();

    if (role === 'user') {
      for (const text of extractText(obj.payload.content, 'input_text')) {
        if (looksInjectedBootstrap(text)) continue;
        entries.push({ timestamp, role: 'user', text, sourceFile: filePath });
      }
      continue;
    }

    if (role === 'assistant') {
      if (obj?.payload?.phase !== 'final_answer') continue;
      for (const text of extractText(obj.payload.content, 'output_text')) {
        entries.push({ timestamp, role: 'assistant', text, sourceFile: filePath });
      }
    }
  }

  return {
    matchesProject: sessionCwd === normalizedTarget,
    sessionCwd,
    entries
  };
}
