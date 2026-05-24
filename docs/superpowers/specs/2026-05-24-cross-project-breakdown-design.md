---
type: spec
created: 2026-05-24
project: neuro-vault-analytics
status: draft
source: Obsidian Tasks/Cross-project breakdown в neuro-vault-analytics.md
supersedes_partial: 2026-04-26-usage-analytics-workflow-design.md
tags: [analytics, scope, dx]
---

# Cross-project breakdown в neuro-vault-analytics

> **Source.** Canonical record of the design first written in the Obsidian task
> `Tasks/Cross-project breakdown в neuro-vault-analytics.md` (created 2026-05-24).
> This spec amends — but does not replace — the original workflow spec
> [2026-04-26-usage-analytics-workflow-design.md](./2026-04-26-usage-analytics-workflow-design.md).
> Sections that change shape (discovery, aggregator, report, prompt) are restated
> here in full; everything else from the original still applies verbatim.

The current CLI scans `~/.claude/projects/<encoded-vault-cwd>/` — meaning it only
sees sessions launched from inside the vault directory. Every session that hit
the neuro-vault MCP from a working repo (`catalog-ui`, `neuro-vault`,
`AI-work-place`, …) is invisible. This spec makes the analyzer cross-project by
default: every report contains three parallel slices — **vault**, **projects**,
**total** — plus a per-project breakdown of the projects slice.

## Motivation

A crude `grep` over `~/.claude/projects/*` for the 7 days ending 2026-05-24:

| Project                       | Sessions touching vault |
| ----------------------------- | ----------------------- |
| `Obsidian` (vault itself)     | 39                      |
| `catalog-ui`                  | 20                      |
| `neuro-vault`                 | 11                      |
| `AI-work-place`               | 6                       |
| `AI-work-place-fact-checker` | 2                       |
| `ttag-cli`                    | 1                       |
| `neuro-vault-analytics`       | 1                       |
| **Total**                     | **80**                  |

Last week's `Inbox/neuro-vault-usage/2026-W21` reported 37 sessions — roughly
**46% of the real vault activity**. The remaining 51% never surfaced.

Tool-level distortion under project-scope vs the cross-project actuals over the
same period:

| Tool                  | W21 report | Cross-project actual | Δ                                |
| --------------------- | ---------- | -------------------- | -------------------------------- |
| `read_notes`          | 67         | 96                   | +29 (largest gap)                |
| `search_notes`        | 83         | 94                   | +11                              |
| `query_notes`         | 55         | 71                   | +16                              |
| `edit_note`           | —          | **26**               | fell out of top-10 in W21        |
| `read_daily`          | ~15        | 22                   | session-start primer fires outside vault too |
| `create_note`         | 23         | 29                   | +6                               |
| `get_vault_overview`  | 0          | **1**                | alive specifically outside vault |
| `set_property`, `list_tags` | 0    | 6, 6                 | situational but real             |

Without the cross-project view, `edit_note` looks rare, `get_vault_overview`
looks dead (it is in fact designed for first-contact from an unknown vault —
exactly the use case that lives outside `Obsidian`), and removal decisions
([Tasks/Прибрати рідковживані тули з neuro-vault MCP]) are made on a biased
sample.

## Scope

### Default behaviour

`/analyze-vault-usage 7d` (and the underlying `nv-analytics --period 7d`) MUST,
without any new flags:

1. Scan **all** entries under `~/.claude/projects/` for the period.
2. Classify each session into one of two buckets:
   - **vault** — sessions whose `<encoded-cwd>` equals `encodeVaultPath(vaultDir)`.
   - **projects** — sessions from any other directory whose JSONL contains at
     least one `mcp__neuro-vault__*` tool call.
   - Sessions from external directories with **no** vault calls are discarded
     before they reach the pipeline.
3. Compute three independent sets of aggregates over the three pools — `vault`,
   `projects`, `total = vault ∪ projects` — and one per-project breakdown over
   the projects pool.

