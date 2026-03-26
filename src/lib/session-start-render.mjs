function summarizeText(text, max = 240) {
  const oneLine = String(text || '').replace(/\s+/g, ' ').trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max - 1)}…`;
}

const REMEMBER_PRIORITY = {
  constraint: 0,
  todo: 1,
  decision: 2,
  note: 3
};

function parseEpoch(value) {
  const ts = Date.parse(String(value || ''));
  return Number.isFinite(ts) ? ts : 0;
}

export function selectRememberedItems(remembered, { maxItems = 0 } = {}) {
  const list = Array.isArray(remembered) ? remembered : [];
  const normalized = list
    .filter((item) => item && typeof item === 'object')
    .map((item, index) => {
      const type = String(item.type || 'note').toLowerCase();
      const content = String(item.content || '').trim();
      const priority = Object.hasOwn(REMEMBER_PRIORITY, type)
        ? REMEMBER_PRIORITY[type]
        : REMEMBER_PRIORITY.note;
      const sortTs = parseEpoch(item.updatedAt || item.timestamp);
      return {
        item: { ...item, type, content },
        priority,
        sortTs,
        index
      };
    })
    .filter(({ item }) => Boolean(item.content))
    .sort((a, b) => {
      const byPriority = a.priority - b.priority;
      if (byPriority !== 0) return byPriority;
      const byTs = b.sortTs - a.sortTs;
      if (byTs !== 0) return byTs;
      return a.index - b.index;
    });

  const cap = Number.isFinite(maxItems) ? maxItems : Number.parseInt(String(maxItems || '0'), 10);
  const bounded = cap > 0 ? normalized.slice(0, cap) : normalized;

  return {
    total: normalized.length,
    omitted: Math.max(0, normalized.length - bounded.length),
    items: bounded.map(({ item }) => item)
  };
}

export function clipOutput(text, maxChars = 0) {
  const source = String(text || '');
  const n = Number.parseInt(String(maxChars || '0'), 10);
  if (!Number.isFinite(n) || n <= 0) return source;
  if (source.length <= n) return source;
  if (n === 1) return '…';
  return `${source.slice(0, n - 1)}…`;
}

export function buildSessionStartOutput({
  remembered = [],
  rememberedNotice = '',
  rollingSummary = null,
  recentTurns = [],
  maxRecentChars = 0,
  summaryNotice = ''
} = {}) {
  const lines = ['# Codex-Mneme Context'];
  const recentMax = Number.isFinite(maxRecentChars) && maxRecentChars > 0 ? maxRecentChars : 0;
  const recentUserMax = recentMax || 180;
  const recentAssistantMax = recentMax || 240;

  if (Array.isArray(remembered) && remembered.length > 0) {
    lines.push('', '## Remembered');
    if (rememberedNotice) {
      lines.push(`- ${rememberedNotice}`);
    }
    for (const item of remembered) {
      const type = item?.type || 'note';
      const content = summarizeText(item?.content || '');
      if (content) lines.push(`- [${type}] ${content}`);
    }
  }

  if (rollingSummary || summaryNotice) {
    lines.push('', '## Rolling Summary');
    if (summaryNotice) {
      lines.push(`- ${summaryNotice}`);
    }
    if (rollingSummary) {
      if (rollingSummary.source === 'ai') {
        const model = rollingSummary.model ? ` (${rollingSummary.model})` : '';
        const cache = rollingSummary.cached ? ' [cache hit]' : '';
        lines.push(`- Source: AI via codex exec${model}${cache}.`);
      } else {
        lines.push('- Source: deterministic heuristic.');
      }
      lines.push(`- Covers ${rollingSummary.summarizedTurns} older turns (latest ${rollingSummary.recentTurns} shown below).`);
      for (const item of rollingSummary.items || []) {
        lines.push(`- ${item}`);
      }
    }
  }

  if (Array.isArray(recentTurns) && recentTurns.length > 0) {
    lines.push('', '## Recent Turns');
    for (const turn of recentTurns) {
      const ts = String(turn.timestamp || '').replace('T', ' ').replace('Z', '');
      if (turn.user) {
        lines.push(`- ${ts} user: ${summarizeText(turn.user, recentUserMax)}`);
      }
      if (Array.isArray(turn.assistant) && turn.assistant.length > 0) {
        lines.push(`  ${ts} assistant: ${summarizeText(turn.assistant.join('\n'), recentAssistantMax)}`);
      }
    }
  }

  if ((recentTurns || []).length === 0 && (!Array.isArray(remembered) || remembered.length === 0)) {
    lines.push('', 'No project memory yet. Run `codex-mneme ingest` after some sessions.');
  }

  return lines.join('\n');
}
