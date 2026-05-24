# /analyze-vault-usage critique prompt

You are reviewing one week of Claude Code usage against an Obsidian vault, based on a deterministic JSON report. Your job is to produce one Markdown file body — no preamble, no commentary outside the file.

The report covers **two pools**:

- **Vault** — sessions started from inside the vault directory (Claudian conversations).
- **Projects** — sessions started from external repositories that nonetheless called the neuro-vault MCP server.

Plus a **total** that re-aggregates the union of both pools, and a **per-project breakdown** of the projects pool.

## Inputs

`AnalyticsReport` (key fields: `period`, `buckets.{vault,projects,total}`, `perProject`, `unusedTools`, `samples`):

```json
<<REPORT_JSON>>
```

## What to produce

A single Markdown body using exactly this structure:

```markdown
# Usage analytics <label>

## TL;DR

2-3 sentences. The most important takeaway, not a recap of numbers. If the contrast
between vault and projects buckets is interesting (e.g. a tool dominant in projects
but absent in vault, or vice versa), call it out.

## Numbers — side by side

| Metric                | Vault | Projects | Total |
| --------------------- | ----- | -------- | ----- |
| Sessions              |       |          |       |
| Tool calls            |       |          |       |
| Avg per session       |       |          |       |
| Top tools             |       |          |       |
| Stale-path errors     |       |          |       |
| Dead ends             |       |          |       |

For Top tools cells: comma-joined top 5 of that bucket's `topTools`, names stripped
of the `mcp__neuro-vault__` prefix.

Below the table on its own line:
`Unused tools (catalog): <comma-joined unusedTools, names without prefix; "none" if empty>`.

## Per-project breakdown

Emit only if `perProject` is non-empty.

| Project                                | Sessions | Top tools          | Unique tools         |
| -------------------------------------- | -------- | ------------------ | -------------------- |
| <project encoded name> (<decodedPath>) |          |                    | "none" if empty      |

## Patterns observed

### High-value patterns

Walk `buckets.vault.topSequences`, `buckets.projects.topSequences`, and
`buckets.total.topSequences`. For each entry with `count >= 2`, decide if it
suggests something. Mention only entries that do, and **name the bucket** the
pattern lives in. Example: "In `projects`: edit_note → edit_note ×4 (sessions: …)
— agent does serial edits where a batch could land." Cite session ids so the
user can verify.

### Dead ends

Walk `samples` and identify sessions where `outcome === 'dead_end'` or the
agent retried the same tool. Quote the symptom briefly. Note the bucket — a
dead end in `projects` (no Claudian record, less recoverable context) often
matters more than one in `vault`.

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
- `~XXX KB/run` is your byte-cost estimate, derived from `aggregates.largestResultTools` (avg result size) × the relevant frequency (from `topTools` or `topSequences`). Show the arithmetic in one parenthetical: `(~12 KB × 4 calls/session ≈ 48 KB/run)`. Only `CONFIDENCE`-tier entries carry this figure; `[REQUIRES_VERIFICATION]` and `[BLOCKED: …]` entries do not.

### Required guards

The next three rules tell **you** how to populate the `## Suggestions` section above. Do NOT copy rule text into the output note — apply it.

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

Things the neuro-vault MCP server should expose or change. The N+1 read pattern is a flag for a `query` tool; large-result tools are flags for projection. **If a tool sits in `unusedTools` AND has zero `perProject` mentions across the period window, it is a removal candidate** — say so under the premature-drop guard rules below.

### Vault structure

Things in the vault itself: tag inconsistency, duplicate notes, missing properties.

### Prompt tuning

Things to add to AGENTS.md or CLAUDE.md so the agent works better next time.

## Raw aggregates

<details>
<summary>Vault bucket</summary>

Top tools / 2-grams / 3-grams / stale-path hits / cache-hit distribution / subagent budget — verbatim from `buckets.vault`.
</details>

<details>
<summary>Projects bucket</summary>

Same fields from `buckets.projects`.
</details>

<details>
<summary>Total (union)</summary>

Same fields from `buckets.total`.
</details>
```

## Style rules

- Cite evidence by session id, e.g. "(sessions: conv-A, conv-D)". Do not fabricate sessions.
- When a pattern is bucket-specific, **name the bucket explicitly**. The contrast between vault and projects is the primary reason this report exists.
- If a section has no genuine content, omit the section. Do not pad. "Nothing critical" is a valid week.
- Keep entries short. Each suggestion is one sentence.
- Confidence levels: `HIGH` ≥ 5 supporting sessions AND a KB/run figure; `MED` 2–4 sessions; `LOW` 1 session.
- One sample's `toolCallSummary` may have `mcpCalls = []` — that is a valid vault-relevant session anchored by `currentNote` or wikilinks. Do not assume samples are MCP-heavy; lean on `nonMcpSummary` for those.
- `buckets.projects.currentNoteAnchors` is always empty (external sessions have no Claudian `currentNote`). Do not flag this as a finding.
- `buckets.projects.cacheHitDistribution` reflects per-turn usage parsed from JSONL; the absolute number is less reliable than in `buckets.vault`. Use it for trend, not benchmark.
