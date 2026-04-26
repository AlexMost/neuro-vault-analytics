# neuro-vault-analytics

Claude Code plugin and standalone CLI that turns Claudian conversation records into a weekly usage-review note for the [neuro-vault](https://github.com/AlexMost/neuro-vault) project.

> **Status:** scaffold only. Implementation tracked by the spec in [`docs/superpowers/specs/2026-04-26-usage-analytics-workflow-design.md`](./docs/superpowers/specs/2026-04-26-usage-analytics-workflow-design.md).

## What it does

- Reads conversation records produced by the [Claudian](https://github.com/iansinnott/claudian) Obsidian plugin.
- Aggregates them deterministically (tool counts, N+1 patterns, dead ends, cache-hit ratios, subagent budgets) in TypeScript.
- Hands a sampled report to the LLM via the `/analyze-vault-usage` skill, which writes an actionable note to `Inbox/neuro-vault-usage/YYYY-Www.md` in the vault.

The numeric work is deterministic CLI; the LLM is only used where it is genuinely valuable (pattern critique, suggestions).

## Install

```sh
/plugin install AlexMost/neuro-vault-analytics
```

The skill `/analyze-vault-usage` and CLI `nv-analytics` ship together — nothing extra to copy.

## Usage

From inside a Claude Code session in your vault:

```
/analyze-vault-usage 7d
```

Or directly from the shell:

```sh
nv-analytics --period 7d --vault ~/Obsidian --format json
```

## Where Claudian stores conversation records

Documented here so a future contributor (or future you) does not have to re-derive it:

- **Metadata:** `{vault}/.claude/sessions/{convId}.meta.json` — one file per conversation, with `sessionId`, `currentNote`, `usage` (tokens, cache breakdown).
- **Main message log:** `~/.claude/projects/{encoded-vault-path}/{sessionId}.jsonl` — standard Claude Code SDK JSONL with `tool_use` / `tool_result` blocks. `encoded-vault-path` is the absolute vault path with `/` → `-` (e.g. `/Users/me/Obsidian` → `-Users-me-Obsidian`).
- **Subagent traces:** `~/.claude/projects/{encoded-vault-path}/{sessionId}/subagents/agent-{agentId}.jsonl` — sidecar files, same SDK schema.

Discovery: glob the metadata files, join by `sessionId` against the SDK JSONL, then pick up any sidecars in the matching `subagents/` directory.

## Development

```sh
npm install
npm run dev -- --period 7d   # tsx, no build step
npm test
npm run lint
npm run build                # writes dist/cli.js — commit it before releasing
```

See [`AGENTS.md`](./AGENTS.md) for repository conventions and the plan/spec workflow.

## License

ISC.