No `--scope` flag in v1. The default `is` the cross-project view. The design
admits a future legacy `--scope vault` for reproducing the old behaviour but
ships nothing for it now.

### Data sources for the two buckets

The vault bucket is unchanged: discovery joins `<vault>/.claude/sessions/*.meta.json`
to `<projectsDir>/<encodedVault>/<sessionId>.jsonl` plus subagent sidecars. Every
session in this bucket has full `ClaudianMeta` — title, currentNote, usage,
cache breakdown.

The projects bucket has **no Claudian metadata** — Claudian only writes
`.meta.json` for conversations started from inside the vault. External-project
sessions exist only as `<projectsDir>/<encodedExternal>/<sessionId>.jsonl`
(plus optional `<sessionId>/subagents/`). We derive what we can from the JSONL
alone:

| Field              | Source                                                              | Fallback                            |
| ------------------ | ------------------------------------------------------------------- | ----------------------------------- |
| `id`               | `sessionId` (the filename stem)                                     | —                                   |
| `title`            | First user-text content block, ≤80 chars                            | `"(no title)"`                      |
| `createdAt`        | First line `timestamp` in the JSONL                                 | file mtime                          |
| `updatedAt`        | Last line `timestamp` in the JSONL                                  | file mtime                          |
| `model`            | Last `assistant` line's `message.model`                             | `"unknown"`                         |
| `cacheHitRatio`    | Sum per-turn `usage.cache_read_input_tokens` over `cache_read + cache_creation + input_tokens` | `0` if no usage lines |
| `contextPercentage`| `0` (no reliable per-window number without Claudian's snapshot)     | `0`                                 |
| `currentNote`      | `null`                                                              | `null`                              |

This is intentionally a degraded view. The aggregates it feeds (top tools,
sequences, stale-paths, dead-ends) are all derived from `toolCalls`, which the
JSONL carries in full, so degradation does not affect the primary signal.
Cache-hit distribution in the `projects` bucket reflects only sessions where the
SDK persisted per-turn usage (today: all of them, but the spec does not promise
that).

### Period filtering for external sessions

Without `meta.createdAt`, we use a two-step filter:

1. **Coarse**: skip JSONL files whose `mtime` is outside `period`. Cheap, lets
   us avoid parsing thousands of historical lines.
2. **Refine**: after parsing, drop sessions whose derived `createdAt` falls
   outside `period`. (Long sessions that span the start boundary stay if
   `createdAt` is inside; this matches vault-bucket behaviour, which keys on
   `meta.createdAt`.)

### Filter heuristic (projects bucket)

Inside the projects bucket, the only relevant filter is "did this session call
the neuro-vault MCP?". The `currentNote` heuristic does not apply (no Claudian
meta). The wiki-link heuristic does not apply (a wiki-link in a user message
outside the vault is just text; it has no vault context). Reduce to a single
predicate: `mainLog OR any subagentLog contains a tool_use whose name starts
with the neuro-vault MCP prefix`.

### Report shape

`AnalyticsReport` is **breaking-renamed**. `Aggregates` becomes `BucketStats`,
moves into `buckets`, and the top-level `stats` block dissolves into per-bucket
fields. `unusedTools` is the only aggregate that stays at the top level (it is
a property of the tool catalog, not of any one bucket).

