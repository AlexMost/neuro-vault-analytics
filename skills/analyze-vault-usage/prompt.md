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
# Usage analytics <label>

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

Group into three subsections — emit only those that have content. Each entry uses one of these formats:

```
[CONFIDENCE | N sessions | ~XXX KB/run] **Title** — one-line action.
[REQUIRES_VERIFICATION | N sessions] **Title** — one-line action; verification needed because <one phrase>.
[BLOCKED: insufficient data — observed N sessions over P days] **Title** — what evidence is missing.
```

Where:

- `CONFIDENCE` is `HIGH`, `MED`, or `LOW`.
- `N sessions` is the count of sample sessions exhibiting the pattern.
- `~XXX KB/run` is your byte-cost estimate, derived from `aggregates.largestResultTools` (avg result size) × the relevant frequency (from `topTools` or `topSequences`). Show the arithmetic in one parenthetical: `(~12 KB × 4 calls/session ≈ 48 KB/run)`.

### Required guards

1. **Cost-grounded confidence.** A `[HIGH]` entry MUST include a `~XXX KB/run` figure. If you cannot produce one from the report, the recommendation is at most `[MED]`. If you also cannot justify `[MED]`, downgrade to `[LOW]` or drop it.

2. **Premature-drop guard.** Before emitting any of: "drop X", "remove X", "deprecate X", "X is unused", verify BOTH:
   - `(period.endMs - period.startMs) / 86400000 >= 14`, AND
   - at least 3 distinct working sessions in `samples` lacked X.

   Otherwise the entry MUST use the `[BLOCKED: insufficient data — observed N sessions over P days]` format. Do NOT emit `[LOW]` for these — the issue is missing evidence, not weak evidence.

3. **Replace-X self-check.** Before emitting any "replace X with Y" or "use Y instead of X" recommendation, walk this checklist:
   - Is Y demonstrably cheaper on this workload, given `aggregates.largestResultTools`?
   - What asymmetries apply? (Examples: `Edit` ships a diff while `Write` ships the full file; a narrow tool has less prelude per call but may need more calls.)

   If the cost mechanic is not obvious from the report or you have not verified it, tag the recommendation `[REQUIRES_VERIFICATION]` instead of a confidence tier.

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
- Confidence levels: `HIGH` ≥ 5 supporting sessions AND a KB/run figure; `MED` 2–4 sessions; `LOW` 1 session.
- One sample's `toolCallSummary` may have `mcpCalls = []` — that is a valid vault-relevant session anchored by `currentNote` or wikilinks. Do not assume samples are MCP-heavy; lean on `nonMcpSummary` for those.
