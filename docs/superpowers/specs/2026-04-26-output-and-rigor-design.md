---
title: Improve neuro-vault-analytics output and rigor
date: 2026-04-26
status: approved
parent_spec: 2026-04-26-usage-analytics-workflow-design.md
---

# Improve neuro-vault-analytics output and rigor

## Context

First live run of `/analyze-vault-usage` (W17, file `Inbox/neuro-vault-usage/2026-W17.md`) exposed two distinct defect classes in the v0.1.0 plugin:

1. **CLI output bloat.** A 7-day JSON report on a small vault is already ~173 KB. With 1–2 months of accumulated history it will easily cross 300–500 KB, consuming 90 %+ of a subagent context window before any reasoning happens. Per-session bloat is dominated by full `toolCalls[]` arrays on heavy sessions (one heavy session = ~30 KB) and by full `/Users/<user>/<vault>/...` absolute paths in `argsSummary` (≈ 50 % of each summary string is the vault prefix).
2. **Skill/prompt rigor gaps.** The grounded prompt did not block three classes of low-quality recommendations during W17:
   - "drop unused tools" emitted on a single day of data,
   - "Edit×N → Write-once" emitted without verifying the underlying cost mechanic,
   - HIGH-confidence recommendations cited only one session and no token figure.

Parent spec `2026-04-26-usage-analytics-workflow-design.md` is `done`. This spec is the primary follow-up addressing those live defects.

## Goals

- Cut typical 7-day JSON output to <80 KB even on vaults with 1–2 months of history.
- Allow drill-down into a specific session without re-running the full pipeline.
- Make the skill prompt structurally resistant to the three W17 noise patterns.
- Keep the existing module layout — no new top-level concepts, only point-fixes plus one new subcommand.

## Non-goals

- LLM-as-critic second pass (review-step). Deferred until self-check proves insufficient.
- Cross-period diff (`/compare-vault-usage W16 W17`).
- Auto-task-creation from recommendations.
- Structured metrics surfaced via MCP (NDJSON).
- Scheduler / Zen bot.

## Architecture

### A. CLI output projection — signal vs noise

Introduce a new sample shape returned in `AnalyticsReport.samples`. The split between "signal" and "noise" is by tool name prefix: `mcp__neuro-vault-mcp__*` is the product surface we are measuring (signal), everything else is supporting tooling (noise — useful in aggregate, wasteful per-call).

```ts
interface SampledSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  durationMs: number;
  model: string;
  contextPercentage: number;
  cacheHitRatio: number;
  currentNote: string | null;
  outcome: Outcome;
  subagent: SubagentStats;
  toolCallSummary: {
    total: number;                    // total tool calls in the session (all sources)
    mcpCalls: ToolCall[];             // ALL mcp__neuro-vault-mcp__* calls verbatim
    anomalies: ToolCall[];            // any call (incl. non-MCP) with status === 'error' OR resultSize > 5120
    nonMcpSummary: {
      total: number;                  // count of non-MCP, non-anomalous calls
      topTools: AggregateBucket[];    // top 5 tool names within this session's non-MCP set
      nGrams: SequenceBucket[];       // top 3 of (2-gram ∪ 3-gram), session-local, non-MCP only
    };
  };
}

interface AnalyticsReport {
  // ...unchanged fields...
  samples: SampledSession[];   // was: SessionSummary[]
}
```

`projectSession(s: SessionSummary): SampledSession` lives in `src/sample.ts`. Pure and deterministic.

Rules:

- **`mcpCalls`** are emitted verbatim with already-scrubbed `argsSummary` (vault-prefix replaced, capped at 200). No truncation by count — if a session has 80 MCP calls, all 80 go in.
- **`anomalies`** include any `ToolCall` (MCP or non-MCP) where `status === 'error'` or `resultSize > 5 * 1024`. `null` `resultSize` is not an anomaly. A call may appear both in `mcpCalls` and `anomalies` — both arrays carry it; consumers de-dup by `ts` if they care.
- **`nonMcpSummary.topTools` / `nGrams`** are computed only over non-MCP, non-anomalous calls (so anomalies are not double-counted into the noise summary). n-grams here merge 2- and 3-grams ranked by count, top 3.
- **Edge case: 0 MCP calls.** `mcpCalls = []` is valid; `nonMcpSummary` carries the session. The skill prompt must not assume MCP-heavy samples.

