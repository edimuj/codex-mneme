function summarizeText(text, max = 240) {
  const oneLine = String(text || '').replace(/\s+/g, ' ').trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max - 1)}…`;
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
  rollingSummary = null,
  recentTurns = [],
  maxRecentChars = 0
} = {}) {
  const lines = ['# Codex-Mneme Context'];
  const recentMax = Number.isFinite(maxRecentChars) && maxRecentChars > 0 ? maxRecentChars : 0;
  const recentUserMax = recentMax || 180;
  const recentAssistantMax = recentMax || 240;

  if (Array.isArray(remembered) && remembered.length > 0) {
    lines.push('', '## Remembered');
    for (const item of remembered) {
      const type = item?.type || 'note';
      const content = summarizeText(item?.content || '');
      if (content) lines.push(`- [${type}] ${content}`);
    }
  }

  if (rollingSummary) {
    lines.push('', '## Rolling Summary');
    lines.push(`- Covers ${rollingSummary.summarizedTurns} older turns (latest ${rollingSummary.recentTurns} shown below).`);
    for (const item of rollingSummary.items || []) {
      lines.push(`- ${item}`);
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