```ts
export interface AnalyticsReport {
  period: { startMs: number; endMs: number; label: string };
  buckets: {
    vault: BucketStats;
    projects: BucketStats;
    total: BucketStats;
  };
  perProject: ProjectBreakdown[];     // one entry per external project with ≥1 vault session
  unusedTools: string[];              // KNOWN_NEURO_VAULT_TOOLS not seen in `total`
  samples: SampledSession[];
  warnings: string[];
}

export interface BucketStats {
  sessionsTotal: number;              // session count in this pool
  sessionsVault: number;              // sessions that pass the vault filter
                                      //   - in `vault`: equal to sessionsTotal
                                      //   - in `projects`: equal to sessionsTotal by construction (we already filtered)
                                      //   - in `total`: union of the two
  totalToolCalls: number;
  avgToolCallsPerSession: number;
  topTools: AggregateBucket[];
  topSequences: SequenceBucket[];
  largestResultTools: SizeBucket[];
  stalePathErrors: StalePathHit[];
  currentNoteAnchors: AggregateBucket[];   // empty in projects bucket
  cacheHitDistribution: { p50: number; p90: number; mean: number };
  subagentBudget: { mean: number; p95: number; max: number };
  deadEndCount: number;
}

export interface ProjectBreakdown {
  /** Encoded directory name, e.g. "-Users-amostovenko-git-catalog-ui". */
  project: string;
  /** Decoded human-readable absolute path. */
  decodedPath: string;
  sessionsTotal: number;
  sessionsVault: number;              // sessions in this project that hit the vault MCP
  topTools: AggregateBucket[];        // top 5
  /** Tool names called only in this project — not in vault and not in any other project. */
  uniqueTools: string[];
}

export interface SampledSession extends SessionSummary {
  bucket: 'vault' | 'projects';
  /** Encoded project dir name for projects-bucket samples, `null` for vault. */
  project: string | null;
}
```

Aggregates in `buckets.total` are **re-computed** over the union pool, not
summed from `vault` + `projects`. Top tools and top 2/3-grams can be summed
trivially, but percentile-based metrics (cache hits, subagent p95) cannot —
recomputing keeps a single code path and avoids subtle reconciliation bugs.

### Per-project breakdown

`perProject` lists every external project with `sessionsVault ≥ 1`, sorted by
`sessionsVault` desc, ties broken by `project` ascending. The vault project
itself is **not** listed here — it is the `buckets.vault` block.

`uniqueTools` is computed in one pass:

```text
toolToProjects: Map<toolName, Set<projectName>>   // built across all projects + vault
uniqueTools(p) = { tool | toolToProjects[tool] == {p} }
```

Cost is linear in (sessions × tool calls per session). Cheap.

### Sample selection

`samples[]` becomes a balanced selection across the two buckets. With
`--sample-size N`:

- Compute `nVault = floor(N/2)`, `nProjects = N − nVault`.
- Draw `nVault` from the vault pool using the existing stratified sampler.
- Draw `nProjects` from the projects pool using the same sampler.
- If one pool is short, fill the deficit from the other.

Each sample carries `bucket` and `project` so the LLM critique can cite
provenance directly (`(session abc, projects/catalog-ui)`).

### Markdown report

`prompt.md` template body changes. Numbers becomes side-by-side; a new
Per-project breakdown section sits between Numbers and Patterns; Raw aggregates
splits into three collapsible blocks.

```markdown
# Usage analytics <YYYY-Www>

## TL;DR
2-3 sentences. Highlight contrast between buckets if interesting.

## Numbers — side by side

| Metric                     | Vault | Projects | Total |
| -------------------------- | ----- | -------- | ----- |
| Sessions                   |       |          |       |
| Tool calls                 |       |          |       |
| Avg per session            |       |          |       |
| Top tools                  |       |          |       |
| Stale-path errors          |       |          |       |
| Dead ends                  |       |          |       |
| Unused tools (catalog)     | —     | —        |       |

## Per-project breakdown

| Project       | Sessions | Top tools         | Unique tools          |
| ------------- | -------- | ----------------- | --------------------- |
| catalog-ui    |          |                   |                       |
| neuro-vault   |          |                   |                       |
| …             |          |                   |                       |

## Patterns observed

LLM names the bucket whenever a pattern is bucket-specific, e.g.
"in `projects` — Edit→Edit ×N" or "in `vault` — search→search ×M".

## Suggestions

(unchanged: MCP features / Vault structure / Prompt tuning)

## Raw aggregates

<details>
Three blocks — Vault / Projects / Total — each with top tools, sequences,
cache hits, subagent budget.
</details>
```

### Module changes

