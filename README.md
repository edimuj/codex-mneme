# codex-mneme

Lightweight memory layer for Codex CLI, built around the real session history in `~/.codex/sessions`.

## Why this exists

`claude-mneme` relies heavily on Claude hooks and transcript capture. For Codex, we can avoid that complexity by ingesting native Codex session logs and keeping a project-scoped memory index.

This gives us:
- less fragile capture (source of truth is Codex's own session JSONL)
- full turn history across sessions
- a simple "session start context" command

## What shipped

- Higher-quality startup context:
  - chronological turn grouping
  - low-value acknowledgement trimming
  - rolling summary for older turns + recent-turn focus
- Typed project memory semantics:
  - `note`, `decision`, `constraint`, `todo`
  - list/edit/forget flows with id-prefix targeting
  - legacy `remembered.json` entries auto-normalized
- Incremental bounded ingest:
  - cached directory metadata to avoid repeated full directory reads
  - bounded work per ingest run with deferred backlog drain
  - known-file hot-set + rotating checks for append detection

## CLI commands

- `codex-mneme ingest`
  - incrementally parse Codex sessions for the current project and append normalized turns to memory log
  - work is bounded per run; large backlogs are deferred and drained on subsequent ingests
- `codex-mneme session-start`
  - print concise context (remembered notes + rolling summary for older history + grouped recent turns)
- `codex-mneme remember [--type note|decision|constraint|todo] "..."`
  - store persistent typed project memory entry
- `codex-mneme remember list`
  - list remembered entries with id prefixes
- `codex-mneme remember edit <id> [--type note|decision|constraint|todo] [content]`
  - edit remembered content and/or type
- `codex-mneme remember forget <id>`
  - remove a remembered entry
- `codex-mneme hook <SessionStart|UserPromptSubmit|Stop> [--text "..."]`
  - optional hook entrypoint for Codex hook events (disabled by default)
  - only active when `CODEX_MNEME_ENABLE_HOOKS=1`
  - `SessionStart`/`Stop` trigger normal history ingest; `UserPromptSubmit` records hook signal only
- `codex-mneme status`
  - show memory file counts, ingest backlog stats, hook status, and project paths

## Install locally

```bash
cd ~/projects/oss/codex-mneme
npm link
```

## Usage

```bash
codex-mneme ingest
codex-mneme remember --type decision "Log JSONL is the canonical source"
codex-mneme remember list
codex-mneme remember edit <id-prefix> --type constraint
codex-mneme remember forget <id-prefix>
codex-mneme session-start
codex-mneme status
```

## Notes about hooks

Codex currently exposes an experimental `codex_hooks` feature in source/tests with `SessionStart`, `UserPromptSubmit`, and `Stop` events.

For this repo, history ingest remains canonical and hooks are opt-in acceleration only.

Enable hooks:

```bash
export CODEX_MNEME_ENABLE_HOOKS=1
codex-mneme hook SessionStart
codex-mneme hook UserPromptSubmit --text "Investigate ingest performance"
codex-mneme hook Stop
```