### B. Vault-prefix scrub + argsSummary cap

`summarizeArgs(input, vaultDir)` in `src/parse-jsonl.ts`:

1. `s = JSON.stringify(input).replace(/\s+/g, ' ').trim()`
2. If `vaultDir` provided and non-empty, replace every literal occurrence of `${vaultDir}/` (with trailing slash) by `vault:`. Use `replaceAll` with a literal string — do not build a regex, since vault paths can contain regex metacharacters.
3. Cap `s` at 200 characters; truncated strings end with `…`.

`vaultDir` is threaded through `toSessionSummary(d, { vaultDir })` and into `extractToolCalls(jsonl, source, vaultDir)`. The CLI already resolves `vaultDir`, so the change is purely additive.

### C. Byte-budget sampler

Replace `sampleSessions(sessions, sampleSize: number)` with `sampleSessions(sessions, { byteBudget: number })`. Returns `SampledSession[]` (not `SessionSummary[]`).

Algorithm:

1. Compute `cost(s) = Buffer.byteLength(JSON.stringify(projectSession(s)), 'utf8')`.
2. Stratify by `(hourBucket, callQuartile)` exactly as today.
3. Round-robin across strata; for each candidate, project + measure + decide.
4. Stop when `runningTotal + cost(next) > byteBudget` and at least one session has been added.
5. **Guarantee:** if `sessions.length > 0`, return at least one session (even if it alone exceeds the budget — log a warning).

The CLI flag is `--sample-bytes`, defaulting to `50000`. It accepts:

- bare integer (`50000`) → bytes,
- with `KB`/`MB` suffix (`50KB`, `1MB`) → multiplied accordingly.

The old `--sample-size` flag is removed (no deprecation: this is still pre-1.0 development).

### D. `--detail <sessionId>` subcommand

New CLI shape: `nv-analytics` accepts either `--period <span>` (existing report mode) **or** `--detail <sessionId>` (new mode). Yargs `conflicts` enforces mutual exclusion.

Detail mode:

- discovers all sessions in `projectsDir` (no period filter),
- finds the one whose `meta.id === <sessionId>`,
- emits the full `SessionSummary` (all `toolCalls[]` with vault-scrubbed `argsSummary`),
- exits 1 with `nv-analytics: session <id> not found` if no match.

Output is JSON, pretty-printed, the same shape as one element of `AnalyticsReport.samples` would have been before this change — i.e. a `SessionSummary`.

### E. Skill / prompt rigor

#### 1. Period-aware filename (SKILL.md)

```
windowMs = period.endMs - period.startMs
if windowMs >= 7 * 86_400_000:
  path = `Inbox/neuro-vault-usage/<ISO YYYY-Www of period.endMs>.md`
else:
  path = `Inbox/neuro-vault-usage/<YYYY-MM-DD of period.startMs>_to_<YYYY-MM-DD of period.endMs>.md`
```

Note title mirrors the chosen label (`# Usage analytics 2026-W17` or `# Usage analytics 2026-04-25_to_2026-04-26`).

#### 2. Cost-grounded recommendations (prompt.md)

Each recommendation MUST take the form:

```
[CONFIDENCE | N sessions | ~XXX KB/run] **Title** — one-line action.
```

Where `~XXX KB/run` is derived from `aggregates.largestResultTools` (avg result size) × the relevant frequency (from `topTools` or `topSequences`).

Validation rule, enforced by the prompt: `[HIGH]` without a KB/run figure is invalid. The model must downgrade to `[MED]`/`[LOW]` or discard the entry.

#### 3. Premature-drop guard (prompt.md)

Before emitting "drop X", "remove X", "deprecate X", or "X is unused" the model MUST verify both:

- `(period.endMs - period.startMs) / 86400000 >= 14`, AND
- `>= 3` distinct working sessions in `samples` lacking that tool.

Otherwise the entry becomes:

```
[BLOCKED: insufficient data — observed N sessions over P days]
```

(no confidence tier).

#### 4. Self-check on cost mechanic (prompt.md)

Before emitting any "replace X with Y" recommendation, the prompt instructs the model to walk a short checklist:

- Is Y actually cheaper on this workload, given `aggregates.largestResultTools`?
- Known asymmetries: `Edit` ships a diff; `Write` ships the full file; a narrow tool has less preamble per call but may need more calls.