| File                  | Change                                                                                                                                                                                                                                  |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/types.ts`        | Replace `Aggregates` with `BucketStats`. Add `ProjectBreakdown`, `SampledSession`. Reshape `AnalyticsReport`. Add a `bucket` discriminator to internal `Discovered`-like records.                                                       |
| `src/discover.ts`     | Split into two paths: `discoverVaultSessions` (existing logic, unchanged) and `discoverExternalSessions` (new — scan sibling project dirs, derive metadata from JSONL).                                                                |
| `src/filter.ts`       | Keep `isVaultRelevant` for the vault bucket. Add `externalSessionHasVaultCalls` for the projects bucket.                                                                                                                                |
| `src/extract.ts`      | `toSessionSummary` keeps current behaviour. Add `toSessionSummaryFromExternal` that builds the same shape from JSONL alone (degraded fields per the table above).                                                                       |
| `src/aggregate.ts`    | Aggregator becomes pure over an array of `SessionSummary` — no `KNOWN_NEURO_VAULT_TOOLS` filter anymore. Caller invokes it three times. `unusedTools` moves into a new top-level helper `computeUnusedTools(allSessions)`.              |
| `src/sample.ts`       | Add `sampleBalanced(vault, projects, n)` that calls the existing stratified sampler twice.                                                                                                                                              |
| `src/run.ts`          | Orchestrate the new shape: discover vault → discover projects → filter projects → run aggregator ×3 → build perProject → sample balanced.                                                                                              |
| `src/format.ts`       | Update text output for the new shape. JSON formatter is shape-passthrough; no logic change.                                                                                                                                             |
| `src/cli.ts`          | Add `--projects-dir` default unchanged. Wire `--vault` resolution as today; vault project name still computed via `encodeVaultPath(vaultDir)`. No new flags.                                                                            |
| `skills/.../prompt.md`| Rewrite the inputs schema and template body to match the new shape.                                                                                                                                                                    |
| `skills/.../SKILL.md` | Update the inline `type AnalyticsReport` description and adjust the destination-path note (unchanged — still `Inbox/neuro-vault-usage/YYYY-Www.md`).                                                                                    |

### Dependency direction (after)

```
cli.ts → run.ts → discover.ts (vault path)        → parse-jsonl.ts
                ↘ discover.ts (external path)     → parse-jsonl.ts
                ↘ filter.ts
                ↘ extract.ts (meta path / log path) → parse-jsonl.ts
                ↘ aggregate.ts            (called ×3)
                ↘ sample.ts               (balanced)
                ↘ perProject.ts           (new helper — see below)
