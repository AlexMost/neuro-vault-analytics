# /analyze-vault-usage critique prompt

You are reviewing one week of Claude Code usage in a vault, based on a deterministic JSON report. Your job is to produce one Markdown file body — no preamble, no commentary outside the file.

## Inputs

`AnalyticsReport`:

```json
<<REPORT_JSON>>
```

## What to produce

A single Markdown body using exactly this structure:

```markdown
# Usage analytics <YYYY-Www>

## TL;DR

2-3 sentences. The most important takeaway, not a recap of numbers.

## Numbers

| Metric                     | Value                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------ |
| Sessions touching vault    | <sessionsVault> / <sessionsTotal>                                                                |
| Total tool calls           | <totalToolCalls>                                                                                 |
| Avg tool calls per session | <avgToolCallsPerSession.toFixed(1)>                                                              |
| Top tools                  | <comma-joined top 5 from aggregates.topTools, names without the `mcp__neuro-vault-mcp__` prefix> |
| Unused tools               | <comma-joined aggregates.unusedTools, names without prefix; "none" if empty>                     |
| Stale-path errors          | <aggregates.stalePathErrors.length>                                                              |
| Dead ends                  | <aggregates.deadEndCount>                                                                        |

## Patterns observed

### High-value patterns

For every entry in `aggregates.topSequences` whose `count >= 2`, decide if it suggests something. Mention only the ones that do, with reasoning. Cite session ids from `sessionIds` so the user can verify.

### Dead ends

Walk `samples` and identify sessions where the agent retried the same tool or finished with `outcome: dead_end`. Quote the symptom briefly.

## Suggestions

Group into three subsections — emit only those that have content. Each entry: `[CONFIDENCE | N sessions] **Title** — one-line action.`

### MCP features

Things the neuro-vault MCP server should expose or change. The N+1 read pattern is a flag for a `query` tool; large-result tools are flags for projection.

### Vault structure

Things in the vault itself: tag inconsistency, duplicate notes, missing properties.

### Prompt tuning

Things to add to AGENTS.md or CLAUDE.md so the agent works better next time.

## Raw aggregates

<details>
Top tools, top 2- and 3-grams, stale-path hits, cache-hit distribution, subagent budget — verbatim from the report. The user (or a future analyzer) can use this to verify your interpretation.
</details>
```

## Style rules

- Cite evidence by session id, e.g. "(sessions: conv-A, conv-D)". Do not fabricate sessions.
- If a section has no genuine content, omit the section. Do not pad. "Nothing critical" is a valid week.
- Keep entries short. Each suggestion is one sentence.
- Confidence levels: `HIGH` ≥ 5 supporting sessions, `MED` 2-4, `LOW` 1.
