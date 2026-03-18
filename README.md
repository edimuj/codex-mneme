# codex-mneme

Lightweight memory layer for Codex CLI, built around the real session history in `~/.codex/sessions`.

## Why this exists

`claude-mneme` relies heavily on Claude hooks and transcript capture. For Codex, we can avoid that complexity by ingesting native Codex session logs and keeping a project-scoped memory index.

This gives us:
- less fragile capture (source of truth is Codex's own session JSONL)
- full turn history across sessions
- a simple "session start context" command

## MVP commands

- `codex-mneme ingest`
  - parse Codex sessions for the current project and append normalized turns to memory log
- `codex-mneme session-start`
  - print concise context (remembered notes + rolling summary for older history + grouped recent turns)
- `codex-mneme remember "..."`
  - store persistent project note
- `codex-mneme status`
  - show memory file counts and paths

## Install locally

```bash
cd ~/projects/oss/codex-mneme
npm link
```

## Usage

```bash
codex-mneme ingest
codex-mneme remember "Known limitation: only Claude is supported today"
codex-mneme session-start
```

## Notes about hooks

Codex currently exposes an experimental `codex_hooks` feature in source/tests with `SessionStart`, `UserPromptSubmit`, and `Stop` events.

For this repo, the base ingestion path does not depend on hooks. Hook support can be added later as an optional acceleration path.
