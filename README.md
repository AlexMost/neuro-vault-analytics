# neuro-vault-analytics

Claude Code plugin and standalone CLI that turns Claudian conversation records into a weekly usage-review note for the [neuro-vault](https://github.com/AlexMost/neuro-vault) project.

## What it does

Use `/analyze-vault-usage 7d` from inside a Claude Code session, or run `nv-analytics --period 7d` directly. The CLI computes deterministic aggregates (top tools, N+1 patterns, dead ends, cache-hit ratios, subagent budgets) over your Claudian conversation records; the skill hands the aggregates to Claude for pattern critique and writes an actionable note to `Inbox/neuro-vault-usage/YYYY-Www.md` in the vault.

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

Sample output (truncated):

```json
{
  "period": { "label": "7d", "startMs": 1745000000000, "endMs": 1745604800000 },
  "stats": { "sessionsTotal": 18, "sessionsVault": 12, "totalToolCalls": 84, "avgToolCallsPerSession": 7.0 },
  "aggregates": {
    "topTools": [{ "key": "mcp__neuro-vault-mcp__search_notes", "count": 31 }, ...],
    ...
  },
  "samples": [...],
  "warnings": []
}
```

## Where Claudian stores conversation records

Detailed record layout: see [`docs/architecture/claudian-records.md`](./docs/architecture/claudian-records.md).

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
