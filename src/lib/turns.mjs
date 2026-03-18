function toEpochMs(timestamp) {
  const ms = Date.parse(timestamp);
  if (Number.isNaN(ms)) return Number.MAX_SAFE_INTEGER;
  return ms;
}

function normalize(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function isLowValueUserText(text) {
  const normalized = normalize(text).toLowerCase().replace(/[.!?]+$/g, '').trim();
  if (!normalized) return true;
  return /^(ok|okay|thanks|thank you|great|perfect|cool|nice|awesome|yep|yes|sure|sounds good|looks good|go ahead|please do|done)$/.test(normalized);
}

function isLowValueAssistantText(text) {
  const normalized = normalize(text).toLowerCase().replace(/[.!?]+$/g, '').trim();
  if (!normalized) return true;
  return /^(you'?re welcome|you are welcome|no problem|glad to help|happy to help|my pleasure)$/.test(normalized);
}

function sortEntries(entries) {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const byTime = toEpochMs(a.entry.timestamp) - toEpochMs(b.entry.timestamp);
      if (byTime !== 0) return byTime;

      const roleRankA = a.entry.role === 'user' ? 0 : 1;
      const roleRankB = b.entry.role === 'user' ? 0 : 1;
      if (roleRankA !== roleRankB) return roleRankA - roleRankB;

      return a.index - b.index;
    })
    .map(({ entry }) => entry);
}

export function buildRecentTurns(entries, { limit = 12 } = {}) {
  const turns = [];
  const sorted = sortEntries(entries);
  let current = null;

  for (const entry of sorted) {
    const role = entry?.role;
    const text = normalize(entry?.text);
    if (!text) continue;

    if (role === 'user') {
      if (isLowValueUserText(text)) continue;
      current = {
        timestamp: entry.timestamp,
        user: text,
        assistant: []
      };
      turns.push(current);
      continue;
    }

    if (role === 'assistant') {
      if (isLowValueAssistantText(text)) continue;
      if (!current) {
        current = {
          timestamp: entry.timestamp,
          user: '',
          assistant: [text]
        };
        turns.push(current);
        continue;
      }
      current.assistant.push(text);
    }
  }

  if (turns.length <= limit) return turns;
  return turns.slice(-limit);
}
