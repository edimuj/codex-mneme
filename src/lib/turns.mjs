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

function asArray(value) {
  return Array.isArray(value) ? value : [];
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

export function buildRecentHookTurns(entries, { limit = 8 } = {}) {
  const hooks = asArray(entries)
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => ({
      timestamp: String(entry.timestamp || ''),
      event: String(entry.event || '').trim(),
      text: normalize(entry.text || ''),
      turnKey: String(entry.turnKey || '').trim(),
      sessionId: String(entry.sessionId || '').trim(),
      turnId: String(entry.turnId || '').trim()
    }))
    .filter((entry) => entry.event);

  if (hooks.length === 0) return [];

  const grouped = new Map();

  for (const entry of hooks) {
    const key = entry.turnKey || (entry.sessionId && entry.turnId ? `${entry.sessionId}:${entry.turnId}` : '');
    if (!key) continue;

    let bucket = grouped.get(key);
    if (!bucket) {
      bucket = {
        turnKey: key,
        timestamp: entry.timestamp,
        sortTs: toEpochMs(entry.timestamp),
        events: [],
        eventSet: new Set(),
        prompt: '',
        tools: [],
        toolSet: new Set(),
        outcome: ''
      };
      grouped.set(key, bucket);
    }

    const ts = toEpochMs(entry.timestamp);
    if (ts >= bucket.sortTs) {
      bucket.sortTs = ts;
      bucket.timestamp = entry.timestamp;
    }

    if (entry.event && !bucket.eventSet.has(entry.event)) {
      bucket.eventSet.add(entry.event);
      bucket.events.push(entry.event);
    }

    if (entry.event === 'UserPromptSubmit' && entry.text && !bucket.prompt) {
      bucket.prompt = entry.text;
    }

    if ((entry.event === 'PreToolUse' || entry.event === 'PostToolUse') && entry.text && !bucket.toolSet.has(entry.text)) {
      bucket.toolSet.add(entry.text);
      bucket.tools.push(entry.text);
    }

    if (entry.event === 'Stop' && entry.text) {
      bucket.outcome = entry.text;
    }
  }

  const turns = [...grouped.values()]
    .sort((a, b) => a.sortTs - b.sortTs)
    .map((bucket) => ({
      timestamp: bucket.timestamp,
      turnKey: bucket.turnKey,
      events: bucket.events,
      prompt: bucket.prompt,
      tools: bucket.tools,
      outcome: bucket.outcome
    }));

  if (turns.length <= limit) return turns;
  return turns.slice(-limit);
}
