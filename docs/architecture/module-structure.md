# Module structure

`neuro-vault-analytics` is a small TypeScript package with a single binary (`nv-analytics`) and a Markdown skill that wraps it. Every source file has one responsibility; tests sit next to the code by name.

## Source layout

| File                 | Responsibility                                                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/types.ts`       | Domain types (`ClaudianMeta`, `ToolCall`, `SessionSummary`, `AnalyticsReport`) and the canonical list of expected MCP tool names.                 |
| `src/period.ts`      | Parse `--period 7d` / `2w` into a `{ startMs, endMs, label }` window.                                                                             |
| `src/config.ts`      | Resolve the vault from an explicit flag or by walking up from `cwd`; encode an absolute path to the SDK projects-dir slug.                        |
| `src/parse-jsonl.ts` | Read a JSONL string, pull out `tool_use` / `tool_result` pairs, ignore noise.                                                                     |
| `src/discover.ts`    | Walk `{vault}/.claude/sessions/*.meta.json`, join with the SDK log + subagent sidecars. Records warnings; never throws on missing optional files. |
| `src/filter.ts`      | Heuristic for "is this session about the vault?" (neuro-vault MCP tool / non-empty `currentNote` / wiki-link in user text).                       |
| `src/extract.ts`     | Build a `SessionSummary` from a `Discovered`, including merged tool sequence, subagent stats, and outcome.                                        |
| `src/aggregate.ts`   | All aggregate metrics (top tools, sequences, stale-paths, distributions). Each helper is pure.                                                    |
| `src/sample.ts`      | Stratified sampling over hour-of-day × tool-call quartile. Deterministic.                                                                         |
| `src/format.ts`      | Render an `AnalyticsReport` as JSON or text.                                                                                                      |
| `src/run.ts`         | Orchestrate the full pipeline. The CLI and tests both call this.                                                                                  |
| `src/cli.ts`         | yargs-driven entry point. Calls `parsePeriod` + `resolveVault` + `run`, prints the formatted report, handles exit codes.                          |

## Skill layout

| File                                   | Responsibility                                                                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `skills/analyze-vault-usage/SKILL.md`  | The wrapper Claude reads when the user invokes `/analyze-vault-usage`. Defines the three-step flow: run CLI → critique → write note. |
| `skills/analyze-vault-usage/prompt.md` | The LLM critique prompt template. Separated so iterating on prompt language does not require a CLI rebuild.                          |

## Dependency direction

```
cli.ts → run.ts → discover.ts → parse-jsonl.ts
                ↘ filter.ts
                ↘ extract.ts → parse-jsonl.ts
                ↘ aggregate.ts
                ↘ sample.ts
cli.ts → format.ts
cli.ts → period.ts
cli.ts → config.ts
```

`types.ts` is a leaf — every other file imports from it; nothing imports back into it.