If the mechanic is not obvious or not verifiable from the report, the recommendation is tagged `[REQUIRES_VERIFICATION]` instead of a confidence tier. This is a clause inside the same prompt — not a second LLM pass.

#### 5. Frontmatter retention (SKILL.md template)

```yaml
tags: [analytics, neuro-vault]   # 'ephemeral' removed
type: review                     # unchanged
archived: false                  # new explicit field for future lifecycle tooling
```

## Error handling

- `--detail` with unknown id → exit 1, stderr `nv-analytics: session <id> not found`.
- `--sample-bytes` value below the cost of even one session → at least one session is still emitted, plus `warnings[]` entry: `sample budget too small; emitted N=1 anyway`.
- Both `--period` and `--detail` set → yargs `conflicts` error before `run()`.
- Neither flag set → yargs `demandOption` error pointing at `--period` (the report-mode default).

## Testing

### CLI (vitest)

- Heavy MCP session fixture (>20 MCP calls + >50 non-MCP): `samples[i].toolCallSummary` contains `mcpCalls` (all `mcp__neuro-vault-mcp__*` verbatim), `anomalies`, `nonMcpSummary` (with `topTools`, `nGrams`). **No** `toolCalls` field on a `SampledSession`.
- Zero-MCP fixture (session has only non-MCP calls but is still vault-relevant via `currentNote` / wikilink): `mcpCalls === []`, `nonMcpSummary` populated, valid JSON, no exception.
- Vault-prefix-heavy fixture: post-projection `argsSummary` contains no `/Users/` substring.
- Smoke: `nv-analytics --period 7d --format json --vault <fixture>` on a 30+ session fixture → output < 60 KB (target headroom under the 80 KB DoD).
- `nv-analytics --detail <sessionId>` → returns full `SessionSummary` for that id, with vault-scrubbed `argsSummary` and capped at 200 chars; exits 1 on unknown id.
- `--sample-bytes` accepts `50000` and `50KB` and `1MB`; equivalent values produce identical samples.
- `argsSummary` cap = 200; longer inputs end with `…`.
- Sample budget guarantee: `--sample-bytes 1` on a non-empty fixture still emits one session and a warning.
- Anomaly classification: a non-MCP call with `resultSize > 5 KB` lands in `anomalies` and does NOT appear in `nonMcpSummary.topTools` counts.

### Skill / prompt (manual smoke, not automated)

- Re-run W17 (same 2 days of data): produced note must NOT contain
  - "drop unused tools" → expected `[BLOCKED: insufficient data]`,
  - "Edit×N → Write-once" without `[REQUIRES_VERIFICATION]` or with an obviously wrong cost claim,
  - any `[HIGH]` recommendation lacking a KB/run figure.
- Run on `period < 7d` → file named `YYYY-MM-DD_to_YYYY-MM-DD.md`, not `YYYY-Www.md`.
- Generated frontmatter: `type: review`, no `ephemeral` in tags, `archived: false` present.

Per the user instruction this spec was approved with: `prompt.md` content is **not** covered by automated tests.

## Definition of done

- `nv-analytics --period 7d --format json` on a vault with 1–2 months of history → < 80 KB JSON output.
- `nv-analytics --detail <sessionId>` works.
- W17 re-run produces zero recommendations from the three identified noise classes (premature-drop, unverified cost-replacement, HIGH without KB figure).
- Vitest green; new fixtures cover every case in the CLI test list.
- Existing `Inbox/neuro-vault-usage/2026-W17.md` is renamed/regenerated under the new naming convention as the acceptance check.

## References

- Source ticket: `/Users/amostovenko/Obsidian/Tasks/Improve neuro-vault-analytics output and rigor.md`
- Parent spec: `docs/superpowers/specs/2026-04-26-usage-analytics-workflow-design.md`
- Live regression fixture: `Inbox/neuro-vault-usage/2026-W17.md`

## Things to remember

- `| wc -c` truncates pipe output at 64 KB. Real size must be measured via file (`> out.json && wc -c out.json`).
- Sessions ≠ tokens. Confidence must be grounded in bytes/tokens, not session count.
- "Drop unused" is the highest-noise recommendation class on short windows. The dedicated guard in §E.3 exists for it specifically.
