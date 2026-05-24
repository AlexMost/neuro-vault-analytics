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

## Cross-project sessions (no Claudian metadata)

The analyzer also reads SDK JSONLs from project directories outside the encoded vault path — sessions started from external repositories (`catalog-ui`, `neuro-vault`, …) that nonetheless called the neuro-vault MCP. These have no `.meta.json` companion: Claudian only writes metadata for conversations started from inside the vault.

`discoverExternalSessions({ projectsDir, vaultProject, period })`:

- Walks every entry in `projectsDir` except the one matching the encoded vault path.
- For each `<sessionId>.jsonl` file under an external project: drops it if mtime is before `period.startMs` (coarse), reads it, drops it if no `mcp__neuro-vault__*` tool call appears in the main log or any subagent sidecar, then drops it if the first parseable line `timestamp` falls outside the period (refine).
- Returns a `DiscoveredExternal` with `sessionId`, `project` (encoded dir name), `mtimeMs`, `mainLog`, and discovered subagent sidecars.

`toSessionSummaryFromExternal(d)` derives the `SessionSummary` shape from JSONL alone — see the table in [`docs/superpowers/specs/2026-05-24-cross-project-breakdown-design.md`](../superpowers/specs/2026-05-24-cross-project-breakdown-design.md) for the exact derivation rules. The notable degraded fields are `currentNote` (always `null`) and `contextPercentage` (always `0`); per-turn `usage` blocks in the JSONL are summed to recover `cacheHitRatio`.
