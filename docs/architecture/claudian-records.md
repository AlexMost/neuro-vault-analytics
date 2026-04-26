# Where Claudian stores conversation records

This is documented here so a future contributor (or future you) does not have to re-derive it from the Claudian source.

## Three locations

1. **Conversation metadata.** `{vault}/.claude/sessions/<convId>.meta.json` — one file per conversation. Contains `id`, `title`, `createdAt`, `updatedAt`, `currentNote`, `sessionId`, and a `usage` object with the model name and token breakdown including cache hits.

2. **Main message log + top-level tool calls.** `~/.claude/projects/<encoded-vault-path>/<sessionId>.jsonl` — Claude Code SDK's standard JSONL: one JSON object per line, with `type: 'user' | 'assistant' | …`, a `message` envelope and a `content[]` array of content blocks (`text`, `tool_use`, `tool_result`, …).

3. **Subagent traces.** `~/.claude/projects/<encoded-vault-path>/<sessionId>/subagents/agent-<agentId>.jsonl` — one sidecar per dispatched subagent, same SDK schema as the main log.

The encoded vault path is the absolute vault path with `/` replaced by `-`. For example, `/Users/me/Obsidian` → `-Users-me-Obsidian`. See `encodeVaultPath` in `src/config.ts`.

## Discovery contract

`discoverSessions({ vaultDir, projectsDir, period })`:

- Globs the metadata files and parses them.
- Drops anything outside the requested period (filtered on `meta.createdAt`).
- For each surviving meta, loads `<projectsDir>/<encoded>/<sessionId>.jsonl` if it exists, and any sidecars under `<projectsDir>/<encoded>/<sessionId>/subagents/`.
- A missing main log produces a warning, not an error — the session still flows downstream with an empty `mainLog`. The Claudian metadata is still useful for token accounting.

`projectsDir` is injected so tests can point it at a runtime tmpdir (see `test/fixtures/build-vault-fixture.ts`). In production it defaults to `~/.claude/projects`.