cli.ts → format.ts | period.ts | config.ts
```

A new internal helper `src/per-project.ts` builds `ProjectBreakdown[]` and
`unusedTools[]`. Pulling this out keeps `run.ts` orchestration-only.

## Behaviour

- **Empty period** — still writes the note with all three buckets at 0. Honest.
- **No external projects** — `buckets.projects` is empty; `perProject` is empty;
  `buckets.total` equals `buckets.vault`. Not an error.
- **External project with sessions but no vault calls** — discarded silently
  (not counted in any bucket, not in `warnings`). It is not our data.
- **Missing main JSONL for a vault session** — same as today: warning, session
  flows downstream with empty `mainLog`. (External sessions are identified by
  the JSONL itself; "missing main JSONL" is undefined there.)
- **Period filtering for external sessions** — mtime coarse + first-line
  refinement. Both required; mtime alone would over-include long-lived JSONLs
  the SDK touched recently but whose conversation started before the period.
- **Idempotency** — unchanged: re-running on the same week overwrites the note
  with a one-line warning.

## Out of scope (this revision)

- `--scope vault` flag for reproducing the old project-scope behaviour. The
  design admits it (single conditional in `run.ts`) but v1 ships only the
  default cross-project view.
- Cross-period diff (`/compare-vault-usage W21 W22`) — already deferred by the
  original spec; unchanged.
- Detection of "abandoned" outcomes from raw JSONL — `lastMainStatus` heuristic
  applies equally to external sessions; no special handling needed.
- Schema-versioning the JSON output. The report shape is breaking-changed; the
  skill is updated in the same release. Standalone CLI consumers (none known
  today) will need to update their parsing.

## Tests

- **Discovery (external)** — fixture with three project dirs (vault, one
  external with vault calls, one external with only `Read`/`Bash` calls).
  Result: vault + one external; the no-vault-calls one is dropped.
- **Period filter (external)** — JSONL whose mtime is inside the period but
  whose first line is two months old → dropped at the refine step.
- **External session derivation** — title from first user text, createdAt from
  first line ts, updatedAt from last; cacheHitRatio summed across per-turn
  usage blocks.
- **Aggregator independence** — top tools / sequences computed per bucket give
  the same result as running the existing aggregator on a single-bucket pool.
- **Per-project unique tools** — fixture where `get_vault_overview` appears
  only in `catalog-ui`: `perProject[catalog-ui].uniqueTools` contains it,
  no other project's `uniqueTools` does, and it is **not** in `unusedTools`.
- **Balanced sampling** — pool of 30 vault + 30 projects, `--sample-size 10`
  → 5 vault, 5 projects. Pool of 30 vault + 2 projects → 8 vault, 2 projects.
- **CLI smoke** — `nv-analytics --period 7d --format json` on a fixture vault
  with one external project → valid `AnalyticsReport` matching the new shape.
- **Manual smoke** — generate next weekly report (`2026-W22`) from real data
  and verify the buckets in the report's spec-DoD list (below).

## Definition of Done

- [ ] CLI default scans all `~/.claude/projects/*` for the period; no new flags
      required.
- [ ] Every discovered session is classified into `vault` or `projects` or
      discarded.
- [ ] `AnalyticsReport.buckets` has `vault`, `projects`, `total`; `perProject`
      is populated; `unusedTools` lives at the top level.
- [ ] `samples[]` carry `bucket` and `project`; selection is balanced between
      the two pools when both have data.
- [ ] `prompt.md` template renders side-by-side Numbers, per-project breakdown,
      and three Raw aggregates blocks.
- [ ] `SKILL.md` inline schema description matches the new shape.
- [ ] vitest green; new fixtures cover the cases above.
- [ ] `npm run lint` clean; `npx tsc --noEmit` clean.
- [ ] Smoke run on real records for `--period 7d` on 2026-05-24 produces:
  - `vault` bucket ≈ 37 sessions (W21 baseline).
  - `projects` bucket ≈ 41 sessions, dominated by `catalog-ui`, `neuro-vault`,
    `AI-work-place`.
  - `total` 78-80 sessions.
  - `edit_note` in `projects.topTools` even though it was absent from W21.
  - `get_vault_overview` in `perProject[catalog-ui].uniqueTools` (or wherever
    the live caller was) and absent from `unusedTools`.
- [ ] README mentions the cross-project default and the lack of a `--scope`
      flag in v1.
- [ ] CHANGELOG entry on release describing the breaking shape change.
- [ ] `docs/architecture/module-structure.md` updated for the new split
      discovery, `per-project.ts`, and aggregator-on-bucket interface.

## Connections

- Original workflow spec [2026-04-26-usage-analytics-workflow-design.md](./2026-04-26-usage-analytics-workflow-design.md)
  — this spec amends discovery, aggregator, samples, and report; the rest
  (Claudian record locations, skill flow, output destination, idempotency)
  carries over unchanged.
- `Tasks/Прибрати рідковживані тули з neuro-vault MCP` (vault) — removal
  decisions should be revisited on the cross-project data this spec unlocks.
- `Tasks/Помітити core neuro-vault tools як non-deferred` (vault) — the
  "core tools" set is expected to shift once `edit_note` and `read_daily` are
  measured cross-project.
- `Tasks/Day-over-day token metrics in neuro-vault-analytics` (vault) — parallel
  enhancement to the same CLI; should land after this spec to avoid merge churn.
