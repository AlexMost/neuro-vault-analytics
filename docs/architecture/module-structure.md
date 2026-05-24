# Module structure

`neuro-vault-analytics` is a small TypeScript package with a single binary (`nv-analytics`) and a Markdown skill that wraps it. Every source file has one responsibility; tests sit next to the code by name.

## Source layout

| File                          | Responsibility                                                                                                                                                                                                                                                  |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/types.ts`                | Domain types (`ClaudianMeta`, `ToolCall`, `SessionSummary`, `BucketStats`, `ProjectBreakdown`, `SampledSession`, `AnalyticsReport`) and the canonical list of expected MCP tool names.                                                                          |
| `src/period.ts`               | Parse `--period 7d` / `2w` into a `{ startMs, endMs, label }` window.                                                                                                                                                                                            |
| `src/config.ts`               | Resolve the vault from an explicit flag or by walking up from `cwd`; encode/decode the absolute path to/from the SDK projects-dir slug.                                                                                                                          |
| `src/parse-jsonl.ts`          | Read a JSONL string, pull out `tool_use` / `tool_result` pairs, ignore noise.                                                                                                                                                                                    |
| `src/discover.ts`             | **Vault bucket:** walk `{vault}/.claude/sessions/*.meta.json`, join with the SDK log + subagent sidecars. Records warnings; never throws on missing optional files. Exports `listSubagents` for reuse.                                                            |
| `src/discover-external.ts`    | **Projects bucket:** walk every other entry under `~/.claude/projects/`, drop directories whose JSONLs do not call the neuro-vault MCP. Two-step period filter (mtime coarse, first-line ts refine). No Claudian metadata available — JSONL is the only source. |
| `src/filter.ts`               | Heuristic for "is this session about the vault?". Exports `logHasNeuroVaultTool` for use by external discovery.                                                                                                                                                  |
| `src/extract.ts`              | Build a `SessionSummary` from a vault-bucket `Discovered`. Exports `subagentStats` and `lastMainStatus` for reuse.                                                                                                                                               |
| `src/extract-external.ts`     | Build a `SessionSummary` from a `DiscoveredExternal` (no Claudian metadata): derive title from first user-text, createdAt/updatedAt from first/last line timestamps, model from last assistant `message.model`, cacheHitRatio summed across per-turn `usage`.    |
| `src/aggregate.ts`            | Pure aggregator over a single pool of sessions, returning `BucketStats`. Caller invokes it three times (vault, projects, total). Also exports `computeUnusedTools(sessions)`.                                                                                    |
| `src/per-project.ts`          | Build `ProjectBreakdown[]` for external projects with ≥1 session. Computes `uniqueTools` across the union of vault + all projects.                                                                                                                               |
| `src/sample.ts`               | Stratified sampling (`sampleSessions`) plus `sampleBalanced(vault, projects, n)` that splits roughly half-and-half across buckets and backfills deficits.                                                                                                        |
| `src/format.ts`               | Render an `AnalyticsReport` as JSON or text. JSON is pass-through; text shows per-bucket lines, per-project breakdown, unused tools, warnings.                                                                                                                  |
| `src/run.ts`                  | Orchestrate the full pipeline: vault + external discovery in parallel → filter → extract → aggregate ×3 → buildPerProject → sampleBalanced → assemble report.                                                                                                    |
| `src/cli.ts`                  | yargs-driven entry point. Calls `parsePeriod` + `resolveVault` + `run`, prints the formatted report, handles exit codes.                                                                                                                                         |

## Skill layout

| File                                   | Responsibility                                                                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `skills/analyze-vault-usage/SKILL.md`  | The wrapper Claude reads when the user invokes `/analyze-vault-usage`. Defines the three-step flow: run CLI → critique → write note. |
| `skills/analyze-vault-usage/prompt.md` | The LLM critique prompt template. Separated so iterating on prompt language does not require a CLI rebuild.                          |

## Dependency direction

```
cli.ts → run.ts → discover.ts          → parse-jsonl.ts
                ↘ discover-external.ts → parse-jsonl.ts, filter.ts, discover.ts (listSubagents)
                ↘ filter.ts
                ↘ extract.ts           → parse-jsonl.ts
                ↘ extract-external.ts  → parse-jsonl.ts, extract.ts (subagentStats, lastMainStatus)
                ↘ aggregate.ts          (called ×3, also exports computeUnusedTools)
                ↘ per-project.ts       → config.ts (decodeProjectPath)
                ↘ sample.ts            → per-project.ts (ExternalSession type)
cli.ts → format.ts
cli.ts → period.ts
cli.ts → config.ts
```

`types.ts` is a leaf — every other file imports from it; nothing imports back into it.
