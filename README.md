# codex-mneme

Project memory for Codex CLI.

`codex-mneme` turns raw Codex session history into concise, project-scoped startup context so a fresh session can pick up where the last one left off.

It is built around Codex's native session logs in `~/.codex/sessions`, not a fragile hook-only transcript pipeline.

## Why this exists

Codex is good at the current turn. Long-running project continuity is the harder part.

Important decisions, constraints, and half-finished work end up buried across old sessions. When you come back later, you either re-read history manually or rely on memory and vibes. Both are bad.

`codex-mneme` solves that by:

- ingesting Codex's real session JSONL history
- keeping memory scoped to the current project
- rendering a compact `session-start` brief for the next session
- letting you persist durable project facts as typed memory entries
- working without any external service for the core flow

## What you get

- Project-scoped memory built from native Codex session history
- Concise startup context with remembered items, rolling summary, and recent turns
- Typed durable memory: `note`, `decision`, `constraint`, `todo`
- Incremental, bounded ingest for large session histories
- Optional AI summaries through your local Codex CLI auth
- Optional hook integration, while keeping history ingest as the canonical path
- Codex-native setup via `codex-init`

## Install

Recommended:

```bash
npm install -g codex-mneme
```

On global install, `codex-mneme` now attempts to auto-configure Codex for you by:

- installing the global `codex-mneme` skill in `~/.codex/skills/`
- inserting a managed global `~/.codex/AGENTS.md` workflow block
- inserting a managed `notify` block in `~/.codex/config.toml` when there is no conflicting unmanaged `notify` setting

If you want to disable install-time setup, use:

```bash
CODEX_MNEME_AUTO_SETUP=0 npm install -g codex-mneme
```

Run without installing globally:

```bash
npx --yes npm:codex-mneme@latest status
```

From source:

```bash
git clone https://github.com/edimuj/codex-mneme.git
cd codex-mneme
npm install
npm link
```

## Quick start

1. Install `codex-mneme`.
2. Global install should auto-configure Codex. If you want to apply or re-apply it manually:

```bash
codex-mneme codex-init --global --with-agents --apply-notify
```

3. Generate startup context for the current project:

```bash
codex-mneme session-start --limit 8
```

4. Save durable project memory when something should survive future sessions:

```bash
codex-mneme remember --type decision "Session JSONL is the canonical source of truth"
codex-mneme remember --type constraint "Do not depend on hooks for correctness"
```

5. Refresh memory from recent Codex sessions:

```bash
codex-mneme ingest
```

## Example workflow

Resume work on a project:

```bash
codex-mneme session-start --limit 8 --max-summary-items 5 --max-remembered-items 10
```

Capture an important decision:

```bash
codex-mneme remember --type decision "Use deterministic summaries by default"
```

Check what is currently stored:

```bash
codex-mneme remember list
codex-mneme status
```

Use AI summaries when you want better compression:

```bash
codex login
codex-mneme session-start --summary-mode ai --summary-model gpt-5.4-mini
```

Representative `session-start` output:

```text
# Codex-Mneme Context

## Remembered
- [decision] Session JSONL is the canonical source of truth.
- [constraint] Do not depend on hooks for correctness.

## Rolling Summary
- [2026-03-18] Added bounded ingest and deferred backlog draining.
- [2026-03-19] Shipped AI summary caching and deterministic output caps.

## Recent Turns
- 2026-03-19 09:12:21 user: Let's improve the README so people actually want to try this.
  2026-03-19 09:12:21 assistant: Plan: rewrite positioning, install, quick start, and command overview.
```

## CLI overview

| Command | What it does |
| --- | --- |
| `codex-mneme ingest` | Parse Codex sessions for the current project and update the normalized memory log. |
| `codex-mneme session-start` | Print startup context: remembered entries, rolling summary, and recent turns. |
| `codex-mneme remember` | Save a durable project memory entry. |
| `codex-mneme remember list` | List remembered entries with id prefixes. |
| `codex-mneme remember edit` | Edit remembered content and/or type. |
| `codex-mneme remember forget` | Remove a remembered entry. |
| `codex-mneme hook` | Optional hook entrypoint for Codex hook events. |
| `codex-mneme codex-init` | Scaffold Codex integration files for project or global setup. |
| `codex-mneme status` | Show memory paths, tracked files, backlog state, and hook status. |

Most useful `session-start` flags:

| Flag | Purpose |
| --- | --- |
| `--limit N` | Number of recent turns to show. |
| `--max-summary-items N` | Cap rolling summary bullets. |
| `--max-remembered-items N` | Cap remembered entries shown (prioritized by type, then recency). |
| `--max-recent-chars N` | Cap text length per recent turn line. |
| `--max-output-chars N` | Hard cap final output size. |
| `--summary-mode deterministic|ai|off` | Choose summary engine. |
| `--summary-model MODEL` | Model used for AI summaries. |
| `--summary-input-chars N` | Cap prompt size sent to the AI summarizer. |
| `--summary-timeout-ms N` | Timeout for AI summarization. |
| `--summary-item-chars N` | Cap length of each AI summary item. |

## Recommended Codex setup

Global install should handle this automatically. If you want to run it manually or re-apply it:

```bash
codex-mneme codex-init --global --with-agents --apply-notify
```

That setup:

- creates `~/.codex/skills/codex-mneme/SKILL.md`
- inserts or updates a managed `~/.codex/AGENTS.md` block
- inserts or updates a managed `notify` block in `~/.codex/config.toml`

For a project-local setup instead:

```bash
codex-mneme codex-init --with-agents --apply-notify
```

## AI summaries

By default, `session-start` uses deterministic summarization. That keeps the core workflow local, cheap, and predictable.

If you have Codex CLI auth and want better compression for long histories, enable AI summaries:

```bash
codex login
codex-mneme session-start --summary-mode ai --summary-model gpt-5.4-mini
```

Notes:

- AI mode calls `codex exec` non-interactively
- output is schema-constrained with `--output-schema`
- summaries are cached when the effective inputs are unchanged
- if auth, quota, or runtime fails, it falls back to deterministic summary automatically

## Hooks are optional

`codex-mneme` supports Codex hook events, but hooks are not required for correctness.

History ingest remains the canonical path. Hooks are an opt-in acceleration layer.

Enable them explicitly:

```bash
export CODEX_MNEME_ENABLE_HOOKS=1
codex-mneme hook SessionStart
codex-mneme hook UserPromptSubmit --text "Investigate ingest performance"
codex-mneme hook Stop
```

## How it works

At a high level:

1. Read Codex session `.jsonl` files from `~/.codex/sessions`.
2. Scope entries to the current project using `session_meta.payload.cwd`.
3. Normalize useful user and final assistant turns into a project memory log.
4. Store durable remembered items separately.
5. Render a short startup brief for the next session.

Project memory is stored under:

```text
~/.codex-mneme/projects/<project-key>/
```

That directory contains the normalized log, remembered items, ingest state, optional hook events, and optional AI summary cache.

## Development

```bash
git clone https://github.com/edimuj/codex-mneme.git
cd codex-mneme
npm install
npm test
node src/cli.mjs session-start --limit 8
node src/cli.mjs status
```

## License

MIT
